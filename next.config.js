/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === 'development'

// Content Security Policy headers — the first line of defense.
// These tell the browser which resources it's allowed to load.
// Any violation (e.g. an injected script tag) gets blocked before it runs.
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // wasm-unsafe-eval: required for argon2-browser's WebAssembly module.
      // unsafe-inline: Next.js App Router dev mode injects inline scripts for
      // RSC streaming and router bootstrapping — blocked without this in dev.
      // Production builds don't use inline scripts, so this is dev-only.
      // In dev: 'unsafe-inline' for RSC streaming scripts, 'unsafe-eval' for
      // React Fast Refresh runtime (react-refresh-utils uses eval internally).
      // Neither is present in production builds.
      `script-src 'self' 'wasm-unsafe-eval'${isDev ? " 'unsafe-inline' 'unsafe-eval'" : ''}`,
      // unsafe-inline is needed for Tailwind's runtime styles in development
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      // No plugins/embeds of any kind
      "object-src 'none'",
      // In dev: 'self' allows Next.js HMR WebSocket and hot-update fetches.
      // In prod: 'none' blocks ALL network requests — Lokr is 100% offline.
      `connect-src ${isDev ? "'self'" : "'none'"}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
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

  // Attach security headers to every response
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
