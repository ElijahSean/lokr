/**
 * lib/crypto.ts — All cryptographic operations
 *
 * This is the single source of truth for Lokr's security primitives.
 * Do NOT scatter crypto logic across components — it all lives here.
 *
 * Cryptographic design:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Master Password + Salt                                     │
 * │         │                                                   │
 * │         ▼  Argon2id (64 bytes output)                       │
 * │  ┌──────────────────┐  ┌──────────────────┐                │
 * │  │  Bytes 0–31      │  │  Bytes 32–63     │                │
 * │  │  AES-256-GCM key │  │  HMAC-SHA256 key │                │
 * │  └──────────────────┘  └──────────────────┘                │
 * │         │                       │                           │
 * │         ▼                       ▼                           │
 * │  Encrypt/decrypt          Sign/verify                       │
 * │  individual entries       entire vault                      │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Primitives:
 *   Key derivation:  Argon2id (memory-hard, side-channel resistant)
 *   Symmetric enc:   AES-256-GCM (authenticated — detects tampering)
 *   Integrity MAC:   HMAC-SHA256 (signs the encrypted vault as a whole)
 *   Randomness:      crypto.getRandomValues() (browser CSPRNG, never Math.random())
 */

// ─── Argon2 Loader ────────────────────────────────────────────────────────────

/**
 * Lazily imports argon2-browser only in the browser environment.
 * Next.js runs some code server-side during build — argon2 uses WebAssembly
 * and must never be loaded in a Node.js context.
 */
async function loadArgon2() {
  // Dynamic import defers module evaluation until this function is called
  const mod = await import('argon2-browser')
  // Handle both CommonJS default export and ESM named exports
  return (mod.default ?? mod) as typeof import('argon2-browser')
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ARGON2_TIME_COST    = 3      // Iterations — higher means slower, harder to brute-force
const ARGON2_MEMORY_COST  = 65536  // 64 MiB — makes GPU/ASIC attacks expensive
const ARGON2_PARALLELISM  = 1      // Single thread (browser constraint)
const ARGON2_HASH_LENGTH  = 64     // 64 bytes output (split: 32 AES + 32 HMAC)
const IV_BYTE_LENGTH      = 12     // 96-bit GCM IV — NIST recommended size
const SALT_BYTE_LENGTH    = 16     // 128-bit Argon2 salt

// ─── Types ────────────────────────────────────────────────────────────────────

/** Both keys derived from a single Argon2id call — never stored, only in memory. */
export interface DerivedKeys {
  encryptionKey: CryptoKey  // AES-256-GCM — encrypts/decrypts individual vault entries
  hmacKey: CryptoKey        // HMAC-SHA256 — signs/verifies the whole encrypted vault
}

/** The output of encrypting a plaintext string. Both fields are base64-encoded. */
export interface EncryptedData {
  ciphertext: string  // AES-GCM authenticated ciphertext
  iv: string          // Initialization vector (must be stored alongside ciphertext)
}

// ─── Key Derivation ───────────────────────────────────────────────────────────

/**
 * Derives two non-extractable CryptoKeys from the master password + salt using Argon2id.
 *
 * Why Argon2id?
 *  - Memory-hard: requires 64 MiB of RAM per attempt → makes GPU attacks ~1000x more expensive
 *  - Side-channel resistant: 'id' variant combines Argon2i and Argon2d protections
 *  - Takes ~1–2 seconds intentionally — attackers face the same delay per guess
 *
 * Why split 64 bytes into two keys?
 *  - Domain separation: using separate key material for AES and HMAC prevents
 *    interactions between the two operations (cryptographic best practice)
 *  - Both keys are non-extractable — the browser will never expose the raw bytes to JS
 *
 * @param masterPassword - The user's master password (never stored)
 * @param salt - 128-bit random salt from vault_meta (stored, not secret)
 */
export async function deriveKeys(
  masterPassword: string,
  salt: Uint8Array
): Promise<DerivedKeys> {
  const argon2 = await loadArgon2()

  // This is the intentionally slow step — ~1–2 seconds by design
  const result = await argon2.hash({
    pass: masterPassword,
    salt,
    type: argon2.ArgonType.Argon2id,
    hashLen: ARGON2_HASH_LENGTH,
    time: ARGON2_TIME_COST,
    mem: ARGON2_MEMORY_COST,
    parallelism: ARGON2_PARALLELISM,
  })

  const keyMaterial = result.hash as Uint8Array  // 64 raw bytes

  // Split the 64-byte output: first half for AES, second half for HMAC
  const aesBytes  = keyMaterial.slice(0, 32)
  const hmacBytes = keyMaterial.slice(32, 64)

  // Import as non-extractable CryptoKey objects.
  // 'false' (non-extractable) = the raw bytes can never be read back via Web Crypto API.
  // This is a defense-in-depth measure: even if an attacker has code execution,
  // they can't easily dump the key bytes.
  const encryptionKey = await crypto.subtle.importKey(
    'raw',
    aesBytes,
    { name: 'AES-GCM' },
    false,                  // non-extractable
    ['encrypt', 'decrypt']
  )

  const hmacKey = await crypto.subtle.importKey(
    'raw',
    hmacBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,                  // non-extractable
    ['sign', 'verify']
  )

  // The non-extractable CryptoKeys now hold the key material internally —
  // wipe the raw bytes so they don't linger in JS heap until GC.
  keyMaterial.fill(0)
  aesBytes.fill(0)
  hmacBytes.fill(0)

  return { encryptionKey, hmacKey }
}

// ─── Salt Generation ──────────────────────────────────────────────────────────

/**
 * Generates a 128-bit cryptographically random salt for Argon2.
 *
 * The salt ensures that even if two users pick the same master password,
 * their derived keys will be completely different.
 * Called ONCE during first-time vault setup; stored in vault_meta.
 *
 * Never use Math.random() for cryptographic purposes — it's not a CSPRNG.
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH))
}

// ─── Encryption ───────────────────────────────────────────────────────────────

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * AES-GCM is an authenticated encryption scheme — it provides both:
 *   - Confidentiality: the ciphertext reveals nothing about the plaintext
 *   - Integrity: if the ciphertext is tampered with, decryption throws an error
 *
 * A FRESH 96-bit IV is generated for every single encryption call.
 * NEVER reuse an IV with the same key — GCM IV reuse is catastrophic
 * (it allows an attacker to recover the plaintext of both messages).
 *
 * @param key - The AES-256-GCM key from deriveKeys()
 * @param plaintext - The password or other secret to encrypt
 */
export async function encryptEntry(
  key: CryptoKey,
  plaintext: string
): Promise<EncryptedData> {
  // Generate a unique, random IV for this specific encryption
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH))

  const encoded = new TextEncoder().encode(plaintext)  // String → UTF-8 bytes

  // Cast to ArrayBuffer to satisfy strict TypeScript 5.x BufferSource typing
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    encoded.buffer as ArrayBuffer
  )

  // Store both ciphertext and IV as base64 — IndexedDB can store strings efficiently
  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv),
  }
}

