/**
 * lib/notes.ts — the plaintext shape of a sticky note, before encryption
 *
 * A note's title, rich body, font, size, colour and pinned flag are serialised together into one
 * JSON string, which is then encrypted as a single AES-256-GCM blob with
 * encryptEntry (lib/crypto.ts). Encrypting them together hides the colour and
 * pin as well as the text ("Only ciphertext goes into IndexedDB").
 *
 * Pure: no Dexie, no crypto, so it is unit-tested under Node (tests/notes.spec.ts).
 */

import {
  DEFAULT_NOTE_FONT_FAMILY,
  DEFAULT_NOTE_FONT_SIZE,
  NOTE_TEXT_MAX,
  assertDocumentTextLimit,
  documentToPlainText,
  isNoteFontFamily,
  isNoteFontSize,
  plainTextToDocument,
  sanitizeNoteDocument,
  type NoteDocument,
  type NoteFontFamily,
  type NoteFontSize,
} from './noteDoc'

export const NOTE_TITLE_MAX = 200
export const NOTE_BLOB_MAX_BYTES = 256 * 1024

// Kept as the public cap name used by the note view and older tests.
export const NOTE_BODY_MAX = NOTE_TEXT_MAX

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
  body: NoteDocument
  fontFamily: NoteFontFamily
  fontSize: NoteFontSize
  colour: NoteColour
  pinned: boolean
  lined: boolean   // notebook-paper ruled lines, a per-note look
}

/**
 * The current JSON inside the ciphertext. decodeNote also accepts task 2.1's
 * version-1 plain body and converts it in memory without guessing its shape.
 */
interface NoteBlobV2 extends NoteContent {
  v: 2
  format: 'rich'
}

function isNoteColour(value: unknown): value is NoteColour {
  return typeof value === 'string' && (NOTE_COLOURS as readonly string[]).includes(value)
}

/** Throws if title or body is over its cap; the form enforces the same caps with maxLength. */
export function encodeNote(content: NoteContent): string {
  if (content.title.length > NOTE_TITLE_MAX) {
    throw new Error(`Title is over ${NOTE_TITLE_MAX} characters.`)
  }
  const body = sanitizeNoteDocument(content.body)
  assertDocumentTextLimit(body)
  const blob: NoteBlobV2 = {
    v: 2,
    format: 'rich',
    title: content.title,
    body,
    fontFamily: isNoteFontFamily(content.fontFamily) ? content.fontFamily : DEFAULT_NOTE_FONT_FAMILY,
    fontSize: isNoteFontSize(content.fontSize) ? content.fontSize : DEFAULT_NOTE_FONT_SIZE,
    colour: isNoteColour(content.colour) ? content.colour : FALLBACK_NOTE_COLOUR,
    pinned: content.pinned,
    lined: content.lined,
  }
  const json = JSON.stringify(blob)
  if (new TextEncoder().encode(json).byteLength > NOTE_BLOB_MAX_BYTES) {
    throw new Error('Formatted note is over the 256 KB size limit.')
  }
  return json
}

/** Decodes legacy plain or current rich blobs; throws when the encrypted contents are malformed. */
export function decodeNote(json: string): NoteContent {
  if (new TextEncoder().encode(json).byteLength > NOTE_BLOB_MAX_BYTES) {
    throw new Error('Note is over the size limit.')
  }
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Not a note.')
  }
  const blob = parsed as Record<string, unknown>
  if (typeof blob.title !== 'string' || typeof blob.pinned !== 'boolean') {
    throw new Error('Malformed note.')
  }
  if (blob.title.length > NOTE_TITLE_MAX) {
    throw new Error('Note is over the size limit.')
  }
  let body: NoteDocument
  let fontFamily = DEFAULT_NOTE_FONT_FAMILY
  let fontSize = DEFAULT_NOTE_FONT_SIZE
  if (blob.v === 1 && blob.format === 'plain' && typeof blob.body === 'string') {
    body = plainTextToDocument(blob.body)
  } else if (blob.v === 2 && blob.format === 'rich') {
    body = sanitizeNoteDocument(blob.body)
    fontFamily = isNoteFontFamily(blob.fontFamily) ? blob.fontFamily : DEFAULT_NOTE_FONT_FAMILY
    fontSize = isNoteFontSize(blob.fontSize) ? blob.fontSize : DEFAULT_NOTE_FONT_SIZE
  } else {
    throw new Error('Unsupported note format.')
  }
  assertDocumentTextLimit(body)
  return {
    title: blob.title,
    body,
    fontFamily,
    fontSize,
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
  return content.title.toLowerCase().includes(q) || documentToPlainText(content.body).toLowerCase().includes(q)
}
