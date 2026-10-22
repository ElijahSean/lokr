/**
 * components/UnlockScreen.tsx — First-time setup and returning-user unlock
 *
 * This component serves two modes, detected automatically:
 *  - First time (no vault_meta in IndexedDB): shows "Create Your Vault" form
 *  - Returning user (vault_meta exists): shows "Unlock Your Vault" form
 *
 * Security features implemented here:
 *  - autoComplete="off" on all password fields (prevents browser from storing them)
 *  - Brute-force protection: exponential delay after THROTTLE_AFTER failures,
 *    timed lockout at MAX_ATTEMPTS. The attempt counter is persisted in
 *    vault_meta (IndexedDB) so opening a new tab does NOT reset it.
 *  - Password strength meter shown during first-time setup
 *  - Master password is NEVER stored — only passed to deriveKeys() and then discarded
 *
 * Flow:
 *  Create: handleSetup() → setupVault(password) → router.replace('/vault')
 *  Unlock: handleUnlock() → unlock(password) → router.replace('/vault') or show error
 */

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import { db } from '@/lib/db'
import { scorePassword } from '@/lib/generator'
import { LokrIcon } from '@/components/LokrLogo'

// How many failed attempts before we start slowing the user down
const THROTTLE_AFTER = 3
// Timed lockout kicks in after this many consecutive failures
const MAX_ATTEMPTS = 10
// How long the lockout lasts once triggered
const LOCKOUT_MS = 15 * 60 * 1000
// Cap on the exponential pre-attempt delay
const MAX_DELAY_SEC = 30
// Minimum length for a new master password — it protects everything,
// and there is no server-side rate limiting to compensate for a weak one
const MIN_MASTER_LENGTH = 12

