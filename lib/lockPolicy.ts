/**
 * lib/lockPolicy.ts — the two auto-lock decisions, as pure functions
 *
 * Kept free of React, Dexie and the DOM so Vitest can run them under Node
 * (tests/lockPolicy.spec.ts). The hooks that act on them are
 * hooks/useVisibilityLock.ts and hooks/useIdleLock.ts.
 *
 * Task 2.7: while a sticky note is open full-window, hiding the tab (tab
 * switch, minimise) does not lock; the 5-minute idle lock always applies,
 * and is re-checked against the wall clock when the tab becomes visible.
 */

/** CLAUDE.md: "Vault must lock after 5 minutes of inactivity". */
export const IDLE_LOCK_MS = 5 * 60 * 1000

/** Lock when the tab is hidden, unless a note is open full-window. */
export function shouldLockOnHide(noteOpen: boolean): boolean {
  return !noteOpen
}

/**
 * True when `idleMs` or more has passed since the last activity.
 * Times are Date.now() milliseconds: a hidden tab's timers are throttled and
 * may not advance while the PC sleeps, so the wall clock is the reference.
 * A clock that moved backwards counts as expired — fail closed, never open.
 */
export function idleExpired(lastActivity: number, now: number, idleMs: number = IDLE_LOCK_MS): boolean {
  if (now < lastActivity) return true
  return now - lastActivity >= idleMs
}
