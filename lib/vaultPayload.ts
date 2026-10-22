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

import type { VaultEntry, StickyNote } from './db'

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
