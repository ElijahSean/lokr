/**
 * tests/db.spec.ts — database-wide operations in lib/db.ts
 *
 * fake-indexeddb runs the real Dexie singleton so transaction commit and
 * rollback behavior match the browser storage boundary.
 */
import 'fake-indexeddb/auto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllVaultData, db } from '@/lib/db'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterAll(async () => {
  await db.delete()
})

async function seedEveryTable(): Promise<void> {
  const entryId = await db.vault_entries.add({
    site: 'example.test',
    username: 'alice',
    encryptedPassword: 'Y2lwaGVydGV4dA==',
    iv: 'aXY=',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  }) as number

  await db.health_flags.add({
    entryId,
    strength: 'good',
    strengthScore: 75,
    isDuplicate: false,
    ageWarning: false,
  })
  await db.password_history.add({
    entryId,
    encryptedPassword: 'aGlzdG9yeQ==',
    iv: 'aGlzdG9yeS1pdg==',
    replacedAt: new Date('2026-01-01T12:00:00.000Z'),
  })
  await db.sticky_notes.add({
    encryptedNote: 'bm90ZQ==',
    iv: 'bm90ZS1pdg==',
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    updatedAt: new Date('2026-01-04T00:00:00.000Z'),
  })
  await db.vault_meta.put({
    id: 1,
    salt: 'c2FsdA==',
    hmacSignature: 'c2lnbmF0dXJl',
    failedAttempts: 2,
    lastFailedAt: new Date('2026-01-05T00:00:00.000Z'),
    lastBackupAt: new Date('2026-01-06T00:00:00.000Z'),
  })
}

async function databaseSnapshot(): Promise<string> {
  return JSON.stringify({
    entries: await db.vault_entries.orderBy('id').toArray(),
    health: await db.health_flags.orderBy('entryId').toArray(),
    history: await db.password_history.orderBy('id').toArray(),
    notes: await db.sticky_notes.orderBy('id').toArray(),
    meta: await db.vault_meta.orderBy('id').toArray(),
  })
}

describe('clearAllVaultData', () => {
  it('clears every table in one successful reset', async () => {
    await seedEveryTable()

    await clearAllVaultData()

    expect({
      entries: await db.vault_entries.count(),
      health: await db.health_flags.count(),
      history: await db.password_history.count(),
      notes: await db.sticky_notes.count(),
      meta: await db.vault_meta.count(),
    }).toEqual({ entries: 0, health: 0, history: 0, notes: 0, meta: 0 })
  })

  it('rolls back every table when a middle clear fails', async () => {
    await seedEveryTable()
    const before = await databaseSnapshot()
    const clearHistory = vi.spyOn(db.password_history, 'clear')
      .mockRejectedValueOnce(new Error('forced reset failure'))

    await expect(clearAllVaultData()).rejects.toThrow('forced reset failure')
    clearHistory.mockRestore()

    expect(await databaseSnapshot()).toBe(before)
  })
})
