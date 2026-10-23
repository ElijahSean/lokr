/**
 * tests/export.spec.ts — encrypted .vault export and restore (lib/export.ts)
 *
 * fake-indexeddb runs the real Dexie singleton under Node. Every test deletes
 * and reopens LokrDB so table state and auto-increment keys cannot leak between
 * cases. Argon2 uses its filesystem branch here for the same reason as
 * tests/argon2.spec.ts: Node's fetch cannot load argon2-browser's local WASM.
 */
import 'fake-indexeddb/auto'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBackupPayloadV2, type BackupEntry, type BackupHistory } from '@/lib/backupPayload'
import {
  base64ToBuffer,
  bufferToBase64,
  decryptEntry,
  deriveKeys,
  encryptEntry,
  signVault,
  verifyVault,
  type DerivedKeys,
} from '@/lib/crypto'
import { db, type VaultEntry } from '@/lib/db'
import { exportVaultFile, restoreVaultFile } from '@/lib/export'
import { buildVaultPayload } from '@/lib/vaultPayload'

const PASSWORD = 'backup test master password'
const WRONG_PASSWORD = 'backup test master passwore'
const SALT = bufferToBase64(new Uint8Array(16).fill(13))
const SLOW = 120_000

interface ParsedVaultV2 {
  version: 2
  salt: string
  entries: BackupEntry[]
  history: BackupHistory[]
  signature: string
}

let keys: DerivedKeys

beforeAll(async () => {
  vi.stubGlobal('fetch', undefined)
  keys = await deriveKeys(PASSWORD, base64ToBuffer(SALT))
}, SLOW)

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterAll(async () => {
  await db.delete()
  vi.unstubAllGlobals()
})

function parseV2(content: string): ParsedVaultV2 {
  return JSON.parse(content) as ParsedVaultV2
}

async function addEncryptedEntry(
  site: string,
  username: string,
  password: string,
  createdAt: Date,
  updatedAt: Date,
  extra: Partial<VaultEntry> = {},
): Promise<number> {
  const encrypted = await encryptEntry(keys.encryptionKey, password)
  return await db.vault_entries.add({
    site,
    username,
    encryptedPassword: encrypted.ciphertext,
    iv: encrypted.iv,
    createdAt,
    updatedAt,
    ...extra,
  }) as number
}

async function seedSourceVault(): Promise<{
  content: string
  entryIds: [number, number]
  historyPlaintext: string[]
}> {
  const note = await encryptEntry(keys.encryptionKey, 'encrypted account note')
  const codes = await encryptEntry(keys.encryptionKey, 'RECOVERY-1\nRECOVERY-2')

  const passwordId = await addEncryptedEntry(
    'example.com',
    'alice@example.com',
    'current-password',
    new Date('2025-01-02T03:04:05.000Z'),
    new Date('2026-02-03T04:05:06.000Z'),
    {
      encryptedNotes: note.ciphertext,
      notesIv: note.iv,
      encryptedRecoveryCodes: codes.ciphertext,
      recoveryCodesIv: codes.iv,
      entryType: 'password',
    },
  )
  const pinId = await addEncryptedEntry(
    'bank.example',
    'alice',
    '482913',
    new Date('2025-05-06T07:08:09.000Z'),
    new Date('2026-06-07T08:09:10.000Z'),
    { entryType: 'pin' },
  )

  const historyPlaintext = ['first-password', 'second-password', '135790']
  const historyCiphertext = await Promise.all(
    historyPlaintext.map(value => encryptEntry(keys.encryptionKey, value)),
  )
  await db.password_history.bulkAdd([
    {
      entryId: passwordId,
      encryptedPassword: historyCiphertext[0].ciphertext,
      iv: historyCiphertext[0].iv,
      replacedAt: new Date('2025-07-01T00:00:00.000Z'),
    },
    {
      entryId: passwordId,
      encryptedPassword: historyCiphertext[1].ciphertext,
      iv: historyCiphertext[1].iv,
      replacedAt: new Date('2025-10-01T00:00:00.000Z'),
    },
    {
      entryId: pinId,
      encryptedPassword: historyCiphertext[2].ciphertext,
      iv: historyCiphertext[2].iv,
      replacedAt: new Date('2025-11-01T00:00:00.000Z'),
    },
  ])

  const entries = await db.vault_entries.orderBy('id').toArray()
  const signature = await signVault(keys.hmacKey, buildVaultPayload(SALT, entries))
  await db.vault_meta.put({ id: 1, salt: SALT, hmacSignature: signature, failedAttempts: 0 })

  return {
    content: await exportVaultFile(keys.hmacKey, SALT),
    entryIds: [passwordId, pinId],
    historyPlaintext,
  }
}

