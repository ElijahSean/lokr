/**
 * tests/noteFile.spec.ts — password-protected one-note files and text imports
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  NOTE_FILE_MAX_BYTES,
  NOTE_FILE_NAME,
  createNoteFile,
  noteFromTextFile,
  noteImportKind,
  openNoteFile,
  validateNoteFilePasswords,
} from '@/lib/noteFile'
import { documentToPlainText, type NoteDocument } from '@/lib/noteDoc'
import type { NoteContent } from '@/lib/notes'
import { bufferToBase64, deriveKeys, encryptEntry, signVault } from '@/lib/crypto'

const PASSWORD = 'made-up file password'
const WRONG_PASSWORD = 'made-up file passwore'
const SLOW = 120_000

const BODY: NoteDocument = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Private heading', marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Second line', marks: [{ type: 'italic' }] }] },
  ],
}

const NOTE: NoteContent = {
  title: 'Private title',
  body: BODY,
  fontFamily: 'serif',
  fontSize: 'large',
  colour: 'blue',
  pinned: true,
  lined: true,
}

beforeAll(() => {
  // argon2-browser must use its Node filesystem path for the WASM binary.
  vi.stubGlobal('fetch', undefined)
})

afterAll(() => vi.unstubAllGlobals())

describe('.lokrnote version 1', () => {
  it('round-trips rich note content without plaintext in the file', async () => {
    const file = await createNoteFile(NOTE, PASSWORD)

    expect(NOTE_FILE_NAME).toBe('lokr-note.lokrnote')
    expect(file).not.toContain(NOTE.title)
    expect(file).not.toContain('Private heading')
    expect(await openNoteFile(file, PASSWORD)).toEqual(NOTE)
  }, SLOW)

  it('uses a fresh salt and IV for every export', async () => {
    const first = JSON.parse(await createNoteFile(NOTE, PASSWORD)) as Record<string, unknown>
    const second = JSON.parse(await createNoteFile(NOTE, PASSWORD)) as Record<string, unknown>

    expect(first.salt).not.toBe(second.salt)
    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  }, SLOW)

  it('refuses a wrong password and tampered ciphertext', async () => {
    const file = await createNoteFile(NOTE, PASSWORD)
    await expect(openNoteFile(file, WRONG_PASSWORD)).rejects.toThrow('Incorrect file password or damaged note file.')

    const tampered = JSON.parse(file) as { ciphertext: string }
    tampered.ciphertext = `${tampered.ciphertext[0] === 'A' ? 'B' : 'A'}${tampered.ciphertext.slice(1)}`
    await expect(openNoteFile(JSON.stringify(tampered), PASSWORD)).rejects.toThrow(
      'Incorrect file password or damaged note file.',
    )
  }, SLOW)

  it('refuses truncated, unrelated, unsupported and oversized files', async () => {
    await expect(openNoteFile('{', PASSWORD)).rejects.toThrow("isn't a valid Lokr note file")
    await expect(openNoteFile(JSON.stringify({ hello: 'world' }), PASSWORD)).rejects.toThrow("isn't a valid Lokr note file")
    await expect(openNoteFile(JSON.stringify({ format: 'lokr-note', version: 2 }), PASSWORD)).rejects.toThrow(
      'version is not supported',
    )
    await expect(openNoteFile('x'.repeat(NOTE_FILE_MAX_BYTES + 1), PASSWORD)).rejects.toThrow('100 KB')
  })

  it('sanitises imported rich documents through the note schema', async () => {
    // Build a correctly signed file with unsafe decrypted JSON, bypassing the
    // exporter on purpose, to prove the import boundary itself sanitises it.
    const unsafeBlob = JSON.stringify({
      v: 2,
      format: 'rich',
      title: NOTE.title,
      body: {
        type: 'doc' as const,
        content: [
          { type: 'script', content: [{ type: 'text', text: 'drop me' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'keep me', marks: [{ type: 'link', attrs: { href: 'javascript:bad' } }] }] },
        ],
      },
      fontFamily: NOTE.fontFamily,
      fontSize: NOTE.fontSize,
      colour: NOTE.colour,
      pinned: NOTE.pinned,
      lined: NOTE.lined,
    })
    const salt = new Uint8Array(16).fill(24)
    const keys = await deriveKeys(PASSWORD, salt)
    const encrypted = await encryptEntry(keys.encryptionKey, unsafeBlob)
    const unsigned = {
      format: 'lokr-note',
      version: 1,
      salt: bufferToBase64(salt),
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
    }
    const file = JSON.stringify({
      ...unsigned,
      signature: await signVault(keys.hmacKey, JSON.stringify(unsigned)),
    })

    const restored = await openNoteFile(file, PASSWORD)
    expect(restored.body).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'keep me' }] }],
    })
  }, SLOW)
})

describe('file password checks', () => {
  it('requires twelve matching characters', async () => {
    expect(validateNoteFilePasswords('short', 'short')).toContain('12')
    expect(validateNoteFilePasswords(PASSWORD, `${PASSWORD}!`)).toBe('File passwords do not match.')
    expect(validateNoteFilePasswords(PASSWORD, PASSWORD)).toBeNull()
    await expect(createNoteFile(NOTE, 'short')).rejects.toThrow('12')
  })
})

describe('plaintext note imports', () => {
  it('keeps line breaks and derives a capped title from txt and md filenames', () => {
    const text = 'first\n\nlast\n'
    const txt = noteFromTextFile(`${'t'.repeat(205)}.TXT`, new TextEncoder().encode(text))
    const md = noteFromTextFile('raw-markdown.md', new TextEncoder().encode('# heading\n- item'))

    expect(txt.title).toBe('t'.repeat(200))
    expect(documentToPlainText(txt.body)).toBe(text)
    expect(txt).toMatchObject({ colour: 'white', pinned: false, fontFamily: 'sans', fontSize: 'normal' })
    expect(md.title).toBe('raw-markdown')
    expect(documentToPlainText(md.body)).toBe('# heading\n- item')
  })

  it('checks extensions in code and rejects invalid UTF-8 or oversized text', () => {
    expect(noteImportKind('note.lokrnote')).toBe('lokrnote')
    expect(noteImportKind('note.MD')).toBe('text')
    expect(() => noteImportKind('note.json')).toThrow('.lokrnote, .txt or .md')
    expect(() => noteFromTextFile('note.txt', new Uint8Array([0xc3, 0x28]))).toThrow('UTF-8')
    expect(() => noteFromTextFile('note.txt', new Uint8Array(NOTE_FILE_MAX_BYTES + 1))).toThrow('100 KB')
  })
})
