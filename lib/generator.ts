/**
 * lib/generator.ts — Password and passphrase generation
 *
 * All randomness comes from crypto.getRandomValues() — the browser's
 * cryptographically secure pseudorandom number generator (CSPRNG).
 *
 * NEVER use Math.random() for password generation.
 * Math.random() is not cryptographically secure — its output is predictable
 * if an attacker knows the seed or has seen enough output values.
 *
 * Technique: rejection sampling
 * To avoid modulo bias (where some characters appear slightly more often
 * than others), we use rejection sampling: generate random bytes in a range
 * that's an exact multiple of the charset size, and discard bytes that fall
 * outside that range. This guarantees a perfectly uniform distribution.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Options controlling which characters appear in generated passwords */
export interface GeneratorOptions {
  length: number           // Total password length (12–64)
  uppercase: boolean       // Include A–Z
  lowercase: boolean       // Include a–z
  numbers: boolean         // Include 0–9
  symbols: boolean         // Include !@#$%^&*()_+-=[]{}|;:,.<>?
  excludeAmbiguous: boolean // Remove visually similar chars: 0,O,o,1,l,I,|
}

// ─── Character Sets ────────────────────────────────────────────────────────────

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
const NUMBERS   = '0123456789'
const SYMBOLS   = '!@#$%^&*()_+-=[]{}|;:,.<>?'

// Characters that look too similar to each other — excluded when excludeAmbiguous is true
const AMBIGUOUS = new Set(['0', 'O', 'o', '1', 'l', 'I', '|'])

// ─── Passphrase Word List ─────────────────────────────────────────────────────
// 260 common, unambiguous English words for passphrase generation.
// log2(260) ≈ 8 bits of entropy per word (rejection sampling in randomInt
// keeps the selection uniform regardless of list size).
// 5 words ≈ 40 bits, 6 words ≈ 48 bits, 7 words ≈ 56 bits.
// Longer passphrases are more memorable than short random passwords.
// Exported (with the username lists) only so tests/generator.spec.ts can check
// every generated word really comes from the list.
export const WORDLIST: string[] = [
  'able','acid','aged','also','area','army','away','baby','back','ball',
  'band','bank','base','bath','bear','beat','bell','best','bill','bird',
  'bite','blue','boat','body','bomb','bond','bone','book','boot','born',
  'boss','both','bowl','burn','bush','busy','cafe','cake','call','calm',
  'came','camp','cape','card','care','cart','case','cast','cave','cell',
  'chip','city','clan','clap','clay','clip','club','clue','coal','coat',
  'code','coil','coin','cold','cook','cool','cope','cord','core','cork',
  'corn','cost','cozy','crew','crop','crow','cube','curb','cure','dare',
  'dark','data','dawn','deal','dear','debt','deck','deep','deer','deny',
  'desk','dice','diet','dirt','dish','disk','dock','dome','door','dose',
  'dove','draw','drop','drum','duck','dune','dusk','dust','earl','earn',
  'ease','east','edge','exam','face','fact','fair','fall','fame','farm',
  'fast','fate','feed','feel','feet','fell','felt','file','fill','film',
  'find','fine','fire','firm','fish','fist','flag','flat','flew','flip',
  'flow','foam','folk','fond','food','fool','ford','fork','form','fort',
  'foul','free','fuel','full','fund','fury','fuse','gain','gale','game',
  'gate','gaze','germ','gift','glad','glee','glow','glue','goat','gold',
  'golf','good','gore','grab','gram','gray','grew','grid','grin','grip',
  'grit','grow','gulf','guru','gust','hail','half','hall','halt','hand',
  'hang','hard','harm','harp','haul','hawk','head','heal','heap','heat',
  'heel','helm','help','herb','here','hero','hide','high','hill','hint',
  'hold','hole','holy','home','hook','hope','horn','host','hour','huge',
  'hull','hunt','hurl','icon','idea','idle','jade','jail','join','jump',
  'just','keen','kept','kind','king','kiss','kite','knot','lamp','land',
  'lane','lark','lash','last','lava','lawn','lead','leaf','lean','leap',
  'left','lend','lens','lick','life','lift','lime','line','link','lion',
]

