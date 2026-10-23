/**
 * lib/notes.ts — the plaintext shape of a sticky note, before encryption
 *
 * A note's title, body, colour and pinned flag are serialised together into one
 * JSON string, which is then encrypted as a single AES-256-GCM blob with
 * encryptEntry (lib/crypto.ts). Encrypting them together hides the colour and
 * pin as well as the text ("Only ciphertext goes into IndexedDB").
 *
 * Pure: no Dexie, no crypto, so it is unit-tested under Node (tests/notes.spec.ts).
 */

export const NOTE_TITLE_MAX = 200
export const NOTE_BODY_MAX  = 20_000

// The five pastels, then the neutral papers (task 2.8). Order is the colour row's.
export const NOTE_COLOURS = ['yellow', 'green', 'blue', 'pink', 'orange', 'white', 'grey', 'black'] as const
export type NoteColour = typeof NOTE_COLOURS[number]
// A new note starts white (Elijah, 2026-10-23)...
export const NEW_NOTE_COLOUR: NoteColour = 'white'
// ...but a stored colour this copy doesn't know still opens yellow, as before 2.8
export const FALLBACK_NOTE_COLOUR: NoteColour = 'yellow'

/** A decrypted note's content. Lives in React state only, never persisted. */
export interface NoteContent {
  title: string
  body: string
  colour: NoteColour
  pinned: boolean
  lined: boolean   // notebook-paper ruled lines, a per-note look
}

/**
 * The JSON inside the ciphertext. `format` tells task 2.2 (rich text) that this
 * body is plain text to convert, instead of guessing from its shape.
 */
interface NoteBlobV1 extends NoteContent {
  v: 1
  format: 'plain'
}

function isNoteColour(value: unknown): value is NoteColour {
  return typeof value === 'string' && (NOTE_COLOURS as readonly string[]).includes(value)
}

/** Throws if title or body is over its cap; the form enforces the same caps with maxLength. */
export function encodeNote(content: NoteContent): string {
  if (content.title.length > NOTE_TITLE_MAX) {
    throw new Error(`Title is over ${NOTE_TITLE_MAX} characters.`)
  }
  if (content.body.length > NOTE_BODY_MAX) {
    throw new Error(`Body is over ${NOTE_BODY_MAX.toLocaleString('en-US')} characters.`)
  }
  const blob: NoteBlobV1 = {
    v: 1,
    format: 'plain',
    title: content.title,
    body: content.body,
    colour: isNoteColour(content.colour) ? content.colour : FALLBACK_NOTE_COLOUR,
    pinned: content.pinned,
    lined: content.lined,
  }
  return JSON.stringify(blob)
}

/** Throws on anything that is not a well-formed version 1 note blob. */
export function decodeNote(json: string): NoteContent {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Not a note.')
  }
  const blob = parsed as Record<string, unknown>
  if (blob.v !== 1 || blob.format !== 'plain') {
    throw new Error('Unsupported note format.')
  }
  if (typeof blob.title !== 'string' || typeof blob.body !== 'string' || typeof blob.pinned !== 'boolean') {
    throw new Error('Malformed note.')
  }
  if (blob.title.length > NOTE_TITLE_MAX || blob.body.length > NOTE_BODY_MAX) {
    throw new Error('Note is over the size limit.')
  }
  return {
    title: blob.title,
    body: blob.body,
    // An unknown colour is cosmetic, not tampering (the HMAC covers that): fall back.
    colour: isNoteColour(blob.colour) ? blob.colour : FALLBACK_NOTE_COLOUR,
    pinned: blob.pinned,
    // Cosmetic and optional, so a blob without it reads as unlined
    lined: blob.lined === true,
  }
}

/** Grid order: pinned notes first, then the most recently edited. */
export function compareNotes(
  a: { pinned: boolean; updatedAt: Date },
  b: { pinned: boolean; updatedAt: Date },
): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return b.updatedAt.getTime() - a.updatedAt.getTime()
}

/** Case-insensitive search over the decrypted title and body. */
export function noteMatches(content: NoteContent, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return content.title.toLowerCase().includes(q) || content.body.toLowerCase().includes(q)
}
