/**
 * lib/export.ts — Vault export and import
 *
 * Lokr supports two backup formats:
 *
 *  1. .vault file (encrypted backup)
 *     - JSON envelope containing encrypted entries, password history + Argon2 salt
 *     - HMAC-SHA256 signed to detect corruption or tampering
 *     - Safe to store anywhere — decryption requires the master password
 *     - File extension: .vault, filename: lokr-backup.vault
 *
 *  2. .csv file (plaintext export — DANGEROUS)
 *     - Standard CSV with headers: site, username, password, notes, recovery_codes
 *     - Passwords are in PLAINTEXT — anyone who opens this file sees all passwords
 *     - Requires explicit "CONFIRM" text input before export is enabled
 *     - Should be deleted immediately after use (e.g. importing into another manager)
 *     - File extension: .csv, filename: lokr-export.csv
 *
 * Import supports only .vault files — CSV import is intentionally unsupported
 * to reduce the attack surface of the import path.
 */

import { db, clearStickyNotes, type VaultEntry } from './db'
import { signVault, verifyVault, decryptEntry, deriveKeys, base64ToBuffer } from './crypto'
import { buildVaultPayload } from './vaultPayload'
import {
  buildBackupPayloadV2,
  type BackupEntry,
  type BackupHistory,
} from './backupPayload'

// ─── .vault File Format ───────────────────────────────────────────────────────

/** The structure of a .vault backup file (after JSON.parse) */
interface VaultFileV1 {
  version: 1
  salt: string            // Base64 Argon2 salt — needed to re-derive the key on import
  entries: VaultEntry[]   // All encrypted entries (passwords remain encrypted)
  signature: string       // HMAC-SHA256 over { version, salt, entries }
}

/** Version 2 adds encrypted password history to the signed backup envelope. */
interface VaultFileV2 {
  version: 2
  salt: string
  entries: BackupEntry[]
  history: BackupHistory[]
  signature: string
}

type VaultFile = VaultFileV1 | VaultFileV2

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isEntry(value: unknown, requireId: boolean): boolean {
  if (!isRecord(value)) return false
  if (
    typeof value.site !== 'string' ||
    typeof value.username !== 'string' ||
    typeof value.encryptedPassword !== 'string' ||
    typeof value.iv !== 'string' ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt)
  ) {
    return false
  }
  if (requireId && (!Number.isInteger(value.id) || Number(value.id) < 1)) return false

  for (const field of ['notes', 'encryptedNotes', 'notesIv', 'encryptedRecoveryCodes', 'recoveryCodesIv']) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return false
  }
  return value.entryType === undefined || value.entryType === 'password' || value.entryType === 'pin'
}

function isHistory(value: unknown): boolean {
  return isRecord(value) &&
    Number.isInteger(value.entryId) &&
    Number(value.entryId) > 0 &&
    typeof value.encryptedPassword === 'string' &&
    typeof value.iv === 'string' &&
    isIsoDate(value.replacedAt)
}

/** Relationships are checked after HMAC verification so signed-data edits get the integrity error. */
function validateHistoryRelationships(entries: BackupEntry[], history: BackupHistory[]): void {
  const entryIds = new Set<number>()
  for (const entry of entries) {
    if (entryIds.has(entry.id)) {
      throw new Error('Invalid .vault file: duplicate entry IDs.')
    }
    entryIds.add(entry.id)
  }
  if (history.some(row => !entryIds.has(row.entryId))) {
    throw new Error('Invalid .vault file: password history references a missing entry.')
  }
}

// ─── Export: Encrypted .vault ─────────────────────────────────────────────────

/**
 * Exports entries and password history as an encrypted .vault file.
 *
 * Entries and history stay encrypted — this function bundles them with the
 * salt and signs the bundle. The master password is NOT included.
 *
 * To restore: user provides the .vault file + the same master password.
 * The salt is in the file; the password is in the user's head.
 *
 * @param hmacKey - HMAC-SHA256 key to sign the export
 * @param saltB64 - Base64 Argon2 salt from vault_meta
 */
export async function exportVaultFile(
  hmacKey: CryptoKey,
  saltB64: string
): Promise<string> {
  // Load ciphertext in stable ID order so identical state has identical signed bytes.
  const storedEntries = await db.vault_entries.orderBy('id').toArray()
  const storedHistory = await db.password_history.orderBy('id').toArray()

  const entries: BackupEntry[] = storedEntries.map(entry => {
    if (typeof entry.id !== 'number') {
      throw new Error('Cannot export a vault entry without an ID.')
    }
    return { ...entry, id: entry.id }
  })
  const entryIds = new Set(entries.map(entry => entry.id))
  const history: BackupHistory[] = storedHistory.map(row => {
    if (!entryIds.has(row.entryId)) {
      throw new Error('Cannot export password history for a missing entry.')
    }
    return {
      entryId: row.entryId,
      encryptedPassword: row.encryptedPassword,
      iv: row.iv,
      replacedAt: row.replacedAt,
    }
  })

  const payload: Omit<VaultFileV2, 'signature'> = {
    version: 2,
    salt: saltB64,
    entries,
    history,
  }

  // Sticky notes remain outside backups until task 2.3. History is signed here
  // without changing the at-rest buildVaultPayload compatibility contract.
  const payloadJson = buildBackupPayloadV2(payload.salt, payload.entries, payload.history)
  const signature   = await signVault(hmacKey, payloadJson)

  // The full file is payload + signature
  const vaultFile: VaultFileV2 = { ...payload, signature }

  return JSON.stringify(vaultFile, null, 2)  // Pretty-print for human readability
}

