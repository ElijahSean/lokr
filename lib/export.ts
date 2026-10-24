/**
 * lib/export.ts — Vault export and import
 *
 * Lokr supports two backup formats:
 *
 *  1. .vault file (encrypted backup)
 *     - JSON envelope containing encrypted entries, history, notes, pictures + Argon2 salt
 *     - HMAC-SHA256 signed to detect corruption or tampering
 *     - Safe to store anywhere — decryption requires the master password
 *     - File extension: .vault, filename: lokr-backup.vault
 *
 *  2. .csv files (plaintext export — DANGEROUS)
 *     - Credentials and sticky notes download separately to preserve manager compatibility
 *     - Note CSV contains only a picture count, never picture bytes
 *     - Passwords and note contents are in PLAINTEXT
 *     - Requires explicit "CONFIRM" text input before export is enabled
 *     - Should be deleted immediately after use (e.g. importing into another manager)
 *     - File extension: .csv, filename: lokr-export.csv
 *
 * Import supports only .vault files — CSV import is intentionally unsupported
 * to reduce the attack surface of the import path.
 */

import { db, type VaultEntry } from './db'
import {
  signVault,
  verifyVault,
  decryptEntry,
  decryptBytes,
  deriveKeys,
  base64ToBuffer,
  bufferToBase64,
} from './crypto'
import { buildVaultPayload, buildVaultPayloadWithPictures } from './vaultPayload'
import {
  buildBackupPayloadV2,
  buildBackupPayloadV3,
  buildBackupPayloadV4,
  type BackupEntry,
  type BackupHistory,
  type BackupNote,
  type BackupPicture,
} from './backupPayload'
import { decodeNote } from './notes'
import { documentToPlainText } from './noteDoc'
import { NOTE_PICTURE_LIMIT, assertPictureSize, sniffPictureType } from './pictures'

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

/** Version 3 adds encrypted sticky notes to the signed backup envelope. */
interface VaultFileV3 {
  version: 3
  salt: string
  entries: BackupEntry[]
  history: BackupHistory[]
  notes: BackupNote[]
  signature: string
}

/** Version 4 adds encrypted picture attachments related by source note ID. */
interface VaultFileV4 {
  version: 4
  salt: string
  entries: BackupEntry[]
  history: BackupHistory[]
  notes: BackupNote[]
  pictures: BackupPicture[]
  signature: string
}

type VaultFile = VaultFileV1 | VaultFileV2 | VaultFileV3 | VaultFileV4

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

function isNote(value: unknown): boolean {
  return isRecord(value) &&
    Number.isInteger(value.id) &&
    Number(value.id) > 0 &&
    typeof value.encryptedNote === 'string' &&
    typeof value.iv === 'string' &&
    isIsoDate(value.createdAt) &&
    isIsoDate(value.updatedAt)
}

