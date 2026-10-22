/**
 * app/vault/page.tsx — Main vault UI (protected route)
 *
 * This page is the heart of Lokr. It's only accessible when the vault is unlocked.
 * If the session key is null (vault is locked), the user is immediately redirected
 * back to the unlock screen.
 *
 * Security hooks active on this page:
 *  - useIdleLock: locks after 5 minutes of inactivity
 *  - useVisibilityLock: locks when tab becomes hidden (alt-tab, minimize, etc.)
 *
 * Layout:
 *  ┌───────────────────────────────────────────────────────────┐
 *  │  Header: Lokr logo   [nav tabs]   [lock button]           │
 *  ├───────────────────────────────────────────────────────────┤
 *  │  Main content area (changes based on active tab):         │
 *  │   Vault  │  Notes  │  Generator  │  Health  │  Backup      │
 *  └───────────────────────────────────────────────────────────┘
 */

'use client'

import { useEffect, useState } from 'react'
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

// Navigation tab definitions
type Tab = 'vault' | 'notes' | 'generator' | 'health' | 'export'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'vault',     label: 'Vault',     icon: '🔐' },
  { id: 'notes',     label: 'Notes',     icon: '📝' },
  { id: 'generator', label: 'Generator', icon: '⚡' },
  { id: 'health',    label: 'Health',    icon: '🛡️' },
  { id: 'export',    label: 'Backup',    icon: '💾' },
]

export default function VaultPage() {
  const { isUnlocked, lock } = useSession()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('vault')

  // ── Security guards ─────────────────────────────────────────────────────────

  // Redirect to unlock screen if vault is locked
  useEffect(() => {
    if (!isUnlocked) {
      router.replace('/')
    }
  }, [isUnlocked, router])

  // Lock after 5 minutes of user inactivity
  useIdleLock(lock, 5 * 60 * 1000)

  // Lock when the user switches to another tab or minimizes the browser
  useVisibilityLock(lock)

  // Show nothing while redirecting (avoids flash of vault content while locked)
  if (!isUnlocked) return null

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="border-b border-slate-800 bg-slate-950 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          {/* Logo + wordmark */}
          <div className="flex items-center gap-2">
            <LokrIcon size={32} />
            <span className="text-primary font-semibold text-lg tracking-tight">Lokr</span>
          </div>

          {/* Navigation tabs — hidden on very small screens, shown on sm+ */}
          <nav className="hidden sm:flex items-center gap-1" aria-label="Main navigation">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className={`
                  px-4 py-2 rounded-lg text-sm font-medium transition-colors
                  ${activeTab === tab.id
                    ? 'bg-brand-500 text-white'
                    : 'text-slate-400 hover:text-primary hover:bg-slate-800'
                  }
                `}
              >
                <span className="mr-1.5" aria-hidden="true">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Lock button — always visible */}
          <button
            onClick={lock}
            title="Lock vault"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-primary hover:bg-slate-800 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span className="hidden sm:inline">Lock</span>
          </button>
        </div>

        {/* Mobile tab bar — visible only on small screens */}
        <nav className="sm:hidden flex border-t border-slate-800" aria-label="Mobile navigation">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex-1 py-2.5 text-xs font-medium flex flex-col items-center gap-0.5
                ${activeTab === tab.id
                  ? 'text-brand-500 border-t-2 border-brand-500 -mt-px'
                  : 'text-slate-500'
                }
              `}
            >
              <span aria-hidden="true">{tab.icon}</span>
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
        {activeTab === 'notes'     && <StickyNotes />}
        {activeTab === 'generator' && <Generator />}
        {activeTab === 'health'    && <HealthDashboard />}
        {activeTab === 'export'    && <ExportImport />}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-800 py-3 text-center text-xs text-slate-600">
        Lokr — Your secrets, your machine. &nbsp;·&nbsp; All data stays local.
      </footer>
    </div>
  )
}