export default function UnlockScreen() {
  const { unlock, setupVault } = useSession()
  const router = useRouter()

  const [isFirstTime, setIsFirstTime] = useState<boolean | null>(null)
  const [password, setPassword]       = useState('')
  const [confirmPw, setConfirmPw]     = useState('')
  const [showPw, setShowPw]           = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [isLoading, setIsLoading]     = useState(false)
  const [attempts, setAttempts]       = useState(0)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)

  useEffect(() => {
    async function checkVault() {
      try {
        const meta = await db.vault_meta.get(1)
        setIsFirstTime(!meta?.salt)

        // Attempt counter lives in IndexedDB — a fresh tab does not reset it
        const count = meta?.failedAttempts ?? 0
        setAttempts(count)

        if (count >= MAX_ATTEMPTS && meta?.lastFailedAt) {
          const lockoutEnd = new Date(meta.lastFailedAt).getTime() + LOCKOUT_MS
          if (Date.now() < lockoutEnd) setLockedUntil(lockoutEnd)
        }
      } catch {
        setIsFirstTime(true)
      }
    }
    checkVault()
  }, [])

  // Automatically dismiss the lockout screen when the window expires
  useEffect(() => {
    if (!lockedUntil) return
    const timer = setTimeout(
      () => setLockedUntil(null),
      Math.max(0, lockedUntil - Date.now())
    )
    return () => clearTimeout(timer)
  }, [lockedUntil])

  const strength = isFirstTime && password ? scorePassword(password) : null

  function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (lockedUntil && Date.now() < lockedUntil) return

    setIsLoading(true)

    if (attempts >= THROTTLE_AFTER) {
      const delaySec = Math.min(Math.pow(2, attempts - THROTTLE_AFTER + 1), MAX_DELAY_SEC)
      setError(`Too many attempts. Waiting ${delaySec}s…`)
      await delay(delaySec * 1000)
    }

    const errorMsg = await unlock(password)
    setIsLoading(false)

    if (errorMsg) {
      const newCount = attempts + 1
      setAttempts(newCount)
      // Persist so a new tab / reload can't reset the counter
      await db.vault_meta.update(1, {
        failedAttempts: newCount,
        lastFailedAt: new Date(),
      })

      if (newCount >= MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCKOUT_MS)
      } else {
        const remaining = MAX_ATTEMPTS - newCount
        setError(`${errorMsg} (${remaining} attempts before a 15-minute lockout)`)
      }
      setPassword('')
    } else {
      await db.vault_meta.update(1, { failedAttempts: 0 })
      router.replace('/vault')
    }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPw) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < MIN_MASTER_LENGTH) {
      setError(`Master password must be at least ${MIN_MASTER_LENGTH} characters. A long passphrase works well.`)
      return
    }

    setIsLoading(true)
    const errorMsg = await setupVault(password)
    setIsLoading(false)

    if (errorMsg) {
      setError(errorMsg)
    } else {
      router.replace('/vault')
    }
  }

  if (isFirstTime === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (lockedUntil && Date.now() < lockedUntil) {
    const minutesLeft = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60_000))
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center max-w-md w-full">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-primary font-bold text-xl mb-2">Vault Locked Out</h1>
          <p className="text-red-700 text-sm">
            Too many failed attempts. Try again in {minutesLeft} minute{minutesLeft === 1 ? '' : 's'}.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo + branding */}
        <div className="text-center mb-8">
          <LokrIcon size={64} aria-hidden={false} className="mx-auto mb-4 drop-shadow-lg" />
          <h1 className="text-primary text-3xl font-bold tracking-tight">Lokr</h1>
          <p className="text-slate-500 text-sm mt-1">Your secrets, your machine.</p>
        </div>

        {/* Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-primary font-semibold text-lg mb-6">
            {isFirstTime ? 'Create Your Vault' : 'Unlock Your Vault'}
          </h2>

          <form onSubmit={isFirstTime ? handleSetup : handleUnlock} className="space-y-4">
            {/* Master password field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-400 mb-1.5">
                Master Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={isFirstTime ? 'Choose a strong password' : 'Enter your master password'}
                  required
                  disabled={isLoading}
                  autoComplete="off"
                  autoFocus
                  className="
                    w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 pr-10
                    text-primary placeholder-slate-500 text-sm
                    focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500
                    disabled:opacity-50 transition-colors
                  "
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>

              {/* Strength meter — first-time setup only */}
              {isFirstTime && strength && (
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        strength.label === 'weak'   ? 'bg-red-500 w-1/4'    :
                        strength.label === 'fair'   ? 'bg-yellow-500 w-2/4' :
                        strength.label === 'good'   ? 'bg-blue-500 w-3/4'   :
                        'bg-green-500 w-full'
                      }`}
                    />
                  </div>
                  <p className={`text-xs ${
                    strength.label === 'weak'   ? 'text-red-600'    :
                    strength.label === 'fair'   ? 'text-yellow-600' :
                    strength.label === 'good'   ? 'text-blue-600'   :
                    'text-green-700'
                  }`}>
                    {strength.label.charAt(0).toUpperCase() + strength.label.slice(1)} password
                    {strength.suggestions.length > 0 && ` · ${strength.suggestions[0]}`}
                  </p>
                </div>
              )}
            </div>

            {/* Confirm password — first-time setup only */}
            {isFirstTime && (
              <div>
                <label htmlFor="confirm" className="block text-sm font-medium text-slate-400 mb-1.5">
                  Confirm Password
                </label>
                <input
                  id="confirm"
                  type={showPw ? 'text' : 'password'}
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder="Repeat your password"
                  required
                  disabled={isLoading}
                  autoComplete="off"
                  className={`
                    w-full bg-slate-800 border rounded-lg px-4 py-2.5
                    text-primary placeholder-slate-500 text-sm
                    focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500
                    disabled:opacity-50 transition-colors
                    ${confirmPw && confirmPw !== password ? 'border-red-400' : 'border-slate-700'}
                  `}
                />
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading || (isFirstTime ? (password !== confirmPw || password.length < MIN_MASTER_LENGTH) : !password)}
              className="
                w-full bg-brand-500 hover:bg-brand-600 disabled:bg-slate-700 disabled:text-slate-500
                text-white font-medium rounded-lg py-2.5 text-sm
                transition-colors flex items-center justify-center gap-2
              "
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {isFirstTime ? 'Creating vault…' : 'Deriving key… (~2s)'}
                </>
              ) : (
                isFirstTime ? 'Create Vault' : 'Unlock'
              )}
            </button>
          </form>

          <p className="text-slate-600 text-xs text-center mt-6">
            {isFirstTime
              ? 'Your master password is never stored. If you forget it, there is no recovery.'
              : 'All decryption happens locally. Nothing leaves your device.'
            }
          </p>
        </div>

        {/* First-launch tip — the create form only ever shows once, so no
            dismissal state is needed (and localStorage is off-limits anyway) */}
        {isFirstTime && (
          <div className="mt-4 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 flex gap-2.5 animate-fade-in">
            <span aria-hidden="true" className="text-sm flex-shrink-0">💡</span>
            <p className="text-slate-400 text-xs leading-relaxed">
              <span className="font-semibold text-slate-300">Tip:</span> use a
              dedicated browser profile for Lokr, with no extensions installed.
              Extensions can read page content — including passwords you reveal —
              and a separate profile keeps your vault isolated from everyday browsing.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
