/**
 * app/vault/page.tsx — Main vault UI (protected route)
 *
 * This page is the heart of Lokr. It's only accessible when the vault is unlocked.
 * If the session key is null (vault is locked), the user is immediately redirected
 * back to the unlock screen.
 *
 * Security hooks active on this page:
 *  - useIdleLock: locks after 5 minutes of inactivity
 *  - useVisibilityLock: locks when tab becomes hidden (alt-tab, minimize, etc.),
 *    except while a sticky note is open full-window (task 2.7); useIdleLock
 *    re-checks the clock when the tab returns, so the 5-minute rule still holds
 *
 * Layout (tasks 3.6, 3.7: a matte-white light shell and a restrained
 * glossy-charcoal dark shell selected by the persistent appearance setting):
 *  ┌───────────────────────────────────────────────────────────┐
 *  │  Header: Lokr logo   [pill tabs]   [lock button]          │
 *  ├───────────────────────────────────────────────────────────┤
 *  │  Main content area (changes based on active tab):         │
 *  │   Vault  │  Notes  │  Generator  │  Health  │  Backup      │
 *  └───────────────────────────────────────────────────────────┘
 */

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import { useIdleLock } from '@/hooks/useIdleLock'
import { useVisibilityLock } from '@/hooks/useVisibilityLock'
import VaultList from '@/components/VaultList'
import Generator from '@/components/Generator'
import HealthDashboard from '@/components/HealthDashboard'
import ExportImport from '@/components/ExportImport'
import StickyNotes from '@/components/StickyNotes'
import { LokrIcon } from '@/components/LokrLogo'
import ThemeToggle from '@/components/ThemeToggle'
import { BackupIcon, GeneratorIcon, HealthIcon, LockIcon, NotesIcon, VaultIcon } from '@/components/Icons'
import { BRAND_FINISH, SHELL_SURFACE } from '@/components/ui'

// Navigation tab definitions
type Tab = 'vault' | 'notes' | 'generator' | 'health' | 'export'

// Line icons in place of emoji (task 3.2)
const TABS: { id: Tab; label: string; Icon: (_props: { className?: string }) => JSX.Element }[] = [
  { id: 'vault',     label: 'Vault',     Icon: VaultIcon },
  { id: 'notes',     label: 'Notes',     Icon: NotesIcon },
  { id: 'generator', label: 'Generator', Icon: GeneratorIcon },
  { id: 'health',    label: 'Health',    Icon: HealthIcon },
  { id: 'export',    label: 'Backup',    Icon: BackupIcon },
]

export default function VaultPage() {
  const { isUnlocked, lock } = useSession()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('vault')
  // True while a note is open full-window. A ref in this page, so it is gone
  // whenever a lock unmounts the page; nothing about it is stored anywhere.
  const noteOpenRef = useRef(false)
  const handleNoteOpenChange = useCallback((open: boolean) => { noteOpenRef.current = open }, [])

  // ── Security guards ─────────────────────────────────────────────────────────

  // Redirect to unlock screen if vault is locked
  useEffect(() => {
    if (!isUnlocked) {
      router.replace('/')
    }
  }, [isUnlocked, router])

  // Lock after 5 minutes of user inactivity
  useIdleLock(lock, 5 * 60 * 1000)

  // Lock when the user switches to another tab or minimizes the browser,
  // unless a note is open full-window (task 2.7)
  useVisibilityLock(lock, noteOpenRef)

  // Show nothing while redirecting (avoids flash of vault content while locked)
  if (!isUnlocked) return null

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      {/* The shared shell recipe is flat in light mode and glossy only in dark. */}
      <header className={`sticky top-0 z-10 border-b border-shell-border ${SHELL_SURFACE}`}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          {/* Logo + wordmark */}
          <div className="flex items-center gap-2">
            <LokrIcon size={32} />
            <span className="text-shell-text font-semibold text-lg tracking-tight">Lokr</span>
          </div>

          {/* Navigation tabs — shown from md (768px): between 640 and ~700px the
              five labelled tabs are wider than the window and the page scrolled sideways */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className={`
                  flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-medium transition-colors
                  ${activeTab === tab.id
                    ? BRAND_FINISH
                    : 'text-shell-muted hover:text-shell-text hover:bg-shell-surface'
                  }
                `}
              >
                <tab.Icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Theme and Lock stay compact so the mobile header cannot overflow. */}
          <div className="flex flex-shrink-0 items-center gap-1">
            <ThemeToggle compact />
            <button
              onClick={lock}
              title="Lock vault"
              className="flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium text-shell-muted hover:text-shell-text hover:bg-shell-surface transition-colors"
            >
              <LockIcon className="w-4 h-4" />
              <span className="hidden md:inline">Lock</span>
            </button>
          </div>
        </div>

        {/* Mobile tab bar — visible only on small screens. aria-current added in
            3.2 so screen readers hear the current tab here too, as on desktop */}
        <nav className="md:hidden flex border-t border-shell-border" aria-label="Mobile navigation">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              className={`
                flex-1 py-2.5 text-xs font-medium flex flex-col items-center gap-1
                ${activeTab === tab.id
                  ? 'text-brand-600 border-t-2 border-brand-500 -mt-px'
                  : 'text-shell-muted'
                }
              `}
            >
              <tab.Icon className="w-5 h-5" />
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        {/* Render only the active tab — all others are unmounted */}
        {activeTab === 'vault'     && <VaultList />}
        {/* Decrypted notes live only in StickyNotes' state: gone on tab switch and on lock */}
        {activeTab === 'notes'     && <StickyNotes onNoteOpenChange={handleNoteOpenChange} />}
        {activeTab === 'generator' && <Generator />}
        {activeTab === 'health'    && <HealthDashboard />}
        {activeTab === 'export'    && <ExportImport />}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className={`py-3 text-center text-xs text-shell-subtle ${SHELL_SURFACE}`}>
        Lokr — Your secrets, your machine. &nbsp;·&nbsp; All data stays local.
      </footer>
    </div>
  )
}
