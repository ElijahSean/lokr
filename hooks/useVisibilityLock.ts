/**
 * hooks/useVisibilityLock.ts — Lock vault when the browser tab is hidden
 *
 * Listens to the Page Visibility API (document.visibilitychange event).
 * When the user switches to another tab, minimizes the browser, or the
 * screen locks, this hook calls `lock()` immediately.
 *
 * Why lock on tab switch?
 *  - Prevents shoulder-surfing (someone walks by and glances at an unlocked vault)
 *  - Prevents other browser extensions or tabs from accessing the vault via JS
 *  - Standard behavior for security-sensitive apps (banking apps, password managers)
 *
 * Note: The Page Visibility API fires on:
 *   - Tab switch (user clicks another tab)
 *   - Window minimize
 *   - Device screen lock / OS screen saver
 *   - Switching apps on mobile
 *
 * Usage:
 *   useVisibilityLock(lock)
 *
 * This hook must be used in a 'use client' component since it accesses the document.
 */

'use client'

import { useEffect } from 'react'

/**
 * Locks the vault whenever the page becomes hidden.
 *
 * @param lock - The lock function from useSession() — called immediately on hide
 */
export function useVisibilityLock(lock: () => void): void {
  useEffect(() => {
    const handleVisibilityChange = (): void => {
      // document.hidden is true when the tab/window is not visible
      if (document.hidden) {
        lock()
      }
    }

    // Start listening immediately when the vault page mounts
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Cleanup: remove listener when component unmounts (vault locks or user logs out)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [lock])
  // Re-run if the lock function reference changes
}
