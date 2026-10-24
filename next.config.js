/** @type {import('next').NextConfig} */

// Static security headers. The nonce-bearing Content Security Policy lives in
// middleware.ts because Next.js must read each response's nonce while rendering.
const securityHeaders = [
  // Prevent this page from being embedded in an iframe (clickjacking protection)
  { key: 'X-Frame-Options', value: 'DENY' },
  // Stop browsers from guessing the content type of responses
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Don't send the Referer header when navigating away from this site
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // Disable browser features we don't need (reduces attack surface)
  {
    key: 'Permissions-Policy',
    // clipboard-read stays denied — Lokr only ever WRITES to the clipboard
    value: 'camera=(), microphone=(), geolocation=(), payment=(), clipboard-read=()',
  },
]

const nextConfig = {
  // Configure webpack for argon2-browser
  webpack: (config) => {
    // Use the self-contained bundled version of argon2-browser.
    // The default build tries to load argon2.wasm as a separate file, which causes
    // webpack resolution errors. The bundled version has WASM embedded as base64 JS,
    // so it works without any special WASM loader configuration.
    config.resolve.alias = {
      ...config.resolve.alias,
      'argon2-browser': require.resolve(
        'argon2-browser/dist/argon2-bundled.min.js'
      ),
    }

    return config
  },

  // Attach the non-CSP security headers to every response
  async headers() {
    return [
      {
        source: '/(.*)',  // Apply to all routes
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = nextConfig