/** Populates every table so a failed restore has something meaningful to preserve. */
async function seedDestinationVault(): Promise<void> {
  await db.vault_entries.clear()
  await db.password_history.clear()
  await db.health_flags.clear()
  await db.sticky_notes.clear()
  await db.vault_meta.clear()

  const entryId = await db.vault_entries.add({
    site: 'local.example',
    username: 'local-user',
    encryptedPassword: 'bG9jYWwtY2lwaGVy',
    iv: 'bG9jYWwtaXY=',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-02-01T00:00:00.000Z'),
  }) as number
  await db.password_history.add({
    entryId,
    encryptedPassword: 'bG9jYWwtaGlzdG9yeQ==',
    iv: 'bG9jYWwtaGlzdG9yeS1pdg==',
    replacedAt: new Date('2024-01-15T00:00:00.000Z'),
  })
  await db.health_flags.put({
    entryId,
    strength: 'fair',
    strengthScore: 42,
    isDuplicate: false,
    ageWarning: true,
  })
  await db.sticky_notes.add({
    encryptedNote: 'bG9jYWwtbm90ZQ==',
    iv: 'bG9jYWwtbm90ZS1pdg==',
    createdAt: new Date('2024-03-01T00:00:00.000Z'),
    updatedAt: new Date('2024-03-02T00:00:00.000Z'),
  })
  await db.vault_meta.put({
    id: 1,
    salt: 'bG9jYWwtc2FsdA==',
    hmacSignature: 'bG9jYWwtc2lnbmF0dXJl',
    failedAttempts: 4,
    lastFailedAt: new Date('2024-04-01T00:00:00.000Z'),
    lastBackupAt: new Date('2024-04-02T00:00:00.000Z'),
  })
}

async function databaseSnapshot(): Promise<string> {
  return JSON.stringify({
    entries: await db.vault_entries.orderBy('id').toArray(),
    history: await db.password_history.orderBy('id').toArray(),
    health: await db.health_flags.orderBy('entryId').toArray(),
    notes: await db.sticky_notes.orderBy('id').toArray(),
    meta: await db.vault_meta.orderBy('id').toArray(),
  })
}

function comparableEntry(entry: VaultEntry | BackupEntry): Record<string, unknown> {
  return {
    site: entry.site,
    username: entry.username,
    encryptedPassword: entry.encryptedPassword,
    iv: entry.iv,
    notes: entry.notes,
    encryptedNotes: entry.encryptedNotes,
    notesIv: entry.notesIv,
    encryptedRecoveryCodes: entry.encryptedRecoveryCodes,
    recoveryCodesIv: entry.recoveryCodesIv,
    entryType: entry.entryType,
    createdAt: new Date(entry.createdAt).toISOString(),
    updatedAt: new Date(entry.updatedAt).toISOString(),
  }
}

