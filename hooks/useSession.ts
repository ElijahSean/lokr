/**
 * hooks/useSession.ts — Session context and vault unlock/lock logic
 *
 * This hook provides the session state and auth operations to all components.
 * It wraps the low-level session.ts module in a React context so components
 * can react to lock/unlock state changes.
 *
 * Usage:
 *   const { encryptionKey, hmacKey, isUnlocked, unlock, lock, setupVault } = useSession()
 *
 * The context is provided by <SessionProvider> in app/layout.tsx.
 * Any component that calls useSession() must be a descendant of SessionProvider.
 *
 * Auth flow:
 *   First time: setupVault(password) → generates salt, signs empty vault, sets keys
 *   Returning:  unlock(password) → reads salt, derives keys, verifies HMAC, sets keys
 *   Lock:       lock() → clears keys, redirects to /
 */

'use client'

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  createElement,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'

import {
  getSessionKey,
  getSessionHmacKey,
  setSessionKeys,
  clearSessionKeys,
  isUnlocked as isSessionUnlocked,
} from '@/lib/session'
import { deriveKeys, generateSalt, signVault, verifyVault, bufferToBase64, base64ToBuffer } from '@/lib/crypto'
import { clearClipboardNow } from '@/lib/clipboard'
import { db } from '@/lib/db'
import { buildVaultPayload } from '@/lib/vaultPayload'

// ─── Context Shape ────────────────────────────────────────────────────────────

interface SessionContextValue {
  /** The AES-256-GCM key, or null if vault is locked */
  encryptionKey: CryptoKey | null
  /** The HMAC-SHA256 key, or null if vault is locked */
  hmacKey: CryptoKey | null
  /** True if both keys are present and vault is unlocked */
  isUnlocked: boolean
  /** Attempt to unlock an existing vault. Returns null on success, error message on failure. */
  unlock: (password: string) => Promise<string | null>
  /** Create a new vault on first run. Returns null on success, error message on failure. */
  setupVault: (password: string) => Promise<string | null>
  /** Lock the vault and clear all keys from memory. */
  lock: () => void
  /** Re-sign the vault after any write operation (add/edit/delete entry). */
  updateVaultSignature: () => Promise<void>
  /**
   * Replace the session keys after a vault restore. A restored backup can carry
   * a different salt (or master password), which invalidates the pre-import keys.
   */
  adoptSessionKeys: (encryptionKey: CryptoKey, hmacKey: CryptoKey) => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

const SessionContext = createContext<SessionContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * SessionProvider wraps the whole app and provides session state to all children.
 * Place this at the root layout level so every component has access.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter()

  // The actual keys live in session.ts (module memory). This counter exists only
  // to force a re-render whenever the keys change — including key SWAPS during a
  // vault restore, where the vault stays unlocked but the keys are replaced
  // (a boolean "unlocked" state would bail out of that re-render).
  const [, bumpSession] = useReducer((n: number) => n + 1, 0)

  // ── Lock ────────────────────────────────────────────────────────────────────

  const lock = useCallback(() => {
    clearSessionKeys()           // Wipe keys from module memory
    void clearClipboardNow()     // Best-effort clipboard wipe (retried on focus)
    bumpSession()                // Trigger re-render in all consumers
    router.push('/')             // Return to unlock screen
  }, [router])

  // ── Unlock Existing Vault ───────────────────────────────────────────────────