// ─── Decryption ───────────────────────────────────────────────────────────────

/**
 * Decrypts AES-256-GCM ciphertext back to the original plaintext string.
 *
 * GCM authentication: if the ciphertext OR the IV have been modified,
 * crypto.subtle.decrypt() throws a DOMException instead of returning garbage.
 * This makes tampering detectable.
 *
 * @param key - The AES-256-GCM key (must match the one used for encryption)
 * @param ciphertext - Base64-encoded ciphertext from encryptEntry()
 * @param iv - Base64-encoded IV from encryptEntry()
 */
export async function decryptEntry(
  key: CryptoKey,
  ciphertext: string,
  iv: string
): Promise<string> {
  const ciphertextBuffer = base64ToBuffer(ciphertext)
  const ivBuffer         = base64ToBuffer(iv)

  // Cast to ArrayBuffer to satisfy the strict TypeScript 5.x BufferSource type
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer.buffer as ArrayBuffer },
    key,
    ciphertextBuffer.buffer as ArrayBuffer
  )

  return new TextDecoder().decode(plaintextBuffer)  // UTF-8 bytes → String
}

// ─── HMAC Vault Integrity ─────────────────────────────────────────────────────

/**
 * Signs a serialized vault snapshot with HMAC-SHA256.
 *
 * The HMAC acts as a tamper-evident seal over the entire encrypted vault.
 * If someone modifies the IndexedDB data directly (e.g. via browser DevTools),
 * the next unlock will detect the mismatch and warn the user.
 *
 * @param hmacKey - The HMAC-SHA256 key from deriveKeys()
 * @param data - JSON string of the vault entries to sign
 */
export async function signVault(hmacKey: CryptoKey, data: string): Promise<string> {
  const encoded   = new TextEncoder().encode(data)
  const signature = await crypto.subtle.sign('HMAC', hmacKey, encoded)
  return bufferToBase64(signature)
}

/**
 * Verifies that a vault's HMAC signature matches the expected data.
 *
 * Returns false (never throws) if:
 *  - The signature doesn't match (wrong password or tampered data)
 *  - The signature string is malformed
 *
 * @param hmacKey - The HMAC-SHA256 key (derived from the entered master password)
 * @param data - The current JSON string of vault entries
 * @param signature - The stored base64 signature from vault_meta
 */
export async function verifyVault(
  hmacKey: CryptoKey,
  data: string,
  signature: string
): Promise<boolean> {
  try {
    const encoded   = new TextEncoder().encode(data)
    const sigBuffer = base64ToBuffer(signature)
    return await crypto.subtle.verify('HMAC', hmacKey, sigBuffer.buffer as ArrayBuffer, encoded.buffer as ArrayBuffer)
  } catch {
    // Any error (malformed base64, wrong key type, etc.) means invalid
    return false
  }
}

// ─── Base64 Utilities ─────────────────────────────────────────────────────────
// IndexedDB stores strings efficiently. We encode binary data (keys, IVs, ciphertext)
// as base64 for storage and decode them when needed for crypto operations.

/**
 * Converts an ArrayBuffer or Uint8Array to a base64 string.
 * Used when storing encrypted data and IVs in IndexedDB.
 */
export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Converts a base64 string back to a Uint8Array.
 * Used when reading encrypted data from IndexedDB for decryption.
 */
export function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes  = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