function isPicture(value: unknown): boolean {
  return isRecord(value) &&
    Number.isInteger(value.id) &&
    Number(value.id) > 0 &&
    Number.isInteger(value.noteId) &&
    Number(value.noteId) > 0 &&
    typeof value.ciphertext === 'string' &&
    typeof value.iv === 'string'
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

function validateNoteIds(notes: BackupNote[]): void {
  const noteIds = new Set<number>()
  for (const note of notes) {
    if (noteIds.has(note.id)) {
      throw new Error('Invalid .vault file: duplicate note IDs.')
    }
    noteIds.add(note.id)
  }
}

function validatePictureRelationships(notes: BackupNote[], pictures: BackupPicture[]): void {
  const noteIds = new Set(notes.map(note => note.id))
  const pictureIds = new Set<number>()
  const counts = new Map<number, number>()
  for (const picture of pictures) {
    if (pictureIds.has(picture.id)) {
      throw new Error('Invalid .vault file: duplicate picture IDs.')
    }
    pictureIds.add(picture.id)
    if (!noteIds.has(picture.noteId)) {
      throw new Error('Invalid .vault file: picture references a missing note.')
    }
    const count = (counts.get(picture.noteId) ?? 0) + 1
    if (count > NOTE_PICTURE_LIMIT) {
      throw new Error(`Invalid .vault file: a note has more than ${NOTE_PICTURE_LIMIT} pictures.`)
    }
    counts.set(picture.noteId, count)
  }
}

// ─── Export: Encrypted .vault ─────────────────────────────────────────────────

/**
 * Exports entries, password history, sticky notes and pictures as a .vault file.
 *
 * Entries, history, notes and pictures stay encrypted — this function bundles them with the
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
  const storedNotes = await db.sticky_notes.orderBy('id').toArray()
  const storedPictures = await db.note_pictures.orderBy('id').toArray()

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

  const notes: BackupNote[] = storedNotes.map(note => {
    if (typeof note.id !== 'number') {
      throw new Error('Cannot export a sticky note without an ID.')
    }
    return { ...note, id: note.id }
  })

  const pictures: BackupPicture[] = storedPictures.map(picture => {
    if (typeof picture.id !== 'number') {
      throw new Error('Cannot export a note picture without an ID.')
    }
    return {
      id: picture.id,
      noteId: picture.noteId,
      ciphertext: bufferToBase64(picture.ciphertext),
      iv: bufferToBase64(picture.iv),
    }
  })
  validatePictureRelationships(notes, pictures)

  const payload: Omit<VaultFileV4, 'signature'> = {
    version: 4,
    salt: saltB64,
    entries,
    history,
    notes,
    pictures,
  }

  // The versioned backup payload is separate from the byte-compatible at-rest
  // payload. Every encrypted note/picture and source relationship is signed.
  const payloadJson = buildBackupPayloadV4(
    payload.salt,
    payload.entries,
    payload.history,
    payload.notes,
    payload.pictures,
  )
  const signature   = await signVault(hmacKey, payloadJson)

  // The full file is payload + signature
  const vaultFile: VaultFileV4 = { ...payload, signature }

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
  noteCount: number         // Number of sticky notes restored
  pictureCount: number      // Number of encrypted picture attachments restored
  encryptionKey: CryptoKey  // Keys derived from the FILE's salt — the caller must
  hmacKey: CryptoKey        // adopt these as the new session keys
  lastBackupAt: Date        // Exact timestamp retained or established by restore
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
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== 3 && raw.version !== 4) {
    throw new Error(`Unsupported vault version: ${String(raw.version)}. Expected: 1, 2, 3 or 4`)
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
  if (!raw.entries.every(entry => isEntry(entry, raw.version !== 1))) {
    throw new Error('Invalid .vault file: malformed entry data.')
  }
  if (raw.version !== 1 && (!Array.isArray(raw.history) || !raw.history.every(isHistory))) {
    throw new Error('Invalid .vault file: malformed password history.')
  }
  if ((raw.version === 3 || raw.version === 4) && (!Array.isArray(raw.notes) || !raw.notes.every(isNote))) {
    throw new Error('Invalid .vault file: malformed sticky notes.')
  }
  if (raw.version === 4 && (!Array.isArray(raw.pictures) || !raw.pictures.every(isPicture))) {
    throw new Error('Invalid .vault file: malformed note pictures.')
  }

  const parsed = raw as unknown as VaultFile
  const { version, salt, entries, signature } = parsed
  const history = version === 1 ? [] : parsed.history
  const notes = version === 3 || version === 4 ? parsed.notes : []
  const pictures = version === 4 ? parsed.pictures : []

  // Derive keys from the file's own salt — slow (Argon2id, ~1–2s) by design
  const { encryptionKey, hmacKey } = await deriveKeys(
    masterPassword,
    base64ToBuffer(salt)
  )

  // Each old version keeps its exact historical bytes. Version 3 signs notes;
  // older files cannot use an unsigned extra field to inject them.
  const payload = version === 1
    ? buildVaultPayload(salt, entries)
    : version === 2
      ? buildBackupPayloadV2(salt, entries, history)
      : version === 3
        ? buildBackupPayloadV3(salt, entries, history, notes)
        : buildBackupPayloadV4(salt, entries, history, notes, pictures)
  const isValid = await verifyVault(hmacKey, payload, signature)

  if (!isValid) {
    throw new Error(
      'Vault integrity check failed. Wrong master password or corrupted file.'
    )
  }

  if (version !== 1) {
    validateHistoryRelationships(entries, history)
  }
  if (version === 3 || version === 4) validateNoteIds(notes)
  if (version === 4) validatePictureRelationships(notes, pictures)

  // Belt-and-braces: prove the AES key actually decrypts the data before
  // we destroy the current vault.
  if (entries.length > 0) {
    try {
      await decryptEntry(encryptionKey, entries[0].encryptedPassword, entries[0].iv)
    } catch {
      throw new Error('Backup entries could not be decrypted with this password.')
    }
  }

  // Prove every note ciphertext is decryptable and contains a supported note
  // document before replacing any local data.
  try {
    for (const note of notes) {
      decodeNote(await decryptEntry(encryptionKey, note.encryptedNote, note.iv))
    }
  } catch {
    throw new Error('Backup notes could not be decrypted with this password.')
  }

  // Refuse signed-but-invalid image ciphertext before replacing local data.
  try {
    for (const picture of pictures) {
      const ciphertext = base64ToBuffer(picture.ciphertext)
      const iv = base64ToBuffer(picture.iv)
      if (iv.byteLength !== 12) throw new Error('Invalid picture IV.')
      const bytes = await decryptBytes(
        encryptionKey,
        ciphertext.buffer as ArrayBuffer,
        iv.buffer as ArrayBuffer,
      )
      assertPictureSize(bytes.byteLength)
      sniffPictureType(bytes)
    }
  } catch {
    throw new Error('Backup pictures could not be decrypted with this password.')
  }

  // Preserve truthful local backup history only after untrusted input passes
  // every fail-closed check; a fresh destination knows of this restored backup now.
  const previousMeta = await db.vault_meta.get(1)
  const lastBackupAt = previousMeta?.lastBackupAt ?? new Date()

  // Replace local data only after every structural, HMAC and AES check above.
  await db.vault_entries.clear()
  await db.health_flags.clear()
  await db.password_history.clear()
  await db.sticky_notes.clear()
  await db.note_pictures.clear()

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
    if (version !== 1 && typeof e.id === 'number') entryIdMap.set(e.id, newId)
  }

  if (version !== 1 && history.length > 0) {
    await db.password_history.bulkAdd(history.map(row => ({
      entryId: entryIdMap.get(row.entryId)!,
      encryptedPassword: row.encryptedPassword,
      iv: row.iv,
      replacedAt: new Date(row.replacedAt),
    })))
  }

  const noteIdMap = new Map<number, number>()
  if ((version === 3 || version === 4) && notes.length > 0) {
    for (const note of notes) {
      const newId = await db.sticky_notes.add({
        encryptedNote: note.encryptedNote,
        iv: note.iv,
        createdAt: new Date(note.createdAt),
        updatedAt: new Date(note.updatedAt),
      }) as number
      noteIdMap.set(note.id, newId)
    }
  }

  if (version === 4 && pictures.length > 0) {
    await db.note_pictures.bulkAdd(pictures.map(picture => ({
      noteId: noteIdMap.get(picture.noteId)!,
      ciphertext: base64ToBuffer(picture.ciphertext).buffer as ArrayBuffer,
      iv: base64ToBuffer(picture.iv).buffer as ArrayBuffer,
    })))
  }

  // Re-sign under the entries as actually stored (restore assigned new IDs,
  // so the file's signature no longer matches the local state).
  const stored       = await db.vault_entries.orderBy('id').toArray()
  const storedNotes  = await db.sticky_notes.orderBy('id').toArray()
  const storedPictures = await db.note_pictures.orderBy('id').toArray()
  const newPayload   = await buildVaultPayloadWithPictures(salt, stored, storedNotes, storedPictures)
  const newSignature = await signVault(hmacKey, newPayload)

  await db.vault_meta.put({
    id: 1,
    salt,
    hmacSignature: newSignature,
    failedAttempts: 0,
    lastBackupAt,
  })

  return {
    count: entries.length,
    noteCount: notes.length,
    pictureCount: pictures.length,
    encryptionKey,
    hmacKey,
    lastBackupAt,
  }
}

// ─── Export: Plaintext CSV ────────────────────────────────────────────────────

/**
 * Builds the password-manager-compatible plaintext credentials CSV.
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
export async function buildEntriesCSV(encKey: CryptoKey): Promise<string> {
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

  return rows.join('\n')
}

/** Builds a separate plaintext notes CSV so credential importers stay compatible. */
export async function buildNotesCSV(encKey: CryptoKey): Promise<string> {
  const notes = await db.sticky_notes.orderBy('id').toArray()
  const rows = ['title,body,colour,pinned,picture_count,created_at,updated_at']

  for (const note of notes) {
    const content = decodeNote(await decryptEntry(encKey, note.encryptedNote, note.iv))
    const pictureCount = typeof note.id === 'number'
      ? await db.note_pictures.where('noteId').equals(note.id).count()
      : 0
    rows.push([
      escapeCsv(content.title),
      escapeCsv(documentToPlainText(content.body)),
      escapeCsv(content.colour),
      escapeCsv(String(content.pinned)),
      escapeCsv(String(pictureCount)),
      escapeCsv(note.createdAt.toISOString()),
      escapeCsv(note.updatedAt.toISOString()),
    ].join(','))
  }

  return rows.join('\n')
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** Downloads credentials only; the UI's typed CONFIRM gate must precede this. */
export async function exportCSV(encKey: CryptoKey): Promise<void> {
  downloadCsv(await buildEntriesCSV(encKey), 'lokr-export.csv')
}

/** Downloads sticky notes separately behind the same typed CONFIRM gate. */
export async function exportNotesCSV(encKey: CryptoKey): Promise<void> {
  downloadCsv(await buildNotesCSV(encKey), 'lokr-notes-export.csv')
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
