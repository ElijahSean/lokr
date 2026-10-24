/**
 * lib/noteFile.ts — one-note encrypted files and plaintext note imports
 *
 * A .lokrnote has its own password, Argon2id salt and AES-GCM IV. Its HMAC
 * covers the visible format metadata as well as the ciphertext, so a future
 * format version cannot be substituted without the file password. This module
 * has no IndexedDB or DOM access: callers decide when to download or persist.
 */

import {
  base64ToBuffer,
  bufferToBase64,
  decryptEntry,
  deriveKeys,
  encryptEntry,
  generateSalt,
  signVault,
  verifyVault,
} from './crypto'
import {
  decodeNote,
  encodeNote,
  NEW_NOTE_COLOUR,
  NOTE_TITLE_MAX,
  type NoteContent,
} from './notes'
import {
  DEFAULT_NOTE_FONT_FAMILY,
  DEFAULT_NOTE_FONT_SIZE,
  plainTextToDocument,
} from './noteDoc'

export const NOTE_FILE_NAME = 'lokr-note.lokrnote'
export const NOTE_FILE_MAX_BYTES = 100_000
export const NOTE_FILE_PASSWORD_MIN = 12
export const NOTE_IMPORT_ACCEPT = '.lokrnote,.txt,.md,application/json,text/plain,text/markdown'

const NOTE_FILE_FORMAT = 'lokr-note'
const NOTE_FILE_VERSION = 1
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

interface NoteFileUnsignedV1 {
  format: typeof NOTE_FILE_FORMAT
  version: typeof NOTE_FILE_VERSION
  salt: string
  iv: string
  ciphertext: string
}

interface NoteFileV1 extends NoteFileUnsignedV1 {
  signature: string
}

export type NoteImportKind = 'lokrnote' | 'text'

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function payloadFor(file: NoteFileUnsignedV1): string {
  // Key order is part of the signature and intentionally fixed for version 1.
  return JSON.stringify({
    format: file.format,
    version: file.version,
    salt: file.salt,
    iv: file.iv,
    ciphertext: file.ciphertext,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasBase64Bytes(value: unknown, expectedBytes?: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || !BASE64.test(value)) return false
  try {
    const length = base64ToBuffer(value).byteLength
    return expectedBytes === undefined ? length > 0 : length === expectedBytes
  } catch {
    return false
  }
}

function parseEnvelope(content: string): NoteFileV1 {
  assertFileSize(byteLength(content))
  let raw: unknown
  try {
    raw = JSON.parse(content) as unknown
  } catch {
    throw new Error("This isn't a valid Lokr note file.")
  }
  if (!isRecord(raw) || raw.format !== NOTE_FILE_FORMAT) {
    throw new Error("This isn't a valid Lokr note file.")
  }
  if (raw.version !== NOTE_FILE_VERSION) {
    throw new Error('This Lokr note file version is not supported.')
  }
  if (
    !hasBase64Bytes(raw.salt, 16) ||
    !hasBase64Bytes(raw.iv, 12) ||
    !hasBase64Bytes(raw.ciphertext) ||
    !hasBase64Bytes(raw.signature, 32)
  ) {
    throw new Error("This isn't a valid Lokr note file.")
  }
  return raw as unknown as NoteFileV1
}

export function assertFileSize(size: number): void {
  if (!Number.isFinite(size) || size < 0 || size > NOTE_FILE_MAX_BYTES) {
    throw new Error('Note files must be 100 KB or smaller.')
  }
}

export function validateNoteFilePasswords(password: string, confirmation: string): string | null {
  if (password.length < NOTE_FILE_PASSWORD_MIN) {
    return `File password must be at least ${NOTE_FILE_PASSWORD_MIN} characters.`
  }
  if (password !== confirmation) return 'File passwords do not match.'
  return null
}

/** Creates the complete JSON file; the caller downloads it with NOTE_FILE_NAME. */
export async function createNoteFile(content: NoteContent, password: string): Promise<string> {
  if (password.length < NOTE_FILE_PASSWORD_MIN) {
    throw new Error(`File password must be at least ${NOTE_FILE_PASSWORD_MIN} characters.`)
  }

  const salt = generateSalt()
  const { encryptionKey, hmacKey } = await deriveKeys(password, salt)
  const encrypted = await encryptEntry(encryptionKey, encodeNote(content))
  const unsigned: NoteFileUnsignedV1 = {
    format: NOTE_FILE_FORMAT,
    version: NOTE_FILE_VERSION,
    salt: bufferToBase64(salt),
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
  }
  const file: NoteFileV1 = {
    ...unsigned,
    signature: await signVault(hmacKey, payloadFor(unsigned)),
  }
  const json = JSON.stringify(file, null, 2)
  assertFileSize(byteLength(json))
  return json
}

/** Authenticates, decrypts and schema-sanitises a .lokrnote without writing it. */
export async function openNoteFile(content: string, password: string): Promise<NoteContent> {
  const file = parseEnvelope(content)
  const salt = base64ToBuffer(file.salt)
  const { encryptionKey, hmacKey } = await deriveKeys(password, salt)
  if (!await verifyVault(hmacKey, payloadFor(file), file.signature)) {
    throw new Error('Incorrect file password or damaged note file.')
  }
  try {
    return decodeNote(await decryptEntry(encryptionKey, file.ciphertext, file.iv))
  } catch {
    throw new Error('The encrypted note contents are invalid.')
  }
}

/** Extension checks are authoritative; an input's accept attribute is only a hint. */
export function noteImportKind(filename: string): NoteImportKind {
  if (/\.lokrnote$/i.test(filename)) return 'lokrnote'
  if (/\.(txt|md)$/i.test(filename)) return 'text'
  throw new Error('Choose a .lokrnote, .txt or .md file.')
}

/** Strict UTF-8 import: invalid bytes are refused instead of silently replaced. */
export function noteFromTextFile(filename: string, bytes: Uint8Array): NoteContent {
  if (noteImportKind(filename) !== 'text') {
    throw new Error('Choose a .txt or .md file.')
  }
  assertFileSize(bytes.byteLength)

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Text note files must use UTF-8 encoding.')
  }

  const title = filename.replace(/\.(txt|md)$/i, '').slice(0, NOTE_TITLE_MAX)
  const note: NoteContent = {
    title,
    body: plainTextToDocument(text),
    fontFamily: DEFAULT_NOTE_FONT_FAMILY,
    fontSize: DEFAULT_NOTE_FONT_SIZE,
    colour: NEW_NOTE_COLOUR,
    pinned: false,
    lined: false,
  }
  // The same storage boundary validates title, body and formatted-blob caps.
  encodeNote(note)
  return note
}
