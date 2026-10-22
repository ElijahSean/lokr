/**
 * lib/session.ts — In-memory session key storage
 *
 * This is the most security-critical file in Lokr.
 * The encryption and HMAC keys live here and ONLY here.
 *
 * Key security properties:
 *  - Keys are module-level variables (in-memory only)
 *  - Keys are NEVER written to localStorage, IndexedDB, cookies, or any persistent storage
 *  - Keys are non-extractable CryptoKey objects (the browser won't let JS read the raw bytes)
 *  - Keys are cleared (set to null) on every lock event
 *  - When the user closes the tab, all memory is wiped by the browser
 *
 * Limitation: JavaScript has no way to explicitly zero memory (no memset equivalent).
 * Setting to null removes the reference; the GC will reclaim the memory eventually.
 * This is a known limitation of browser-based cryptography.
 */

// AES-256-GCM key used to encrypt and decrypt individual vault entries.
// Derived from bytes 0–31 of the Argon2id output.
let sessionEncryptionKey: CryptoKey | null = null

// HMAC-SHA256 key used to sign and verify the entire encrypted vault.
// Derived from bytes 32–63 of the Argon2id output.
// Using separate key material for AES and HMAC is a cryptographic best practice (domain separation).
let sessionHmacKey: CryptoKey | null = null

/** Returns the current AES-256-GCM encryption key, or null if the vault is locked. */
export function getSessionKey(): CryptoKey | null {
  return sessionEncryptionKey
}

/** Returns the current HMAC-SHA256 signing key, or null if the vault is locked. */
export function getSessionHmacKey(): CryptoKey | null {
  return sessionHmacKey
}

/**
 * Stores both derived keys in memory after a successful unlock.
 * Only called by useSession.ts after verifying the master password.
 */
export function setSessionKeys(encKey: CryptoKey, hmacKey: CryptoKey): void {
  sessionEncryptionKey = encKey
  sessionHmacKey = hmacKey
}

/**
 * Clears both keys from memory.
 * Called on every lock event: manual lock, idle timeout, or tab hide.
 * After this call, isUnlocked() returns false and no crypto operations are possible.
 */
export function clearSessionKeys(): void {
  sessionEncryptionKey = null
  sessionHmacKey = null
}

/** Returns true if both keys are present (vault is unlocked and ready for use). */
export function isUnlocked(): boolean {
  return sessionEncryptionKey !== null && sessionHmacKey !== null
}
