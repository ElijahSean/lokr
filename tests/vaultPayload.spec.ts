/**
 * tests/vaultPayload.spec.ts — the signed vault payload (lib/vaultPayload.ts)
 *
 * The literal strings below are the pre-2.1 payload format. If one of these
 * specs fails, every existing vault would fail its HMAC check on unlock.
 */
import { describe, it, expect } from 'vitest'
import { buildVaultPayload } from '@/lib/vaultPayload'
import type { VaultEntry, StickyNote } from '@/lib/db'

const SALT = 'c2FsdHNhbHRzYWx0c2FsdA=='

const ENTRY: VaultEntry = {
  id: 1,
  site: 'example.com',
  username: 'alice',
  encryptedPassword: 'Y2lwaGVy',
  iv: 'aXZpdml2aXZpdml2',
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  updatedAt: new Date('2026-01-02T03:04:05.000Z'),
}

const NOTE: StickyNote = {
  id: 1,
  encryptedNote: 'bm90ZWNpcGhlcg==',
  iv: 'bm90ZWl2bm90ZWl2',
  createdAt: new Date('2026-02-03T04:05:06.000Z'),
  updatedAt: new Date('2026-02-03T04:05:06.000Z'),
}

describe('buildVaultPayload', () => {
  it('gives the pre-2.1 string for an empty vault with no notes', () => {
    expect(buildVaultPayload(SALT, [])).toBe(`{"version":1,"salt":"${SALT}","entries":[]}`)
    expect(buildVaultPayload(SALT, [], [])).toBe(`{"version":1,"salt":"${SALT}","entries":[]}`)
  })

  it('gives the pre-2.1 string for a vault with entries and no notes', () => {
    expect(buildVaultPayload(SALT, [ENTRY], [])).toBe(
      `{"version":1,"salt":"${SALT}","entries":[{"id":1,"site":"example.com","username":"alice",` +
      `"encryptedPassword":"Y2lwaGVy","iv":"aXZpdml2aXZpdml2",` +
      `"createdAt":"2026-01-02T03:04:05.000Z","updatedAt":"2026-01-02T03:04:05.000Z"}]}`,
    )
    // Same as the inline expression the five call sites used before 2.1
    expect(buildVaultPayload(SALT, [ENTRY])).toBe(JSON.stringify({ version: 1, salt: SALT, entries: [ENTRY] }))
  })

  it('appends notes after entries when there is at least one', () => {
    const withNote = buildVaultPayload(SALT, [ENTRY], [NOTE])
    expect(withNote).not.toBe(buildVaultPayload(SALT, [ENTRY]))
    expect(withNote.startsWith(`{"version":1,"salt":"${SALT}","entries":[`)).toBe(true)
    expect(withNote).toContain(`,"notes":[{"id":1,"encryptedNote":"bm90ZWNpcGhlcg=="`)
  })

  it('changes when any note changes, is added or is removed', () => {
    const base = buildVaultPayload(SALT, [], [NOTE])
    const edited = buildVaultPayload(SALT, [], [{ ...NOTE, encryptedNote: 'bm90ZWNpcGhlcw==' }])
    const added = buildVaultPayload(SALT, [], [NOTE, { ...NOTE, id: 2 }])
    const removedAll = buildVaultPayload(SALT, [], [])
    expect(new Set([base, edited, added, removedAll]).size).toBe(4)
  })

  it('is deterministic for the same input', () => {
    expect(buildVaultPayload(SALT, [ENTRY], [NOTE])).toBe(buildVaultPayload(SALT, [{ ...ENTRY }], [{ ...NOTE }]))
  })
})
