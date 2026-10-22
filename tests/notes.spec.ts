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
  type NoteContent,
} from '@/lib/notes'
import { encryptEntry, decryptEntry } from '@/lib/crypto'

const NOTE: NoteContent = {
  title: 'Wi-Fi',
  body: 'SSID: home\nPassword: hunter2\n\n  indented line',
  colour: 'green',
  pinned: true,
  lined: true,
}

describe('encodeNote / decodeNote', () => {
  it('round-trips title, body, colour and pinned, line breaks kept', () => {
    expect(decodeNote(encodeNote(NOTE))).toEqual(NOTE)
  })

  it('marks the body format as plain for the 2.2 conversion', () => {
    expect(JSON.parse(encodeNote(NOTE))).toMatchObject({ v: 1, format: 'plain' })
  })

  it('accepts a title and body exactly at the caps', () => {
    const atCap = { ...NOTE, title: 't'.repeat(NOTE_TITLE_MAX), body: 'b'.repeat(NOTE_BODY_MAX) }
    expect(decodeNote(encodeNote(atCap))).toEqual(atCap)
  })

  it('rejects an over-length title or body on encode', () => {
    expect(() => encodeNote({ ...NOTE, title: 't'.repeat(NOTE_TITLE_MAX + 1) })).toThrow()
    expect(() => encodeNote({ ...NOTE, body: 'b'.repeat(NOTE_BODY_MAX + 1) })).toThrow()
  })

  it('rejects an over-length title or body on decode', () => {
    const long = JSON.stringify({ v: 1, format: 'plain', title: 't'.repeat(NOTE_TITLE_MAX + 1), body: '', colour: 'yellow', pinned: false })
    expect(() => decodeNote(long)).toThrow()
  })

  it('rejects malformed or unknown-format blobs', () => {
    expect(() => decodeNote('null')).toThrow()
    expect(() => decodeNote('"text"')).toThrow()
    expect(() => decodeNote('not json')).toThrow()
    expect(() => decodeNote(JSON.stringify({ v: 2, format: 'plain', title: '', body: '', colour: 'yellow', pinned: false }))).toThrow()
    expect(() => decodeNote(JSON.stringify({ v: 1, format: 'rich', title: '', body: '', colour: 'yellow', pinned: false }))).toThrow()
    expect(() => decodeNote(JSON.stringify({ v: 1, format: 'plain', title: 1, body: '', colour: 'yellow', pinned: false }))).toThrow()
  })

  it('falls back to yellow for an unknown colour', () => {
    const blob = JSON.stringify({ v: 1, format: 'plain', title: '', body: '', colour: 'purple', pinned: false })
    expect(decodeNote(blob).colour).toBe('yellow')
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
