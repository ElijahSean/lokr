/**
 * lib/vaultPayload.ts — the exact string the vault HMAC signs
 *
 * Every signer and verifier (unlock, setup, re-sign, .vault export, restore
 * verify, restore re-sign) builds the payload here, so they can never drift
 * apart. Pure: no Dexie, so it is unit-tested under Node (tests/vaultPayload.spec.ts).
 *
 * BACKWARD COMPATIBILITY: a vault with no sticky notes must produce exactly the
 * pre-2.1 string `{"version":1,"salt":...,"entries":[...]}`, or every existing
 * vault would fail its HMAC check on the next unlock. So the `notes` key is
 * added only when there is at least one note, and always after `entries`.
 *
 * Deleting every note row is still caught: the stored signature was made over
 * a payload WITH notes, and the notes-free payload is a different string.
 */

import { bufferToBase64, hashBytes } from './crypto'
import type { NotePicture, VaultEntry, StickyNote } from './db'

export function buildVaultPayload(
  salt: string,
  entries: VaultEntry[],
  notes: StickyNote[] = [],
): string {
  // Key order is part of the signed bytes — version, salt, entries, notes.
  if (notes.length === 0) {
    return JSON.stringify({ version: 1, salt, entries })
  }
  return JSON.stringify({ version: 1, salt, entries, notes })
}

/**
 * Adds compact picture summaries only when pictures exist. Existing vaults
 * therefore retain their exact historical signed bytes. Ciphertext is hashed
 * afresh so editing it in IndexedDB cannot be hidden behind stored metadata.
 */
export async function buildVaultPayloadWithPictures(
  salt: string,
  entries: VaultEntry[],
  notes: StickyNote[],
  pictures: NotePicture[],
): Promise<string> {
  if (pictures.length === 0) return buildVaultPayload(salt, entries, notes)

  const noteIds = new Set(notes.map(note => note.id))
  const summaries = await Promise.all(pictures.map(async picture => {
    if (
      typeof picture.id !== 'number' ||
      !Number.isInteger(picture.noteId) ||
      !noteIds.has(picture.noteId) ||
      !(picture.ciphertext instanceof ArrayBuffer) ||
      picture.ciphertext.byteLength < 16 ||
      !(picture.iv instanceof ArrayBuffer) ||
      picture.iv.byteLength !== 12
    ) {
      throw new Error('Vault picture data is invalid or may have been tampered with.')
    }
    return {
      id: picture.id,
      noteId: picture.noteId,
      iv: bufferToBase64(picture.iv),
      ciphertextSha256: await hashBytes(picture.ciphertext),
    }
  }))

  // Key order is signed: version, salt, entries, notes, pictures.
  return JSON.stringify({ version: 1, salt, entries, notes, pictures: summaries })
}
