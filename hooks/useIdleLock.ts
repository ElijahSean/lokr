/**
 * hooks/useIdleLock.ts — Automatic vault lock after user inactivity
 *
 * After `idleMs` milliseconds of no user interaction, this hook calls the
 * provided `lock` function. The timer resets on any of these events:
 *   mousemove, keydown, click, touchstart
 *
 * Why auto-lock on idle?
 *  Prevents an attacker who gains physical access to an unlocked device
 *  from accessing the vault. Standard 5-minute timeout is a balance between
 *  security and usability.
 *
 * Return check (task 2.7): with a note open, hiding the tab no longer locks,
 * and Chrome throttles a hidden tab's timers (and may not count sleep), so
 * the timer alone can fire late. When the tab becomes visible again, the
 * wall-clock time since the last activity is checked and an expired session
 * locks before anything is drawn.
 *
 * Usage:
 *   useIdleLock(lock)            // Uses default 5-minute timeout
 *   useIdleLock(lock, 60_000)   // Custom 1-minute timeout
 *
 * Note: This hook must be used in a 'use client' component since it
 * attaches event listeners to the browser window.
 */

'use client'

import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { IDLE_LOCK_MS, idleExpired } from '@/lib/lockPolicy'

// Events that indicate the user is actively using the app.
// Any of these reset the idle timer.
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'touchstart'] as const

/**
 * Auto-locks the vault after `idleMs` of inactivity.
 *
 * @param lock   - The lock function from useSession() — called when idle timeout fires
 * @param idleMs - Milliseconds of inactivity before locking (default: 5 minutes)
 */
export function useIdleLock(
  lock: () => void,
  idleMs: number = IDLE_LOCK_MS
): void {
  // Use a ref so the timer ID persists across renders without causing re-renders
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Wall-clock time of the last activity, in memory only (never persisted)
  const lastActivityRef = useRef(0)

  useEffect(() => {
    // ── Start the idle timer ────────────────────────────────────────────────
    function startTimer(): void {
      // Cancel any existing timer before starting a new one
      if (timerRef.current) clearTimeout(timerRef.current)
      lastActivityRef.current = Date.now()
      // When the timer fires, lock the vault
      timerRef.current = setTimeout(lock, idleMs)
    }

    // ── Reset on activity ────────────────────────────────────────────────────
    // Called on every user interaction — resets the countdown to zero
    function resetTimer(): void {
      startTimer()
    }

    // ── Return check ────────────────────────────────────────────────────────
    // flushSync applies the lock's re-render inside this handler, so the vault
    // page (and an open note) is unmounted before the browser paints again.
    function checkOnReturn(): void {
      if (document.hidden) return
      if (idleExpired(lastActivityRef.current, Date.now(), idleMs)) {
        flushSync(lock)
      }
    }

    // Start the initial timer when the component mounts (vault is opened)
    startTimer()

    // Listen for activity events on the window (catches all interactions)
    ACTIVITY_EVENTS.forEach(event => {
      window.addEventListener(event, resetTimer, { passive: true })
      // passive: true = tells the browser we won't call preventDefault()
      // This improves scroll performance significantly on mobile
    })
    document.addEventListener('visibilitychange', checkOnReturn)

    // ── Cleanup ──────────────────────────────────────────────────────────────
    // When the component unmounts (vault is locked or page changes),
    // cancel the timer and remove all event listeners.
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      ACTIVITY_EVENTS.forEach(event => {
        window.removeEventListener(event, resetTimer)
      })
      document.removeEventListener('visibilitychange', checkOnReturn)
    }
  }, [lock, idleMs])
  // Re-run if lock function reference or idle time changes
}
