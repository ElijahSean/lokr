/**
 * hooks/useVisibilityLock.ts — Lock vault when the browser tab is hidden
 *
 * Listens to the Page Visibility API (document.visibilitychange event).
 * When the user switches to another tab, minimizes the browser, or the
 * screen locks, this hook calls `lock()` immediately — unless a sticky note
 * is open full-window (task 2.7), so a note can be read beside another
 * window. The decision is `shouldLockOnHide` in lib/lockPolicy.ts.
 *
 * Why lock on tab switch?
 *  - Prevents shoulder-surfing (someone walks by and glances at an unlocked vault)
 *  - Prevents other browser extensions or tabs from accessing the vault via JS
 *  - Standard behavior for security-sensitive apps (banking apps, password managers)
 *
 * The open-note exemption doesn't weaken the idle rule: useIdleLock keeps
 * counting while the tab is hidden and re-checks the clock when it returns.
 *
 * Note: The Page Visibility API fires on:
 *   - Tab switch (user clicks another tab)
 *   - Window minimize
 *   - Device screen lock / OS screen saver
 *   - Switching apps on mobile
 *
 * Usage:
 *   useVisibilityLock(lock, noteOpenRef)
 *
 * This hook must be used in a 'use client' component since it accesses the document.
 */

'use client'

import { useEffect, type MutableRefObject } from 'react'
import { shouldLockOnHide } from '@/lib/lockPolicy'

/**
 * Locks the vault whenever the page becomes hidden, unless a note is open.
 *
 * @param lock        - The lock function from useSession() — called immediately on hide
 * @param noteOpenRef - True while a note is open full-window. A ref, read at
 *                      hide time, so opening a note doesn't re-attach the listener
 */
export function useVisibilityLock(lock: () => void, noteOpenRef: MutableRefObject<boolean>): void {
  useEffect(() => {
    const handleVisibilityChange = (): void => {
      // document.hidden is true when the tab/window is not visible
      if (document.hidden && shouldLockOnHide(noteOpenRef.current)) {
        lock()
      }
    }

    // Start listening immediately when the vault page mounts
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Cleanup: remove listener when component unmounts (vault locks or user logs out)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [lock, noteOpenRef])
  // Re-run if the lock function reference changes (the ref object is stable)
}