// ─── Password Generator ───────────────────────────────────────────────────────

/**
 * Generates a cryptographically random password matching the given options.
 *
 * Algorithm:
 *  1. Build the allowed character set from enabled options
 *  2. Ensure at least one character from each enabled group (guaranteed inclusion)
 *  3. Fill remaining slots using rejection-sampled random selection
 *  4. Shuffle the result so required chars don't always appear at fixed positions
 *
 * @throws Error if no character types are selected
 */
export function generatePassword(options: GeneratorOptions): string {
  // Build the full character pool from selected options
  let charset = ''
  const requiredChars: string[] = []

  if (options.uppercase) {
    const chars = filterAmbiguous(UPPERCASE, options.excludeAmbiguous)
    charset += chars
    // Guarantee at least one uppercase character appears in the result
    requiredChars.push(randomCharFrom(chars))
  }
  if (options.lowercase) {
    const chars = filterAmbiguous(LOWERCASE, options.excludeAmbiguous)
    charset += chars
    requiredChars.push(randomCharFrom(chars))
  }
  if (options.numbers) {
    const chars = filterAmbiguous(NUMBERS, options.excludeAmbiguous)
    charset += chars
    requiredChars.push(randomCharFrom(chars))
  }
  if (options.symbols) {
    const chars = filterAmbiguous(SYMBOLS, options.excludeAmbiguous)
    charset += chars
    requiredChars.push(randomCharFrom(chars))
  }

  if (charset.length === 0) {
    throw new Error('Select at least one character type.')
  }

  // Fill remaining positions with random characters from the full charset
  const remaining = options.length - requiredChars.length
  const fillerChars = Array.from({ length: Math.max(0, remaining) }, () =>
    randomCharFrom(charset)
  )

  // Combine required + filler, then shuffle so positions are random
  const allChars = [...requiredChars, ...fillerChars]
  return cryptoShuffle(allChars).join('')
}

// ─── Passphrase Generator ─────────────────────────────────────────────────────

/**
 * Generates a random passphrase of the form "word-word-word-word-word-word".
 *
 * Passphrases are often easier to remember than random character strings
 * while still providing good entropy (6 words ≈ 48 bits from a 256-word list).
 *
 * For comparison: "correct-horse-battery-staple" style passphrases are
 * validated by security researchers as a strong authentication approach.
 *
 * @param wordCount - Number of words (default: 6)
 */
