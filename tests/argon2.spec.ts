/**
 * tests/argon2.spec.ts — deriveKeys (Argon2id), in a file of its own
 *
 * argon2-browser's Emscripten build installs process-wide uncaughtException
 * and unhandledRejection handlers that abort the WASM module, so one stray
 * rejection elsewhere would break every later derivation. Vitest gives each
 * file its own worker; keeping Argon2 here keeps that blast radius small.
 *
 * Each derivation is deliberately slow (3 passes over 64 MiB, lib/crypto.ts),
 * so the four keys are derived once and the time limit is raised for this
 * file only.
 *
 * argon2-browser's Emscripten loader predates Node having fetch: it fetches
 * its .wasm whenever `typeof fetch === "function"`, even under Node, and a
 * file path is not a URL ("fetch failed"). Hiding fetch for this file sends
 * it down its other branch, which reads argon2.wasm from disk with fs.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { deriveKeys, encryptEntry, decryptEntry, signVault, verifyVault, type DerivedKeys } from '@/lib/crypto'

const SLOW = 120_000

const saltA = new Uint8Array(16).fill(7)
const saltB = new Uint8Array(16).fill(8)

let first: DerivedKeys
let again: DerivedKeys
let otherSalt: DerivedKeys
let otherPassword: DerivedKeys

beforeAll(async () => {
  vi.stubGlobal('fetch', undefined)
  first        = await deriveKeys('a made-up master password', saltA)
  again         = await deriveKeys('a made-up master password', saltA)
  otherSalt     = await deriveKeys('a made-up master password', saltB)
  otherPassword = await deriveKeys('a made-up master passwore', saltA)
}, SLOW)

describe('deriveKeys', () => {
  it('derives the same keys from the same password and salt', async () => {
    const { ciphertext, iv } = await encryptEntry(first.encryptionKey, 'secret')
    expect(await decryptEntry(again.encryptionKey, ciphertext, iv)).toBe('secret')

    const signature = await signVault(first.hmacKey, '[]')
    expect(await verifyVault(again.hmacKey, '[]', signature)).toBe(true)
  })

  // The salt is what makes a cross-device restore need the file's own salt
  // (CLAUDE.md, Import .vault): the same password under another salt is
  // a different key.
  it('derives a different key from a different salt', async () => {
    const { ciphertext, iv } = await encryptEntry(first.encryptionKey, 'secret')
    await expect(decryptEntry(otherSalt.encryptionKey, ciphertext, iv)).rejects.toThrow()
  })

  it('derives a different key from a password one character off', async () => {
    const { ciphertext, iv } = await encryptEntry(first.encryptionKey, 'secret')
    await expect(decryptEntry(otherPassword.encryptionKey, ciphertext, iv)).rejects.toThrow()

    const signature = await signVault(first.hmacKey, '[]')
    expect(await verifyVault(otherPassword.hmacKey, '[]', signature)).toBe(false)
  })
})
