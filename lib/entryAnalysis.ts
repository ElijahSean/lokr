/**
 * lib/entryAnalysis.ts — strength and reuse flags for the Vault tab's chips (task 3.3)
 *
 * Pure: it takes passwords the caller has already decrypted (through lib/crypto.ts)
 * and returns flags only. The caller drops the plaintext as soon as this returns,
 * and the flags live in React state, never in IndexedDB (CLAUDE.md: "Health
 * analysis stays in memory" — a stored map of weak entries would point an
 * attacker at them). Same rules as the Health tab: PINs get no strength score
 * (inherently low-entropy, feature 23) but still count towards reuse.
 */
import { scorePassword, type StrengthResult } from './generator'

export interface DecryptedItem {
  id:       number
  password: string
  isPin:    boolean
}

export interface EntryFlags {
  strength:    StrengthResult | null  // null for PINs
  isDuplicate: boolean
}

export function analyseEntries(items: DecryptedItem[]): Map<number, EntryFlags> {
  const counts = new Map<string, number>()
  for (const { password } of items) counts.set(password, (counts.get(password) ?? 0) + 1)

  const flags = new Map<number, EntryFlags>()
  for (const { id, password, isPin } of items) {
    flags.set(id, {
      strength:    isPin ? null : scorePassword(password),
      isDuplicate: (counts.get(password) ?? 0) > 1,
    })
  }
  return flags
}