  /**
   * Attempts to unlock the vault with the provided password.
   *
   * Steps:
   *  1. Load the Argon2 salt from vault_meta
   *  2. Derive AES + HMAC keys from password + salt (slow — ~1–2s)
   *  3. Load all encrypted entries from IndexedDB
   *  4. Verify the stored HMAC signature with the derived HMAC key
   *  5. If valid: store keys in session.ts, trigger re-render, return null (success)
   *  6. If invalid: return error message (wrong password or tampered vault)
   */
  const unlock = useCallback(async (password: string): Promise<string | null> => {
    try {
      // Load vault metadata — contains the Argon2 salt and HMAC signature
      const meta = await db.vault_meta.get(1)
      if (!meta?.salt) {
        return 'No vault found. Please set up Lokr first.'
      }

      const salt = base64ToBuffer(meta.salt)

      // Derive both keys — this is the slow step (Argon2id, ~1–2 seconds)
      const { encryptionKey, hmacKey } = await deriveKeys(password, salt)

      // Load all encrypted entries and sticky notes to verify the HMAC
      const entries = await db.vault_entries.orderBy('id').toArray()
      const notes   = await db.sticky_notes.orderBy('id').toArray()
      const payload = buildVaultPayload(meta.salt, entries, notes)

      // Fail CLOSED: every vault created by Lokr is signed at setup, so a
      // missing signature means vault_meta was tampered with or corrupted.
      // Skipping verification here would let ANY password "unlock" the vault
      // and silently disable tamper detection.
      if (!meta.hmacSignature) {
        return 'Vault integrity data is missing — the vault may have been tampered with. Restore from a backup after a full reset.'
      }

      const valid = await verifyVault(hmacKey, payload, meta.hmacSignature)
      if (!valid) {
        return 'Incorrect password or vault has been tampered with.'
      }

      // Password verified — store keys in the session module
      setSessionKeys(encryptionKey, hmacKey)
      bumpSession()

      return null  // null = success

    } catch (err) {
      return `Unlock failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    }
  }, [])

  // ── First-Time Vault Setup ──────────────────────────────────────────────────

  /**
   * Creates a new vault with the given master password.
   * Called once on first run; sets up the salt and initial HMAC signature.
   *
   * Steps:
   *  1. Generate a random 128-bit Argon2 salt
   *  2. Derive AES + HMAC keys from password + salt
   *  3. Store salt in vault_meta
   *  4. Sign an empty vault (no entries yet) and store the signature
   *  5. Store keys in session.ts
   */
  const setupVault = useCallback(async (password: string): Promise<string | null> => {
    try {
      const salt    = generateSalt()
      const saltB64 = bufferToBase64(salt)

      const { encryptionKey, hmacKey } = await deriveKeys(password, salt)

      // Sign the initial empty vault so future unlocks can verify the password
      const emptyPayload = buildVaultPayload(saltB64, [])
      const signature    = await signVault(hmacKey, emptyPayload)

      // Store metadata (upsert with id=1)
      await db.vault_meta.put({
        id: 1,
        salt: saltB64,
        hmacSignature: signature,
        lastBackupAt: undefined,
      })

      setSessionKeys(encryptionKey, hmacKey)
      bumpSession()

      return null

    } catch (err) {
      return `Setup failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    }
  }, [])

  // ── Adopt Keys After Restore ────────────────────────────────────────────────

  /**
   * Installs freshly derived keys after a .vault restore. The restore path
   * (lib/export.ts restoreVaultFile) derives keys from the FILE's salt, which
   * may differ from the salt the current session keys were derived from.
   */
  const adoptSessionKeys = useCallback((encryptionKey: CryptoKey, hmacKey: CryptoKey) => {
    setSessionKeys(encryptionKey, hmacKey)
    bumpSession()
  }, [])

  // ── Update Vault Signature ──────────────────────────────────────────────────

  /**
   * Re-signs the vault after any write operation (add/edit/delete).
   *
   * Call this after every mutation to keep the HMAC signature in sync
   * with the current vault contents. If you forget to call this after a write,
   * the next unlock will fail HMAC verification.
   */
  const updateVaultSignature = useCallback(async (): Promise<void> => {
    const hKey = getSessionHmacKey()
    if (!hKey) return  // Not unlocked — nothing to do

    const meta    = await db.vault_meta.get(1)
    if (!meta)    return

    const entries  = await db.vault_entries.orderBy('id').toArray()
    const notes    = await db.sticky_notes.orderBy('id').toArray()
    const payload  = buildVaultPayload(meta.salt, entries, notes)
    const signature = await signVault(hKey, payload)

    await db.vault_meta.update(1, { hmacSignature: signature })
  }, [])

  // ── Context Value ────────────────────────────────────────────────────────────

  const value: SessionContextValue = {
    encryptionKey: getSessionKey(),
    hmacKey: getSessionHmacKey(),
    isUnlocked: isSessionUnlocked(),
    unlock,
    setupVault,
    lock,
    updateVaultSignature,
    adoptSessionKeys,
  }

  // Use createElement instead of JSX so this file can stay .ts (not .tsx)
  return createElement(SessionContext.Provider, { value }, children)
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useSession — access session state and auth operations from any component.
 *
 * Throws if called outside of a <SessionProvider>.
 */
export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSession must be used inside a <SessionProvider>.')
  }
  return ctx
}
