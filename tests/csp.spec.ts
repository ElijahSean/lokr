import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy, createNonce } from '@/lib/csp'

function directive(policy: string, name: string): string[] {
  const value = policy
    .split('; ')
    .find((candidate) => candidate.startsWith(`${name} `))

  if (!value) throw new Error(`Missing ${name} directive`)
  return value.split(' ').slice(1)
}

describe('CSP nonce', () => {
  it('uses a fresh 128-bit standard-base64 value', () => {
    const first = createNonce()
    const second = createNonce()

    expect(atob(first)).toHaveLength(16)
    expect(first).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(second).not.toBe(first)
  })

  it('rejects a value that could inject another CSP source', () => {
    expect(() =>
      buildContentSecurityPolicy("bad' 'unsafe-inline", false)
    ).toThrow('standard base64')
  })
})

describe('content security policy', () => {
  const nonce = 'AAECAwQFBgcICQoLDA0ODw=='

  it('keeps the production script and connection policy strict', () => {
    const policy = buildContentSecurityPolicy(nonce, false)
    const scripts = directive(policy, 'script-src')

    expect(scripts).toEqual([
      "'self'",
      `'nonce-${nonce}'`,
      "'wasm-unsafe-eval'",
    ])
    expect(scripts).not.toContain("'unsafe-inline'")
    expect(scripts).not.toContain("'unsafe-eval'")
    expect(directive(policy, 'connect-src')).toEqual(["'none'"])
  })

  it('adds only Fast Refresh evaluation and local HMR in development', () => {
    const policy = buildContentSecurityPolicy(nonce, true)
    const scripts = directive(policy, 'script-src')

    expect(scripts).toContain("'unsafe-eval'")
    expect(scripts).not.toContain("'unsafe-inline'")
    expect(directive(policy, 'connect-src')).toEqual(["'self'"])
  })

  it('retains the remaining restrictive directives', () => {
    const policy = buildContentSecurityPolicy(nonce, false)

    expect(directive(policy, 'object-src')).toEqual(["'none'"])
    expect(directive(policy, 'img-src')).toEqual(["'self'", 'data:', 'blob:'])
    expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"])
    expect(directive(policy, 'base-uri')).toEqual(["'self'"])
    expect(directive(policy, 'form-action')).toEqual(["'self'"])
  })
})