/**
 * Triggers a browser download of the encrypted .vault file.
 * Updates vault_meta.lastBackupAt on success.
 */
export async function downloadVaultFile(
  hmacKey: CryptoKey,
  saltB64: string
): Promise<void> {
  const content  = await exportVaultFile(hmacKey, saltB64)
  const blob     = new Blob([content], { type: 'application/json' })
  const url      = URL.createObjectURL(blob)
  const link     = document.createElement('a')
  link.href      = url
  link.download  = 'lokr-backup.vault'
  link.click()
  URL.revokeObjectURL(url)  // Release the object URL to free memory

  // Record the backup timestamp
  await db.vault_meta.update(1, { lastBackupAt: new Date() })
}

// ─── Import: Encrypted .vault ─────────────────────────────────────────────────

/** What a successful restore hands back to the caller. */
export interface RestoreResult {
  count: number             // Number of entries restored
  encryptionKey: CryptoKey  // Keys derived from the FILE's salt — the caller must
  hmacKey: CryptoKey        // adopt these as the new session keys
}

/**
 * Restores a .vault file, replacing the local vault entirely.
 *
 * The backup carries its own Argon2 salt, so keys are derived from the
 * FILE's salt + the master password the user enters — NOT from the current
 * session keys. This is what makes cross-device / post-reset restore work:
 * the backup can come from a vault with a different salt (or even a
 * different master password) than the one currently unlocked.
 *
 * Safety properties:
 *  - HMAC is verified with the file-derived key BEFORE any data is written
 *  - If verification fails, the local vault is unchanged
 *  - After the replace, the vault is RE-SIGNED under the new entries and
 *    their new IDs — without this, the next unlock would fail verification
 *  - The caller must install the returned keys via adoptSessionKeys()
 *
 * @param masterPassword - The master password the backup was created with
 * @param fileContent - Raw text content of the .vault file
 */
export async function restoreVaultFile(
  masterPassword: string,
  fileContent: string
): Promise<RestoreResult> {
  let raw: unknown

  try {
    raw = JSON.parse(fileContent) as unknown
  } catch {
    throw new Error('Invalid .vault file: not valid JSON.')
  }

  if (!isRecord(raw)) {
    throw new Error('Invalid .vault file: missing required fields.')
  }
  if (raw.version !== 1 && raw.version !== 2) {
    throw new Error(`Unsupported vault version: ${String(raw.version)}. Expected: 1 or 2`)
  }
  if (
    typeof raw.salt !== 'string' ||
    raw.salt.length === 0 ||
    !Array.isArray(raw.entries) ||
    typeof raw.signature !== 'string' ||
    raw.signature.length === 0
  ) {
    throw new Error('Invalid .vault file: missing required fields.')
  }
  if (!raw.entries.every(entry => isEntry(entry, raw.version === 2))) {
    throw new Error('Invalid .vault file: malformed entry data.')
  }
  if (raw.version === 2 && (!Array.isArray(raw.history) || !raw.history.every(isHistory))) {
    throw new Error('Invalid .vault file: malformed password history.')
  }

  const parsed = raw as unknown as VaultFile
  const { version, salt, entries, signature } = parsed
  const history = version === 2 ? parsed.history : []

  // Derive keys from the file's own salt — slow (Argon2id, ~1–2s) by design
  const { encryptionKey, hmacKey } = await deriveKeys(
    masterPassword,
    base64ToBuffer(salt)
  )

  // Version 1 keeps its exact historical bytes; version 2 additionally signs
  // every history row. Neither path trusts an unsigned extra field.
  const payload = version === 1
    ? buildVaultPayload(salt, entries)
    : buildBackupPayloadV2(salt, entries, history)
  const isValid = await verifyVault(hmacKey, payload, signature)

  if (!isValid) {
    throw new Error(
      'Vault integrity check failed. Wrong master password or corrupted file.'
    )
  }

  if (version === 2) {
    validateHistoryRelationships(entries, history)
  }

  // Belt-and-braces: prove the AES key actually decrypts the data before
  // we destroy the current vault.
  if (entries.length > 0) {
    try {
      await decryptEntry(encryptionKey, entries[0].encryptedPassword, entries[0].iv)
    } catch {
      throw new Error('Backup entries could not be decrypted with this password.')
    }
  }

  // Replace local data only after every structural, HMAC and AES check above.
  // Sticky notes still clear because backups do not carry them until task 2.3.
  await db.vault_entries.clear()
  await db.health_flags.clear()
  await db.password_history.clear()
  await clearStickyNotes()

  const entryIdMap = new Map<number, number>()
  for (const e of entries) {
    const newId = await db.vault_entries.add({
      site:                   e.site,
      username:               e.username,
      encryptedPassword:      e.encryptedPassword,
      iv:                     e.iv,
      notes:                  e.notes,
      encryptedNotes:         e.encryptedNotes,
      notesIv:                e.notesIv,
      encryptedRecoveryCodes: e.encryptedRecoveryCodes,
      recoveryCodesIv:        e.recoveryCodesIv,
      entryType:              e.entryType,
      createdAt:              new Date(e.createdAt),
      updatedAt:              new Date(e.updatedAt),
    }) as number
    if (version === 2 && typeof e.id === 'number') entryIdMap.set(e.id, newId)
  }

  if (version === 2 && history.length > 0) {
    await db.password_history.bulkAdd(history.map(row => ({
      entryId: entryIdMap.get(row.entryId)!,
      encryptedPassword: row.encryptedPassword,
      iv: row.iv,
      replacedAt: new Date(row.replacedAt),
    })))
  }

  // Re-sign under the entries as actually stored (restore assigned new IDs,
  // so the file's signature no longer matches the local state).
  const stored       = await db.vault_entries.orderBy('id').toArray()
  const newPayload   = buildVaultPayload(salt, stored)  // notes table is empty now
  const newSignature = await signVault(hmacKey, newPayload)

  await db.vault_meta.put({
    id: 1,
    salt,
    hmacSignature: newSignature,
    failedAttempts: 0,
  })

  return { count: entries.length, encryptionKey, hmacKey }
}

