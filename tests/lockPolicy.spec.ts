/**
 * tests/lockPolicy.spec.ts — the auto-lock decisions (lib/lockPolicy.ts)
 *
 * If these fail, Lokr either stays unlocked when it should lock (an idle or
 * hidden vault left open) or locks while a note is being read (task 2.7).
 */
import { describe, it, expect } from 'vitest'
import { IDLE_LOCK_MS, idleExpired, shouldLockOnHide } from '@/lib/lockPolicy'

const T0 = 1_760_000_000_000

describe('shouldLockOnHide', () => {
  it('locks on hide when no note is open', () => {
    expect(shouldLockOnHide(false)).toBe(true)
  })

  it('does not lock on hide while a note is open', () => {
    expect(shouldLockOnHide(true)).toBe(false)
  })
})

describe('idleExpired', () => {
  it('is five minutes by default', () => {
    expect(IDLE_LOCK_MS).toBe(300_000)
  })

  it('is not expired just under the limit', () => {
    expect(idleExpired(T0, T0 + IDLE_LOCK_MS - 1)).toBe(false)
  })

  it('is expired exactly at the limit', () => {
    expect(idleExpired(T0, T0 + IDLE_LOCK_MS)).toBe(true)
  })

  it('is expired well over the limit (a sleeping PC)', () => {
    expect(idleExpired(T0, T0 + 8 * 60 * 60 * 1000)).toBe(true)
  })

  it('is not expired with no time passed', () => {
    expect(idleExpired(T0, T0)).toBe(false)
  })

  it('fails closed when the clock moved backwards', () => {
    expect(idleExpired(T0, T0 - 1)).toBe(true)
  })

  it('honours a custom limit', () => {
    expect(idleExpired(T0, T0 + 59_999, 60_000)).toBe(false)
    expect(idleExpired(T0, T0 + 60_000, 60_000)).toBe(true)
  })
})
