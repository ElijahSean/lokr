/**
 * lib/backupPayload.ts — the exact strings versioned .vault files sign
 *
 * Backup files need password history, but the at-rest vault HMAC deliberately
 * has a byte-for-byte compatibility promise in lib/vaultPayload.ts. Keeping the
 * two payloads separate lets old vaults and version-1 backups keep verifying.
 */

import type { PasswordHistory, StickyNote, VaultEntry } from './db'

/** Dates are Date objects during export and ISO strings after JSON.parse. */
type BackupDate = Date | string

/** Version 2 requires a source ID so history can be remapped after restore. */
export type BackupEntry = Omit<VaultEntry, 'id' | 'createdAt' | 'updatedAt'> & {
  id: number
  createdAt: BackupDate
  updatedAt: BackupDate
}

/** History-row IDs are local implementation details and are not exported. */
export type BackupHistory = Pick<PasswordHistory, 'entryId' | 'encryptedPassword' | 'iv'> & {
  replacedAt: BackupDate
}

/** Version 3 includes source IDs so restored notes can be re-signed under new IDs. */
export type BackupNote = Omit<StickyNote, 'id' | 'createdAt' | 'updatedAt'> & {
  id: number
  createdAt: BackupDate
  updatedAt: BackupDate
}

export function buildBackupPayloadV2(
  salt: string,
  entries: readonly BackupEntry[],
  history: readonly BackupHistory[],
): string {
  // Key order is part of the signed bytes: version, salt, entries, history.
  return JSON.stringify({ version: 2, salt, entries, history })
}

export function buildBackupPayloadV3(
  salt: string,
  entries: readonly BackupEntry[],
  history: readonly BackupHistory[],
  notes: readonly BackupNote[],
): string {
  // Key order is part of the signed bytes: version, salt, entries, history, notes.
  return JSON.stringify({ version: 3, salt, entries, history, notes })
}
