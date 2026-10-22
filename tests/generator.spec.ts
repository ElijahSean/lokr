/**
 * tests/generator.spec.ts — passwords, passphrases, usernames, PINs, strength
 *
 * The character groups are written out again here rather than imported, so a
 * spec fails if lib/generator.ts's sets change unexpectedly.
 */
import { describe, it, expect } from 'vitest'
import {
  generatePassword,
  generatePassphrase,
  generateUsername,
  generatePin,
  scorePassword,
  WORDLIST,
  USERNAME_ADJECTIVES,
  USERNAME_NOUNS,
  type GeneratorOptions,
} from '@/lib/generator'

const UPPER   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER   = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS  = '0123456789'
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?'
const AMBIGUOUS = '0Oo1lI|'

const all: GeneratorOptions = {
  length: 16, uppercase: true, lowercase: true, numbers: true, symbols: true, excludeAmbiguous: false,
}

/** Many samples, so "never contains" and "always contains" mean something. */
function many(options: GeneratorOptions, count = 200): string[] {
  return Array.from({ length: count }, () => generatePassword(options))
}

const onlyFrom = (set: string) => (s: string) => [...s].every(c => set.includes(c))
const someFrom = (set: string) => (s: string) => [...s].some(c => set.includes(c))

describe('generatePassword', () => {
  it.each([12, 64])('honours a length of %i', length => {
    for (const p of many({ ...all, length })) expect(p).toHaveLength(length)
  })

  it.each([
    ['uppercase', UPPER],
    ['lowercase', LOWER],
    ['numbers',   DIGITS],
    ['symbols',   SYMBOLS],
  ] as const)('uses only %s when only that group is enabled', (group, set) => {
    const options: GeneratorOptions = {
      length: 32, uppercase: false, lowercase: false, numbers: false, symbols: false,
      excludeAmbiguous: false, [group]: true,
    }
    expect(many(options).every(onlyFrom(set))).toBe(true)
  })

  it('includes at least one character from every enabled group', () => {
    // Length 12 is the shortest the UI allows, where a missing group is likeliest
    for (const p of many({ ...all, length: 12 }, 500)) {
      expect(someFrom(UPPER)(p) && someFrom(LOWER)(p) && someFrom(DIGITS)(p) && someFrom(SYMBOLS)(p)).toBe(true)
    }
  })

  it('drops ambiguous letters and digits when asked', () => {
    const passwords = many({ ...all, length: 64, symbols: false, excludeAmbiguous: true })
    expect(passwords.some(someFrom(AMBIGUOUS))).toBe(false)
    // Control: without the option, 200 × 64 characters always hit one of them
    expect(many({ ...all, length: 64, symbols: false }).some(someFrom(AMBIGUOUS))).toBe(true)
  })

  // Known bug, task 1.4: the symbols group skips the ambiguous filter, but '|'
  // is in both sets (lib/generator.ts AMBIGUOUS and SYMBOLS). it.fails passes
  // while the bug exists; once 1.4 fixes it, this becomes a plain it().
  it.fails('drops "|" from symbols when asked (task 1.4)', () => {
    const symbolsOnly: GeneratorOptions = {
      length: 64, uppercase: false, lowercase: false, numbers: false, symbols: true, excludeAmbiguous: true,
    }
    expect(many(symbolsOnly).some(p => p.includes('|'))).toBe(false)
  })

  it('throws when no character group is enabled', () => {
    expect(() => generatePassword({
      length: 16, uppercase: false, lowercase: false, numbers: false, symbols: false, excludeAmbiguous: false,
    })).toThrow('Select at least one character type.')
  })
})

describe('generatePin', () => {
  it('gives 4 digits by default and the asked length otherwise', () => {
    expect(generatePin()).toMatch(/^\d{4}$/)
    expect(generatePin(8)).toMatch(/^\d{8}$/)
  })

  // Modulo bias (randomInt without rejection sampling) skews low digits by
  // only a fraction of a percent, too little for this to see; what it catches
  // is a gross skew such as a stuck or narrowed range. Each count has a
  // standard deviation of 30, so ±150 is five of them: it never flakes.
  it('spreads 10,000 digits evenly across 0–9', () => {
    const counts = new Array<number>(10).fill(0)
    for (const d of generatePin(10_000)) counts[Number(d)]++
    for (const count of counts) {
      expect(count).toBeGreaterThan(850)
      expect(count).toBeLessThan(1150)
    }
  })
})

describe('generatePassphrase', () => {
  it.each([3, 6, 8])('gives %i dash-separated words from the word list', count => {
    for (let i = 0; i < 50; i++) {
      const words = generatePassphrase(count).split('-')
      expect(words).toHaveLength(count)
      for (const word of words) expect(WORDLIST).toContain(word)
    }
  })

  it('defaults to 6 words', () => {
    expect(generatePassphrase().split('-')).toHaveLength(6)
  })
})

describe('generateUsername', () => {
  it('gives adjective_noun plus a number from 100 to 999', () => {
    for (let i = 0; i < 200; i++) {
      const match = generateUsername().match(/^([a-z]+)_([a-z]+)(\d{3})$/)
      expect(match).not.toBeNull()
      const [, adjective, noun, number] = match as RegExpMatchArray
      expect(USERNAME_ADJECTIVES).toContain(adjective)
      expect(USERNAME_NOUNS).toContain(noun)
      expect(Number(number)).toBeGreaterThanOrEqual(100)
    }
  })
})

describe('scorePassword', () => {
  it('labels a short lowercase password weak', () => {
    expect(scorePassword('abc').label).toBe('weak')
  })

  it('labels a long password with every character type strong', () => {
    expect(scorePassword('Correct-Horse-Battery-9').label).toBe('strong')
  })
})
