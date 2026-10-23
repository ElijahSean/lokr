/**
 * tests/notes.spec.ts — sticky-note blob encode/decode, caps, order and search (lib/notes.ts)
 */
import { describe, it, expect } from 'vitest'
import {
  encodeNote,
  decodeNote,
  compareNotes,
  noteMatches,
  NOTE_TITLE_MAX,
  NOTE_BODY_MAX,
  NOTE_BLOB_MAX_BYTES,
  NOTE_COLOURS,
  NEW_NOTE_COLOUR,
  FALLBACK_NOTE_COLOUR,
  type NoteContent,
} from '@/lib/notes'
import { plainTextToDocument } from '@/lib/noteDoc'
import { encryptEntry, decryptEntry } from '@/lib/crypto'

const NOTE: NoteContent = {
  title: 'Wi-Fi',
  body: plainTextToDocument('SSID: home\nPassword: hunter2\n\n  indented line'),
  fontFamily: 'sans',
  fontSize: 'normal',
  colour: 'green',
  pinned: true,
  lined: true,
}

describe('encodeNote / decodeNote', () => {
  it('round-trips rich content and presentation fields', () => {
    expect(decodeNote(encodeNote(NOTE))).toEqual(NOTE)
  })

  it('writes the version 2 rich format', () => {
    expect(JSON.parse(encodeNote(NOTE))).toMatchObject({ v: 2, format: 'rich' })
  })

  it('accepts a title and body exactly at the caps', () => {
    const atCap = { ...NOTE, title: 't'.repeat(NOTE_TITLE_MAX), body: plainTextToDocument('b'.repeat(NOTE_BODY_MAX)) }
    expect(decodeNote(encodeNote(atCap))).toEqual(atCap)
  })

  it('rejects an over-length title or body on encode', () => {
    expect(() => encodeNote({ ...NOTE, title: 't'.repeat(NOTE_TITLE_MAX + 1) })).toThrow()
    expect(() => encodeNote({ ...NOTE, body: plainTextToDocument('b'.repeat(NOTE_BODY_MAX + 1)) })).toThrow()
  })

  it('rejects an over-length title or body on decode', () => {
    const long = JSON.stringify({ v: 1, format: 'plain', title: 't'.repeat(NOTE_TITLE_MAX + 1), body: '', colour: 'yellow', pinned: false })
    expect(() => decodeNote(long)).toThrow()
  })

  it('rejects malformed or unknown-format blobs', () => {
    expect(() => decodeNote('null')).toThrow()
    expect(() => decodeNote('"text"')).toThrow()
    expect(() => decodeNote('not json')).toThrow()
    expect(() => decodeNote(JSON.stringify({ v: 3, format: 'rich', title: '', body: {}, colour: 'yellow', pinned: false }))).toThrow()
    expect(() => decodeNote(JSON.stringify({ v: 2, format: 'rich', title: '', body: null, colour: 'yellow', pinned: false }))).toThrow()
    expect(() => decodeNote(JSON.stringify({ v: 1, format: 'plain', title: 1, body: '', colour: 'yellow', pinned: false }))).toThrow()
  })

  it('converts a 2.1 plain blob in memory and applies presentation defaults', () => {
    const legacy = JSON.stringify({
      v: 1,
      format: 'plain',
      title: 'Old note',
      body: 'first\n\nlast',
      colour: 'blue',
      pinned: false,
      lined: true,
    })
    const decoded = decodeNote(legacy)
    expect(decoded.body).toEqual(plainTextToDocument('first\n\nlast'))
    expect(decoded.fontFamily).toBe('sans')
    expect(decoded.fontSize).toBe('normal')
    expect(JSON.parse(encodeNote(decoded))).toMatchObject({ v: 2, format: 'rich' })
  })

  it('falls back to safe presentation values in a rich blob', () => {
    const blob = JSON.stringify({
      ...JSON.parse(encodeNote(NOTE)),
      fontFamily: 'remote-web-font',
      fontSize: 'enormous',
    })
    expect(decodeNote(blob)).toMatchObject({ fontFamily: 'sans', fontSize: 'normal' })
  })

  it('refuses a formatted blob over 256 KiB even below the text cap', () => {
    const body = { type: 'doc' as const, content: Array.from({ length: 13_000 }, () => ({ type: 'paragraph' })) }
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeGreaterThan(NOTE_BLOB_MAX_BYTES)
    expect(() => encodeNote({ ...NOTE, body })).toThrow('256 KB')
  })

  it('falls back to yellow for an unknown colour', () => {
    const blob = JSON.stringify({ v: 1, format: 'plain', title: '', body: '', colour: 'purple', pinned: false })
    expect(decodeNote(blob).colour).toBe('yellow')
    expect(FALLBACK_NOTE_COLOUR).toBe('yellow')
  })

  // Task 2.8: the neutral papers, after the five pastels
  it('round-trips the white, grey and black papers', () => {
    for (const colour of ['white', 'grey', 'black'] as const) {
      expect(decodeNote(encodeNote({ ...NOTE, colour })).colour).toBe(colour)
    }
  })

  it('lists the pastels first, then white, grey and black', () => {
    expect(NOTE_COLOURS).toEqual(['yellow', 'green', 'blue', 'pink', 'orange', 'white', 'grey', 'black'])
  })

  it('starts a new note on white, apart from the yellow fallback', () => {
    expect(NEW_NOTE_COLOUR).toBe('white')
  })

  it('reads a blob without the lined flag as unlined', () => {
    const blob = JSON.stringify({ v: 1, format: 'plain', title: '', body: '', colour: 'yellow', pinned: false })
    expect(decodeNote(blob).lined).toBe(false)
  })

  it('round-trips through AES-GCM with a fresh IV each save', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const first = await encryptEntry(key, encodeNote(NOTE))
    const second = await encryptEntry(key, encodeNote(NOTE))
    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(first.ciphertext).not.toContain('Wi-Fi')
    expect(first.ciphertext).not.toContain('hunter2')
    expect(decodeNote(await decryptEntry(key, first.ciphertext, first.iv))).toEqual(NOTE)
  })
})

describe('compareNotes', () => {
  it('puts pinned notes first, then the most recently edited', () => {
    const notes = [
      { id: 'old', pinned: false, updatedAt: new Date('2026-01-01') },
      { id: 'pinnedOld', pinned: true, updatedAt: new Date('2025-01-01') },
      { id: 'new', pinned: false, updatedAt: new Date('2026-06-01') },
      { id: 'pinnedNew', pinned: true, updatedAt: new Date('2026-03-01') },
    ]
    expect([...notes].sort(compareNotes).map(n => n.id)).toEqual(['pinnedNew', 'pinnedOld', 'new', 'old'])
  })
})

describe('noteMatches', () => {
  it('matches title or body, case-insensitive', () => {
    expect(noteMatches(NOTE, 'wi-fi')).toBe(true)
    expect(noteMatches(NOTE, 'HUNTER2')).toBe(true)
    expect(noteMatches(NOTE, 'router')).toBe(false)
    expect(noteMatches(NOTE, '   ')).toBe(true)
  })
})
