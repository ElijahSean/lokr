/**
 * lib/noteFile.ts — one-note encrypted files and plaintext note imports
 *
 * A .lokrnote has its own password, Argon2id salt and AES-GCM IVs. Its HMAC
 * covers format metadata, encrypted note and encrypted pictures, so a future
 * format version cannot be substituted without the file password. This module
 * has no IndexedDB or DOM access: callers decide when to download or persist.
 */

import {
  base64ToBuffer,
  bufferToBase64,
  decryptBytes,
  decryptEntry,
  deriveKeys,
  encryptBytes,
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
import {
  NOTE_PICTURE_LIMIT,
  assertPictureSize,
  sniffPictureType,
} from './pictures'

export const NOTE_FILE_NAME = 'lokr-note.lokrnote'
export const NOTE_FILE_MAX_BYTES = 40 * 1024 * 1024
export const NOTE_TEXT_FILE_MAX_BYTES = 100_000
export const NOTE_FILE_PASSWORD_MIN = 12
export const NOTE_IMPORT_ACCEPT = '.lokrnote,.txt,.md,application/json,text/plain,text/markdown'

const NOTE_FILE_FORMAT = 'lokr-note'
const NOTE_FILE_VERSION = 2
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

interface NoteFileUnsignedV1 {
  format: typeof NOTE_FILE_FORMAT
  version: 1
  salt: string
  iv: string
  ciphertext: string
}

interface NoteFileV1 extends NoteFileUnsignedV1 {
  signature: string
}

interface NoteFileEncryptedPart {
  iv: string
  ciphertext: string
}

interface NoteFileUnsignedV2 {
  format: typeof NOTE_FILE_FORMAT
  version: typeof NOTE_FILE_VERSION
  salt: string
  note: NoteFileEncryptedPart
  pictures: NoteFileEncryptedPart[]
}

interface NoteFileV2 extends NoteFileUnsignedV2 {
  signature: string
}

type NoteFile = NoteFileV1 | NoteFileV2

export interface NoteFileContents {
  content: NoteContent
  pictures: Uint8Array[]
}

export type NoteImportKind = 'lokrnote' | 'text'

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function payloadFor(file: NoteFileUnsignedV1 | NoteFileUnsignedV2): string {
  if (file.version === 1) {
    // Key order is part of the signature and intentionally fixed for version 1.
    return JSON.stringify({
      format: file.format,
      version: file.version,
      salt: file.salt,
      iv: file.iv,
      ciphertext: file.ciphertext,
    })
  }
  // Version 2 signs the encrypted note and every encrypted picture in order.
  return JSON.stringify({
    format: file.format,
    version: file.version,
    salt: file.salt,
    note: file.note,
    pictures: file.pictures,
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

function isEncryptedPart(value: unknown): value is NoteFileEncryptedPart {
  return isRecord(value) && hasBase64Bytes(value.iv, 12) && hasBase64Bytes(value.ciphertext)
}

function parseEnvelope(content: string): NoteFile {
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
  if (raw.version !== 1 && raw.version !== NOTE_FILE_VERSION) {
    throw new Error('This Lokr note file version is not supported.')
  }
  if (!hasBase64Bytes(raw.salt, 16) || !hasBase64Bytes(raw.signature, 32)) {
    throw new Error("This isn't a valid Lokr note file.")
  }
  if (raw.version === 1) {
    if (!hasBase64Bytes(raw.iv, 12) || !hasBase64Bytes(raw.ciphertext)) {
      throw new Error("This isn't a valid Lokr note file.")
    }
    return raw as unknown as NoteFileV1
  }
  if (
    !isEncryptedPart(raw.note) ||
    !Array.isArray(raw.pictures) ||
    raw.pictures.length > NOTE_PICTURE_LIMIT ||
    !raw.pictures.every(isEncryptedPart)
  ) {
    throw new Error("This isn't a valid Lokr note file.")
  }
  return raw as unknown as NoteFileV2
}

export function assertFileSize(size: number): void {
  if (!Number.isFinite(size) || size < 0 || size > NOTE_FILE_MAX_BYTES) {
    throw new Error('Lokr note files must be 40 MB or smaller.')
  }
}

export function assertTextFileSize(size: number): void {
  if (!Number.isFinite(size) || size < 0 || size > NOTE_TEXT_FILE_MAX_BYTES) {
    throw new Error('Text note files must be 100 KB or smaller.')
  }
}

export function validateNoteFilePasswords(password: string, confirmation: string): string | null {
  if (password.length < NOTE_FILE_PASSWORD_MIN) {
    return `File password must be at least ${NOTE_FILE_PASSWORD_MIN} characters.`
  }
  if (password !== confirmation) return 'File passwords do not match.'
  return null
}

/** Creates an authenticated version-2 JSON file with encrypted note and pictures. */
export async function createNoteFile(
  content: NoteContent,
  password: string,
  pictures: readonly Uint8Array[] = [],
): Promise<string> {
  if (password.length < NOTE_FILE_PASSWORD_MIN) {
    throw new Error(`File password must be at least ${NOTE_FILE_PASSWORD_MIN} characters.`)
  }
  if (pictures.length > NOTE_PICTURE_LIMIT) {
    throw new Error(`A note can have up to ${NOTE_PICTURE_LIMIT} pictures.`)
  }
  for (const picture of pictures) {
    assertPictureSize(picture.byteLength)
    sniffPictureType(picture)
  }

  const salt = generateSalt()
  const { encryptionKey, hmacKey } = await deriveKeys(password, salt)
  const encryptedNote = await encryptEntry(encryptionKey, encodeNote(content))
  const encryptedPictures = await Promise.all(pictures.map(async picture => {
    const encrypted = await encryptBytes(encryptionKey, picture)
    return {
      iv: bufferToBase64(encrypted.iv),
      ciphertext: bufferToBase64(encrypted.ciphertext),
    }
  }))
  const unsigned: NoteFileUnsignedV2 = {
    format: NOTE_FILE_FORMAT,
    version: NOTE_FILE_VERSION,
    salt: bufferToBase64(salt),
    note: encryptedNote,
    pictures: encryptedPictures,
  }
  const file: NoteFileV2 = {
    ...unsigned,
    signature: await signVault(hmacKey, payloadFor(unsigned)),
  }
  const json = JSON.stringify(file, null, 2)
  assertFileSize(byteLength(json))
  return json
}

/** Authenticates and decrypts a .lokrnote without writing to IndexedDB. */
export async function openNoteFile(content: string, password: string): Promise<NoteFileContents> {
  const file = parseEnvelope(content)
  const salt = base64ToBuffer(file.salt)
  const { encryptionKey, hmacKey } = await deriveKeys(password, salt)
  if (!await verifyVault(hmacKey, payloadFor(file), file.signature)) {
    throw new Error('Incorrect file password or damaged note file.')
  }
  try {
    if (file.version === 1) {
      return {
        content: decodeNote(await decryptEntry(encryptionKey, file.ciphertext, file.iv)),
        pictures: [],
      }
    }
    const note = decodeNote(await decryptEntry(
      encryptionKey,
      file.note.ciphertext,
      file.note.iv,
    ))
    const pictures: Uint8Array[] = []
    for (const picture of file.pictures) {
      const bytes = await decryptBytes(
        encryptionKey,
        base64ToBuffer(picture.ciphertext).buffer as ArrayBuffer,
        base64ToBuffer(picture.iv).buffer as ArrayBuffer,
      )
      assertPictureSize(bytes.byteLength)
      sniffPictureType(bytes)
      pictures.push(bytes)
    }
    return { content: note, pictures }
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
  assertTextFileSize(bytes.byteLength)

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