export function generatePassphrase(wordCount = 6): string {
  const words: string[] = []

  for (let i = 0; i < wordCount; i++) {
    // Pick a random index using rejection sampling to avoid modulo bias
    const index = randomInt(WORDLIST.length)
    words.push(WORDLIST[index])
  }

  return words.join('-')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Removes ambiguous characters from a charset string if the option is enabled. */
function filterAmbiguous(chars: string, exclude: boolean): string {
  if (!exclude) return chars
  return chars.split('').filter(c => !AMBIGUOUS.has(c)).join('')
}

/**
 * Picks one random character from a string using rejection sampling.
 * Guarantees uniform distribution — no character is more likely than another.
 */
function randomCharFrom(charset: string): string {
  return charset[randomInt(charset.length)]
}

/**
 * Returns a cryptographically random integer in [0, max).
 *
 * Uses rejection sampling to eliminate modulo bias:
 *  - We find the largest multiple of `max` that fits in a byte (or 32-bit value)
 *  - Any random value >= that multiple is discarded and we try again
 *  - This ensures every number in [0, max) is exactly equally likely
 */
function randomInt(max: number): number {
  // Use 32-bit values for efficiency with up to 2^32 choices
  const buf = new Uint32Array(1)
  // The "acceptance limit" — values below this are unbiased
  const limit = Math.floor(2 ** 32 / max) * max

  let value: number
  do {
    crypto.getRandomValues(buf)
    value = buf[0]
  } while (value >= limit)  // Rejection: discard biased values

  return value % max
}

/**
 * Performs a cryptographically random Fisher-Yates shuffle in-place.
 * Returns the same array (shuffled) for convenience.
 *
 * A regular sort with Math.random() is NOT a valid shuffle — it's biased.
 * Fisher-Yates with a CSPRNG produces a true uniformly random permutation.
 */
function cryptoShuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    // Pick a random index from 0 to i (inclusive)
    const j = randomInt(i + 1)
    // Swap arr[i] and arr[j]
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ─── Username Generator ───────────────────────────────────────────────────────

export const USERNAME_ADJECTIVES = [
  'swift', 'bold', 'calm', 'dark', 'bright', 'sharp', 'wild', 'cool',
  'iron', 'silver', 'silent', 'fierce', 'noble', 'brave', 'epic',
  'frozen', 'lucky', 'cosmic', 'neon', 'golden', 'crystal', 'shadow',
  'rapid', 'quiet', 'sleek', 'smart', 'steel', 'stone', 'stark',
]

export const USERNAME_NOUNS = [
  'wolf', 'eagle', 'river', 'cloud', 'fire', 'wave', 'fox', 'hawk',
  'bear', 'tiger', 'falcon', 'comet', 'pixel', 'cipher', 'byte',
  'node', 'spark', 'echo', 'arrow', 'blade', 'orbit', 'pulse',
  'quark', 'raven', 'robin', 'shark', 'viper', 'crane', 'lynx',
]

/** Generates a random username like "swift_wolf427" using crypto.getRandomValues(). */
export function generateUsername(): string {
  const adj  = USERNAME_ADJECTIVES[randomInt(USERNAME_ADJECTIVES.length)]
  const noun = USERNAME_NOUNS[randomInt(USERNAME_NOUNS.length)]
  const num  = randomInt(900) + 100  // 100–999
  return `${adj}_${noun}${num}`
}

// ─── PIN Generator ────────────────────────────────────────────────────────────

/** Generates a cryptographically random numeric PIN of the given digit length. */
export function generatePin(length = 4): string {
  return Array.from({ length }, () => randomInt(10)).join('')
}

// ─── Password Strength Scorer ─────────────────────────────────────────────────

/** Output of the strength scorer */
export interface StrengthResult {
  score: number                              // 0–100
  label: 'weak' | 'fair' | 'good' | 'strong'
  suggestions: string[]                      // Tips to improve the password
}

/**
 * Scores a password's strength from 0 (very weak) to 100 (very strong).
 *
 * Scoring criteria:
 *  + Length (longer is better — biggest factor)
 *  + Character variety (uppercase, lowercase, numbers, symbols)
 *  - Repeated characters (e.g. "aaa")
 *  - Only one character type (e.g. all lowercase)
 *
 * Note: This is a heuristic scorer, not zxcvbn.
 * For production use, consider adding a dictionary check.
 */
export function scorePassword(password: string): StrengthResult {
  let score = 0
  const suggestions: string[] = []

  // Length scoring (most important factor)
  if (password.length < 8) {
    suggestions.push('Use at least 8 characters.')
  } else if (password.length >= 8)  { score += 15 }
  if (password.length >= 12) { score += 15 }
  if (password.length >= 16) { score += 20 }
  if (password.length >= 20) { score += 10 }

  // Character variety bonuses
  const hasUpper   = /[A-Z]/.test(password)
  const hasLower   = /[a-z]/.test(password)
  const hasNumber  = /[0-9]/.test(password)
  const hasSymbol  = /[^A-Za-z0-9]/.test(password)

  if (hasUpper)  score += 10
  if (hasLower)  score += 10
  if (hasNumber) score += 10
  if (hasSymbol) score += 15

  // Variety suggestions
  if (!hasUpper)  suggestions.push('Add uppercase letters.')
  if (!hasLower)  suggestions.push('Add lowercase letters.')
  if (!hasNumber) suggestions.push('Add numbers.')
  if (!hasSymbol) suggestions.push('Add symbols (!@#$ etc.)')

  // Penalties
  if (/(.)\1{2,}/.test(password)) {
    // Repeated characters: "aaa", "111", etc.
    score -= 10
    suggestions.push('Avoid repeating characters.')
  }

  // Clamp to [0, 100]
  score = Math.max(0, Math.min(100, score))

  let label: StrengthResult['label']
  if (score < 30)       label = 'weak'
  else if (score < 55)  label = 'fair'
  else if (score < 80)  label = 'good'
  else                  label = 'strong'

  return { score, label, suggestions }
}
