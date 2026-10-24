/**
 * tests/vaultPayload.spec.ts — the signed vault payload (lib/vaultPayload.ts)
 *
 * The literal strings below are the pre-2.1 payload format. If one of these
 * specs fails, every existing vault would fail its HMAC check on unlock.
 */
import { describe, it, expect } from 'vitest'
import { buildVaultPayload, buildVaultPayloadWithPictures } from '@/lib/vaultPayload'
import type { NotePicture, VaultEntry, StickyNote } from '@/lib/db'

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

const PICTURE: NotePicture = {
  id: 1,
  noteId: 1,
  ciphertext: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]).buffer,
  iv: new Uint8Array(12).fill(7).buffer,
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

describe('buildVaultPayloadWithPictures', () => {
  it('keeps the historical payload byte-for-byte when no pictures exist', async () => {
    await expect(buildVaultPayloadWithPictures(SALT, [ENTRY], [NOTE], [])).resolves.toBe(
      buildVaultPayload(SALT, [ENTRY], [NOTE]),
    )
  })

  it('signs a compact ciphertext hash, IV and note relationship', async () => {
    const payload = await buildVaultPayloadWithPictures(SALT, [ENTRY], [NOTE], [PICTURE])
    const parsed = JSON.parse(payload) as { pictures: Array<Record<string, unknown>> }
    expect(parsed.pictures).toHaveLength(1)
    expect(parsed.pictures[0]).toMatchObject({ id: 1, noteId: 1 })
    expect(parsed.pictures[0].iv).toBe('BwcHBwcHBwcHBwcH')
    expect(typeof parsed.pictures[0].ciphertextSha256).toBe('string')
    expect(payload).not.toContain('"ciphertext":')
  })

  it('changes for ciphertext, IV, relationship, addition and deletion', async () => {
    const changedCiphertext = { ...PICTURE, ciphertext: PICTURE.ciphertext.slice(0) }
    new Uint8Array(changedCiphertext.ciphertext)[0] ^= 1
    const changedIv = { ...PICTURE, iv: PICTURE.iv.slice(0) }
    new Uint8Array(changedIv.iv)[0] ^= 1
    const second = { ...PICTURE, id: 2 }
    const payloads = await Promise.all([
      buildVaultPayloadWithPictures(SALT, [ENTRY], [NOTE], [PICTURE]),
      buildVaultPayloadWithPictures(SALT, [ENTRY], [NOTE], [changedCiphertext]),
      buildVaultPayloadWithPictures(SALT, [ENTRY], [NOTE], [changedIv]),
      buildVaultPayloadWithPictures(SALT, [ENTRY], [{ ...NOTE, id: 2 }], [{ ...PICTURE, noteId: 2 }]),
      buildVaultPayloadWithPictures(SALT, [ENTRY], [NOTE], [PICTURE, second]),
      buildVaultPayloadWithPictures(SALT, [ENTRY], [NOTE], []),
    ])
    expect(new Set(payloads).size).toBe(payloads.length)
  })

  it('refuses malformed or orphaned stored picture records', async () => {
    await expect(buildVaultPayloadWithPictures(SALT, [ENTRY], [NOTE], [
      { ...PICTURE, noteId: 99 },
    ])).rejects.toThrow('tampered')
    await expect(buildVaultPayloadWithPictures(SALT, [ENTRY], [NOTE], [
      { ...PICTURE, iv: new Uint8Array(11).buffer },
    ])).rejects.toThrow('tampered')
  })
})
