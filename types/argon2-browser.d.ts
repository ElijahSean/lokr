/**
 * Type declarations for argon2-browser.
 * The package ships a .js file with no bundled TypeScript types.
 * These declarations provide enough type coverage for our usage.
 */
declare module 'argon2-browser' {
  export enum ArgonType {
    Argon2d  = 0,
    Argon2i  = 1,
    Argon2id = 2,
  }

  export interface HashOptions {
    pass: string | Uint8Array
    salt: string | Uint8Array
    time?: number        // Time cost (iterations)
    mem?: number         // Memory cost in KiB
    hashLen?: number     // Output length in bytes
    parallelism?: number // Number of threads
    type?: ArgonType
  }

  export interface HashResult {
    hash: Uint8Array    // Raw hash bytes
    hashHex: string     // Hex-encoded hash
    encoded: string     // PHC string format
  }

  export function hash(options: HashOptions): Promise<HashResult>
  export function verify(options: { pass: string; encoded: string; type?: ArgonType }): Promise<void>

  const argon2: {
    hash: typeof hash
    verify: typeof verify
    ArgonType: typeof ArgonType
  }

  export default argon2
}
