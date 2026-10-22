/**
 * vitest.config.ts — unit tests for lib/ (task 1.2)
 *
 * Specs live in tests/, not beside the modules, so the test-runner's rule scan
 * (no crypto.subtle outside lib/crypto.ts, no Math.random) keeps covering only
 * app code: the crypto specs need crypto.subtle to build their own keys.
 *
 * The default environment is plain Node, never a fake DOM. Node's Web Crypto
 * rejects buffers created by jsdom/happy-dom (a different JS realm), and
 * argon2-browser switches to its browser branch (fetching the .wasm) whenever
 * `self` exists. tests/clipboard.spec.ts stubs the few browser globals it needs.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Mirrors tsconfig.json's "@/*": ["./*"]
const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: root }],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
