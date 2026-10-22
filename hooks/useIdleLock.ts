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
 * Usage:
 *   useIdleLock(lock)            // Uses default 5-minute timeout
 *   useIdleLock(lock, 60_000)   // Custom 1-minute timeout
 *
 * Note: This hook must be used in a 'use client' component since it
 * attaches event listeners to the browser window.
 */

'use client'

import { useEffect, useRef } from 'react'

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
  idleMs: number = 5 * 60 * 1000
): void {
  // Use a ref so the timer ID persists across renders without causing re-renders
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // ── Start the idle timer ────────────────────────────────────────────────
    function startTimer(): void {
      // Cancel any existing timer before starting a new one
      if (timerRef.current) clearTimeout(timerRef.current)
      // When the timer fires, lock the vault
      timerRef.current = setTimeout(lock, idleMs)
    }

    // ── Reset on activity ────────────────────────────────────────────────────
    // Called on every user interaction — resets the countdown to zero
    function resetTimer(): void {
      startTimer()
    }

    // Start the initial timer when the component mounts (vault is opened)
    startTimer()

    // Listen for activity events on the window (catches all interactions)
    ACTIVITY_EVENTS.forEach(event => {
      window.addEventListener(event, resetTimer, { passive: true })
      // passive: true = tells the browser we won't call preventDefault()
      // This improves scroll performance significantly on mobile
    })

    // ── Cleanup ──────────────────────────────────────────────────────────────
    // When the component unmounts (vault is locked or page changes),
    // cancel the timer and remove all event listeners.
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      ACTIVITY_EVENTS.forEach(event => {
        window.removeEventListener(event, resetTimer)
      })
    }
  }, [lock, idleMs])
  // Re-run if lock function reference or idle time changes
}
