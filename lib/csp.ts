const NONCE_BYTES = 16
const BASE64_NONCE = /^[A-Za-z0-9+/]+={0,2}$/

/** Generate 128 random bits using the Edge- and browser-safe Web Crypto API. */
export function createNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES)
  crypto.getRandomValues(bytes)

  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Build the one CSP used for both the Next.js render request and browser
 * response. The nonce authorizes only this response's inline bootstrap; the
 * production policy deliberately keeps unsafe-inline and unsafe-eval absent.
 */
export function buildContentSecurityPolicy(
  nonce: string,
  isDevelopment: boolean
): string {
  if (!BASE64_NONCE.test(nonce)) {
    throw new Error('CSP nonce must be standard base64')
  }

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'wasm-unsafe-eval'",
  ]

  // React Fast Refresh evaluates its local runtime in development. Production
  // never receives this capability; the per-response nonce covers inline code.
  if (isDevelopment) scriptSources.push("'unsafe-eval'")

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "object-src 'none'",
    `connect-src ${isDevelopment ? "'self'" : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}
