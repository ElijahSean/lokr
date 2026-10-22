/**
 * lib/db.ts — IndexedDB schema and database instance
 *
 * Lokr uses IndexedDB (via Dexie.js) as its storage layer.
 * IndexedDB is the browser's built-in key-value store for large structured data.
 * Dexie wraps IndexedDB with a clean Promise-based API and TypeScript support.
 *
 * IMPORTANT: Every password stored here is encrypted AES-256-GCM ciphertext.
 * Plaintext passwords NEVER touch IndexedDB.
 *
 * Database name: "LokrDB"
 * Tables:
 *   - vault_entries: The encrypted password records
 *   - vault_meta:    One record holding the Argon2 salt and vault HMAC signature
 *   - health_flags:  Cached security analysis per entry (strength, duplicates, age)
 *   - password_history: Encrypted previous passwords per entry
 *   - sticky_notes:  Encrypted free-standing notes (title, body, colour, pin as one blob)
 */

import Dexie, { type Table } from 'dexie'

// ─── Types ────────────────────────────────────────────────────────────────────
// These interfaces describe the shape of each record stored in IndexedDB.
// Export them so they can be imported in components and lib files.

/** A single password record in the vault. Passwords are always encrypted. */
export interface VaultEntry {
  id?: number             // Auto-incremented primary key (Dexie assigns this)
  site: string            // Website or service name, e.g. "github.com"
  username: string        // Login identifier, e.g. "john@example.com"
  encryptedPassword: string  // AES-256-GCM ciphertext, base64-encoded
  iv: string              // AES-GCM initialization vector, base64-encoded
                          // Must be unique per entry — reuse breaks GCM security
  notes?: string          // LEGACY plaintext notes — migrated to encryptedNotes on
                          // first vault load after upgrade; never written anymore
  encryptedNotes?: string // AES-256-GCM ciphertext of the notes field, base64-encoded
  notesIv?: string        // IV for encryptedNotes — fresh random value per save
  encryptedRecoveryCodes?: string // AES-256-GCM ciphertext of newline-separated
                                  // 2FA recovery/backup codes, base64-encoded
  recoveryCodesIv?: string        // IV for encryptedRecoveryCodes
  createdAt: Date         // Timestamp of creation — used for age warnings
  updatedAt: Date         // Timestamp of last edit — used for age warnings
  entryType?: 'password' | 'pin'  // undefined treated as 'password' for backward compat
}

/** One entry in a vault entry's password change history. Always encrypted. */
export interface PasswordHistory {
  id?: number
  entryId: number         // Foreign key → VaultEntry.id
  encryptedPassword: string
  iv: string
  replacedAt: Date        // When this password was replaced by a newer one
}

/**
 * A sticky note. Title, body, colour and pinned are serialised together
 * (lib/notes.ts) and encrypted as ONE AES-256-GCM blob, so none of them is
 * readable in IndexedDB. Timestamps stay plaintext, as on vault entries.
 */
export interface StickyNote {
  id?: number
  encryptedNote: string   // AES-256-GCM ciphertext of the note JSON, base64-encoded
  iv: string              // Fresh random IV on every save
  createdAt: Date
  updatedAt: Date
}

/**
 * Vault metadata — there is exactly ONE of these records (id = 1).
 * It holds the Argon2 salt and the vault's integrity signature.
 */
export interface VaultMeta {
  id?: number             // Always 1
  salt: string            // 128-bit Argon2 salt, base64-encoded
                          // Generated once on first run; never changes
  lastBackupAt?: Date     // When the user last exported a .vault file
  hmacSignature?: string  // HMAC-SHA256 over the serialized encrypted vault
                          // Updated after every write; verified on every unlock
  failedAttempts?: number // Consecutive failed unlock attempts (0 after success).
                          // Persisted here so a new tab doesn't reset the counter.
  lastFailedAt?: Date     // Most recent failed unlock — drives the timed lockout
}

/**
 * Cached security health data per vault entry.
 * Computed in the background and stored here to avoid re-decrypting on every render.
 */
export interface HealthFlag {
  entryId: number                                  // Foreign key → VaultEntry.id
  strength: 'weak' | 'fair' | 'good' | 'strong'  // Password strength label
  strengthScore: number                            // 0–100 numeric score
  isDuplicate: boolean                             // True if shared with another entry
  ageWarning: boolean                              // True if not updated in 90+ days
}

// ─── Database Class ───────────────────────────────────────────────────────────

class LokrDatabase extends Dexie {
  vault_entries!:    Table<VaultEntry>
  vault_meta!:       Table<VaultMeta>
  health_flags!:     Table<HealthFlag>
  password_history!: Table<PasswordHistory>
  sticky_notes!:     Table<StickyNote>

  constructor() {
    super('LokrDB')

    /**
     * Schema version 1.
     *
     * The string after each table name defines which properties are INDEXED.
     * Non-indexed properties are still stored — they just can't be queried efficiently.
     *
     * Syntax:
     *   ++id    — auto-incrementing primary key
     *   site    — indexed (allows fast lookup by site name)
     *   entryId — indexed (allows fast lookup by foreign key)
     */
    this.version(1).stores({
      vault_entries: '++id, site, username, createdAt, updatedAt',
      vault_meta: '++id',
      health_flags: 'entryId',
    })

    this.version(2).stores({
      vault_entries: '++id, site, username, createdAt, updatedAt',
      vault_meta: '++id',
      health_flags: 'entryId',
      password_history: '++id, entryId, replacedAt',
    })

    // Version 3 (task 2.1) adds sticky_notes. Adding a table needs no upgrade()
    // function: a version-2 database gains an empty store and keeps its data.
    // Only plaintext timestamps are indexed; everything else is in the blob.
    this.version(3).stores({
      vault_entries: '++id, site, username, createdAt, updatedAt',
      vault_meta: '++id',
      health_flags: 'entryId',
      password_history: '++id, entryId, replacedAt',
      sticky_notes: '++id, updatedAt',
    })
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────
// Export a single shared database instance.
// Import this 'db' object in any file that needs to read or write vault data.
// Never instantiate LokrDatabase directly elsewhere.
export const db = new LokrDatabase()

// ─── Sticky Notes ─────────────────────────────────────────────────────────────
// Notes go through these helpers, not Dexie in components (CLAUDE.md: all DB
// operations through lib/db.ts). Callers pass ciphertext only and must call
// updateVaultSignature() after every write, or the next unlock fails.

export async function listStickyNotes(): Promise<StickyNote[]> {
  return db.sticky_notes.orderBy('id').toArray()
}

export async function countStickyNotes(): Promise<number> {
  return db.sticky_notes.count()
}

/** Returns the new note's id. */
export async function addStickyNote(encryptedNote: string, iv: string): Promise<number> {
  const now = new Date()
  return (await db.sticky_notes.add({ encryptedNote, iv, createdAt: now, updatedAt: now })) as number
}

export async function updateStickyNote(id: number, encryptedNote: string, iv: string): Promise<void> {
  await db.sticky_notes.update(id, { encryptedNote, iv, updatedAt: new Date() })
}

export async function deleteStickyNote(id: number): Promise<void> {
  await db.sticky_notes.delete(id)
}

export async function clearStickyNotes(): Promise<void> {
  await db.sticky_notes.clear()
}
