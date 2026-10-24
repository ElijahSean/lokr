/**
 * tests/crypto.spec.ts — AES-256-GCM entries, HMAC vault signature, base64
 *
 * Keys here come straight from Web Crypto rather than deriveKeys(), so these
 * specs run in milliseconds; Argon2id has its own file (tests/argon2.spec.ts).
 */
import { describe, it, expect } from 'vitest'
import {
  encryptEntry,
  decryptEntry,
  encryptBytes,
  decryptBytes,
  hashBytes,
  signVault,
  verifyVault,
  bufferToBase64,
  base64ToBuffer,
  generateSalt,
} from '@/lib/crypto'

async function aesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

/** Flips one bit of a base64 value, the smallest possible tampering. */
function flipBit(base64: string, byteIndex = 0): string {
  const bytes = base64ToBuffer(base64)
  bytes[byteIndex] ^= 0x01
  return bufferToBase64(bytes)
}

describe('encryptEntry / decryptEntry', () => {
  it.each([
    ['a typical password', 'correct-horse-battery-staple'],
    ['an empty string', ''],
    ['non-ASCII text', 'pässwörd 🔐 日本語'],
  ])('round-trips %s', async (_label, plaintext) => {
    const key = await aesKey()
    const { ciphertext, iv } = await encryptEntry(key, plaintext)
    expect(await decryptEntry(key, ciphertext, iv)).toBe(plaintext)
  })

  it('never stores the plaintext in the ciphertext', async () => {
    const key = await aesKey()
    const { ciphertext } = await encryptEntry(key, 'hunter2hunter2')
    expect(ciphertext).not.toContain('hunter2')
    expect(ciphertext).not.toContain(btoa('hunter2hunter2'))
  })

  // GCM with a repeated IV under one key leaks both plaintexts (CLAUDE.md:
  // "Each entry gets a unique random IV").
  it('uses a fresh 96-bit IV for every encryption of the same text', async () => {
    const key = await aesKey()
    const a = await encryptEntry(key, 'same text')
    const b = await encryptEntry(key, 'same text')
    expect(base64ToBuffer(a.iv)).toHaveLength(12)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('throws, rather than returning text, under the wrong key', async () => {
    const { ciphertext, iv } = await encryptEntry(await aesKey(), 'secret')
    await expect(decryptEntry(await aesKey(), ciphertext, iv)).rejects.toThrow()
  })

  it('throws when one bit of the ciphertext has changed', async () => {
    const key = await aesKey()
    const { ciphertext, iv } = await encryptEntry(key, 'secret')
    await expect(decryptEntry(key, flipBit(ciphertext), iv)).rejects.toThrow()
  })

  it('throws when one bit of the IV has changed', async () => {
    const key = await aesKey()
    const { ciphertext, iv } = await encryptEntry(key, 'secret')
    await expect(decryptEntry(key, ciphertext, flipBit(iv))).rejects.toThrow()
  })
})

describe('encryptBytes / decryptBytes', () => {
  it('round-trips arbitrary binary data without base64 storage', async () => {
    const key = await aesKey()
    const plaintext = Uint8Array.from({ length: 256 }, (_, index) => index)
    const encrypted = await encryptBytes(key, plaintext)

    expect(encrypted.ciphertext).toBeInstanceOf(ArrayBuffer)
    expect(encrypted.iv).toBeInstanceOf(ArrayBuffer)
    expect(encrypted.iv.byteLength).toBe(12)
    expect(await decryptBytes(key, encrypted.ciphertext, encrypted.iv)).toEqual(plaintext)
  })

  it('uses a fresh IV and rejects modified bytes', async () => {
    const key = await aesKey()
    const plaintext = new TextEncoder().encode('picture bytes')
    const first = await encryptBytes(key, plaintext)
    const second = await encryptBytes(key, plaintext)
    expect(bufferToBase64(first.iv)).not.toBe(bufferToBase64(second.iv))

    const changed = first.ciphertext.slice(0)
    new Uint8Array(changed)[0] ^= 0x01
    await expect(decryptBytes(key, changed, first.iv)).rejects.toThrow()
  })

  it('hashes identical bytes deterministically and changed bytes differently', async () => {
    const first = new Uint8Array([1, 2, 3]).buffer
    const changed = new Uint8Array([1, 2, 4]).buffer
    expect(await hashBytes(first)).toBe(await hashBytes(first.slice(0)))
    expect(await hashBytes(first)).not.toBe(await hashBytes(changed))
  })
})

describe('signVault / verifyVault', () => {
  const vault = JSON.stringify([{ id: 1, site: 'example.com', encryptedPassword: 'abc', iv: 'def' }])

  it('verifies the data it signed', async () => {
    const key = await hmacKey()
    const signature = await signVault(key, vault)
    expect(await verifyVault(key, vault, signature)).toBe(true)
  })

  it('rejects changed data', async () => {
    const key = await hmacKey()
    const signature = await signVault(key, vault)
    expect(await verifyVault(key, vault.replace('example', 'exbmple'), signature)).toBe(false)
  })

  it('rejects a signature made with a different key', async () => {
    const signature = await signVault(await hmacKey(), vault)
    expect(await verifyVault(await hmacKey(), vault, signature)).toBe(false)
  })

  // Fail closed (CLAUDE.md): a missing or garbled signature is a tampered
  // vault, and verifyVault must say false, not throw past the caller's check.
  it.each([
    ['an empty signature', ''],
    ['malformed base64', '%%% not base64 %%%'],
    ['a truncated signature', 'AAAA'],
  ])('returns false, never throws, for %s', async (_label, signature) => {
    await expect(verifyVault(await hmacKey(), vault, signature)).resolves.toBe(false)
  })
})

describe('bufferToBase64 / base64ToBuffer', () => {
  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(base64ToBuffer(bufferToBase64(all))).toEqual(all)
    expect(base64ToBuffer(bufferToBase64(all.buffer))).toEqual(all)
  })
})

describe('generateSalt', () => {
  it('returns 128 random bits, different each call', () => {
    const a = generateSalt()
    expect(a).toHaveLength(16)
    expect(bufferToBase64(a)).not.toBe(bufferToBase64(generateSalt()))
  })
})