describe('version-2 .vault export and restore', () => {
  it('exports only ciphertext and signs password history', async () => {
    const { content } = await seedSourceVault()
    const file = parseV2(content)

    expect(file.version).toBe(2)
    expect(file.history).toHaveLength(3)
    expect(file.history.every(row => !Object.hasOwn(row, 'id'))).toBe(true)
    expect(content).not.toContain('current-password')
    expect(content).not.toContain('encrypted account note')
    expect(content).not.toContain('RECOVERY-1')
    expect(content).not.toContain('first-password')
    expect(await verifyVault(
      keys.hmacKey,
      buildBackupPayloadV2(file.salt, file.entries, file.history),
      file.signature,
    )).toBe(true)
  })

  it('round-trips every entry field and remaps history to new entry IDs', async () => {
    const { content, entryIds, historyPlaintext } = await seedSourceVault()
    const file = parseV2(content)
    await seedDestinationVault() // Advances the key generator before restore clears it.

    const result = await restoreVaultFile(PASSWORD, content)
    const storedEntries = await db.vault_entries.orderBy('id').toArray()
    const storedHistory = await db.password_history.orderBy('id').toArray()

    expect(result.count).toBe(2)
    expect(storedEntries.map(comparableEntry)).toEqual(file.entries.map(comparableEntry))
    expect(storedEntries.map(entry => entry.id)).not.toEqual(entryIds)
    expect(storedHistory).toHaveLength(3)

    const sourceSiteById = new Map(file.entries.map(entry => [entry.id, entry.site]))
    const storedSiteById = new Map(storedEntries.map(entry => [entry.id!, entry.site]))
    expect(storedHistory.map(row => storedSiteById.get(row.entryId))).toEqual(
      file.history.map(row => sourceSiteById.get(row.entryId)),
    )
    expect(storedHistory.map(row => row.replacedAt.toISOString())).toEqual(
      file.history.map(row => new Date(row.replacedAt).toISOString()),
    )

    const restoredHistoryPlaintext = await Promise.all(storedHistory.map(row =>
      decryptEntry(result.encryptionKey, row.encryptedPassword, row.iv),
    ))
    expect(restoredHistoryPlaintext).toEqual(historyPlaintext)

    const currentPlaintext = await Promise.all(storedEntries.map(entry =>
      decryptEntry(result.encryptionKey, entry.encryptedPassword, entry.iv),
    ))
    expect(currentPlaintext).toEqual(['current-password', '482913'])
    expect(await decryptEntry(
      result.encryptionKey,
      storedEntries[0].encryptedNotes!,
      storedEntries[0].notesIv!,
    )).toBe('encrypted account note')
    expect(await decryptEntry(
      result.encryptionKey,
      storedEntries[0].encryptedRecoveryCodes!,
      storedEntries[0].recoveryCodesIv!,
    )).toBe('RECOVERY-1\nRECOVERY-2')

    const meta = await db.vault_meta.get(1)
    expect(meta?.hmacSignature).toBeTruthy()
    expect(meta?.lastBackupAt?.toISOString()).toBe('2024-04-02T00:00:00.000Z')
    expect(result.lastBackupAt.getTime()).toBe(meta?.lastBackupAt?.getTime())
    expect(meta?.failedAttempts).toBe(0)
    expect(meta?.lastFailedAt).toBeUndefined()
    expect(await verifyVault(
      result.hmacKey,
      buildVaultPayload(SALT, storedEntries),
      meta!.hmacSignature!,
    )).toBe(true)
  }, SLOW)

  it('records the restore time when no backup date exists', async () => {
    const { content } = await seedSourceVault()
    const startedAt = Date.now()

    const result = await restoreVaultFile(PASSWORD, content)

    const completedAt = Date.now()
    const meta = await db.vault_meta.get(1)
    const storedTime = meta?.lastBackupAt?.getTime()
    expect(storedTime).toBeGreaterThanOrEqual(startedAt)
    expect(storedTime).toBeLessThanOrEqual(completedAt)
    expect(result.lastBackupAt.getTime()).toBe(storedTime)
  }, SLOW)

  it('restores an old version-1 backup with empty history', async () => {
    await seedSourceVault()
    const entries = await db.vault_entries.orderBy('id').toArray()
    const signature = await signVault(keys.hmacKey, buildVaultPayload(SALT, entries))
    const oldFile = JSON.stringify({ version: 1, salt: SALT, entries, signature })
    await seedDestinationVault()

    const result = await restoreVaultFile(PASSWORD, oldFile)

    expect(result.count).toBe(2)
    expect(await db.password_history.count()).toBe(0)
    expect((await db.vault_entries.orderBy('id').toArray()).map(comparableEntry)).toEqual(
      entries.map(comparableEntry),
    )
  }, SLOW)
})

type TamperCase = {
  name: string
  password?: string
  mutate?: (_file: ParsedVaultV2) => void
}

const TAMPER_CASES: TamperCase[] = [
  {
    name: 'an entry field changes',
    mutate: file => { file.entries[0].username = 'mallory@example.com' },
  },
  {
    name: 'a history field changes',
    mutate: file => { file.history[0].encryptedPassword = 'AAAA' },
  },
  {
    name: 'a history row is deleted',
    mutate: file => { file.history.pop() },
  },
  {
    name: 'a history row is added',
    mutate: file => { file.history.push({ ...file.history[0], iv: 'AAAA' }) },
  },
  {
    name: 'the signature changes',
    mutate: file => { file.signature = 'AAAA' },
  },
  {
    name: 'the password is wrong',
    password: WRONG_PASSWORD,
  },
]

describe('restore rejects untrusted backups before writing', () => {
  it('rejects malformed JSON without changing local data', async () => {
    await seedDestinationVault()
    const before = await databaseSnapshot()

    await expect(restoreVaultFile(PASSWORD, 'not JSON')).rejects.toThrow(
      'Invalid .vault file: not valid JSON.',
    )
    expect(await databaseSnapshot()).toBe(before)
  })

  it.each(TAMPER_CASES)('$name', async ({ password = PASSWORD, mutate }) => {
    const { content } = await seedSourceVault()
    const file = parseV2(content)
    mutate?.(file)
    await seedDestinationVault()
    const before = await databaseSnapshot()

    await expect(restoreVaultFile(password, JSON.stringify(file))).rejects.toThrow(
      'Vault integrity check failed. Wrong master password or corrupted file.',
    )
    expect(await databaseSnapshot()).toBe(before)
  }, SLOW)

  it('rejects signed orphan history before writing', async () => {
    const { content } = await seedSourceVault()
    const file = parseV2(content)
    file.history[0].entryId = 999
    file.signature = await signVault(
      keys.hmacKey,
      buildBackupPayloadV2(file.salt, file.entries, file.history),
    )
    await seedDestinationVault()
    const before = await databaseSnapshot()

    await expect(restoreVaultFile(PASSWORD, JSON.stringify(file))).rejects.toThrow(
      'Invalid .vault file: password history references a missing entry.',
    )
    expect(await databaseSnapshot()).toBe(before)
  }, SLOW)
})
