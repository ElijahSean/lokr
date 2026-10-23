/**
 * tests/entryAnalysis.spec.ts — the Vault tab's strength and reuse flags (lib/entryAnalysis.ts)
 *
 * If these fail, an entry card shows the wrong chip: a reused password looks
 * unique, or a PIN gets a meaningless "weak" (task 3.3, CLAUDE.md feature 23).
 */
import { describe, it, expect } from 'vitest'
import { analyseEntries } from '@/lib/entryAnalysis'
import { scorePassword } from '@/lib/generator'

const STRONG = 'k7#Qv!2mZp$9xLr@4Tn'

describe('analyseEntries', () => {
  it('scores each password with scorePassword', () => {
    const flags = analyseEntries([
      { id: 1, password: 'abc', isPin: false },
      { id: 2, password: STRONG, isPin: false },
    ])
    expect(flags.get(1)?.strength).toEqual(scorePassword('abc'))
    expect(flags.get(2)?.strength).toEqual(scorePassword(STRONG))
    expect(flags.get(1)?.strength?.label).toBe('weak')
  })

  it('flags every entry that shares a password, and only those', () => {
    const flags = analyseEntries([
      { id: 1, password: 'same-pass-123', isPin: false },
      { id: 2, password: 'same-pass-123', isPin: false },
      { id: 3, password: STRONG, isPin: false },
    ])
    expect(flags.get(1)?.isDuplicate).toBe(true)
    expect(flags.get(2)?.isDuplicate).toBe(true)
    expect(flags.get(3)?.isDuplicate).toBe(false)
  })

  it('gives a PIN no strength score but still checks it for reuse', () => {
    const flags = analyseEntries([
      { id: 1, password: '4821', isPin: true },
      { id: 2, password: '4821', isPin: true },
    ])
    expect(flags.get(1)?.strength).toBeNull()
    expect(flags.get(1)?.isDuplicate).toBe(true)
  })

  it('returns an empty map for an empty vault', () => {
    expect(analyseEntries([]).size).toBe(0)
  })
})
