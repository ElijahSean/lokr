/**
 * app/page.tsx — Unlock screen route (/)
 *
 * This is the default route. It serves two purposes:
 *  1. If the vault is already unlocked (active session), redirect to /vault
 *  2. Otherwise, render the UnlockScreen component
 *
 * The UnlockScreen handles both:
 *  - First-time setup (no vault exists yet)
 *  - Returning user unlock (vault exists, enter master password)
 *
 * This page is intentionally minimal — all the logic lives in UnlockScreen.tsx.
 */

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import UnlockScreen from '@/components/UnlockScreen'

export default function HomePage() {
  const { isUnlocked } = useSession()
  const router = useRouter()

  // If the vault is already unlocked (e.g. user navigates back to /),
  // redirect them to the vault immediately
  useEffect(() => {
    if (isUnlocked) {
      router.replace('/vault')
    }
  }, [isUnlocked, router])

  // Show the unlock/setup screen while the vault is locked
  return <UnlockScreen />
}