// ─── Export: Plaintext CSV ────────────────────────────────────────────────────

/**
 * Exports all vault entries as a plaintext CSV file.
 *
 * ⚠️  SECURITY WARNING ⚠️
 * This file contains ALL PASSWORDS IN PLAINTEXT.
 * Anyone who can read this file can access all your accounts.
 * Delete this file immediately after using it.
 *
 * The UI enforces a typed "CONFIRM" confirmation before this function is called.
 * This function should ONLY be called after the user has confirmed the risk.
 *
 * @param encKey - AES-256-GCM key to decrypt passwords for export
 */
export async function exportCSV(encKey: CryptoKey): Promise<void> {
  const entries = await db.vault_entries.orderBy('site').toArray()

  // Build CSV header row
  const rows: string[] = [
    'site,username,password,notes,recovery_codes',  // Standard CSV header (compatible with most managers)
  ]

  for (const entry of entries) {
    // Decrypt this entry's password (and notes / recovery codes, if any) for plaintext export
    const plainPassword = await decryptEntry(encKey, entry.encryptedPassword, entry.iv)
    const plainNotes = entry.encryptedNotes && entry.notesIv
      ? await decryptEntry(encKey, entry.encryptedNotes, entry.notesIv)
      : (entry.notes ?? '')
    const plainCodes = entry.encryptedRecoveryCodes && entry.recoveryCodesIv
      ? await decryptEntry(encKey, entry.encryptedRecoveryCodes, entry.recoveryCodesIv)
      : ''

    // Escape CSV fields: if a field contains a comma, quote, or newline, wrap in quotes
    const csvRow = [
      escapeCsv(entry.site),
      escapeCsv(entry.username),
      escapeCsv(plainPassword),
      escapeCsv(plainNotes),
      escapeCsv(plainCodes),
    ].join(',')

    rows.push(csvRow)
  }

  const csvContent = rows.join('\n')
  const blob       = new Blob([csvContent], { type: 'text/csv' })
  const url        = URL.createObjectURL(blob)
  const link       = document.createElement('a')
  link.href        = url
  link.download    = 'lokr-export.csv'
  link.click()
  URL.revokeObjectURL(url)
}

/** Escapes a single CSV field value by wrapping in quotes if it contains special chars */
function escapeCsv(value: string): string {
  let v = value

  // Neutralize spreadsheet formula injection: Excel/Sheets execute cells that
  // start with = + - @ (or tab/CR) as formulas when the CSV is opened.
  if (/^[=+\-@\t\r]/.test(v)) {
    v = `'${v}`
  }

  // If the value contains a comma, quote, or newline, wrap in double quotes
  if (/[,"\n\r]/.test(v)) {
    // Escape any double quotes inside the value by doubling them (CSV standard)
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}
