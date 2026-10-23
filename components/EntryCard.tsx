/**
 * components/EntryCard.tsx — Displays a single vault entry
 *
 * Each card shows site, username, masked password, and optional badges.
 * Passwords are shown as "••••••••••••" by default and only decrypted
 * on explicit user action (eye icon or copy button).
 *
 * Key behaviours:
 *  - Reveal: calls onRevealRequest(id) → decryptEntry() in memory → shows plaintext
 *  - Copy:   decrypts → writes to clipboard → auto-clears after 30 seconds
 *  - History: loads password_history from IndexedDB, decrypts each on demand
 *  - Delete: requires a confirm step to prevent accidental deletion
 *
 * Status chips on the card (neutral pills with a coloured dot, task 3.3):
 *  - PIN: entry is a numeric PIN (entryType === 'pin'), no dot
 *  - Strength: weak/fair/good/strong (skipped for PINs), from VaultList's in-memory analysis
 *  - Duplicate: same password used on another entry
 *  - Age: password not changed in 90+ days
 */

'use client'

import { useState, useEffect } from 'react'
import { useSession } from '@/hooks/useSession'
import { db, type VaultEntry, type PasswordHistory } from '@/lib/db'
import { decryptEntry } from '@/lib/crypto'
import { copyWithAutoClear } from '@/lib/clipboard'
import type { StrengthResult } from '@/lib/generator'
import {
  CheckIcon, ChevronDownIcon, CopyIcon, EyeIcon, EyeOffIcon, PencilIcon, TrashIcon, WarningIcon,
} from '@/components/Icons'
import { CARD_SURFACE, CHIP, CHIP_DOT, DANGER_OUTLINE, STATUS_DOT, STRENGTH_TONE } from '@/components/ui'

// Show age warning if password hasn't changed in 90 days
const AGE_WARNING_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000
// Re-mask a revealed password/PIN after this long
const REVEAL_AUTO_HIDE_MS = 30_000

interface EntryCardProps {
  entry: VaultEntry
  onEdit:   (_entry: VaultEntry) => void
  onDelete: (_id: number) => void
  strength?: StrengthResult
  isDuplicate?: boolean
  decryptedPassword?: string
  onRevealRequest: (_id: number) => Promise<string>
}

export default function EntryCard({
  entry,
  onEdit,
  onDelete,
  strength,
  isDuplicate,
  decryptedPassword,
  onRevealRequest,
}: EntryCardProps) {
  const { encryptionKey } = useSession()

  // Current password state
  const [isRevealed, setIsRevealed]   = useState(false)
  const [revealed, setRevealed]       = useState<string | null>(null)
  const [isRevealing, setIsRevealing] = useState(false)
  const [copiedField, setCopiedField] = useState<'username' | 'password' | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // History state
  const [showHistory, setShowHistory]         = useState(false)
  const [history, setHistory]                 = useState<PasswordHistory[]>([])
  const [loadingHistory, setLoadingHistory]   = useState(false)
  const [revealedHistory, setRevealedHistory] = useState<Record<number, string>>({})
  const [revealingHistory, setRevealingHistory] = useState<Set<number>>(new Set())
  const [copiedHistory, setCopiedHistory]     = useState<number | null>(null)

  // Recovery codes state — decrypted on demand, never kept past auto-hide
  const [showCodes, setShowCodes]       = useState(false)
  const [codes, setCodes]               = useState<string[]>([])
  const [loadingCodes, setLoadingCodes] = useState(false)
  const [copiedCode, setCopiedCode]     = useState<number | null>(null)

  const hasRecoveryCodes = !!(entry.encryptedRecoveryCodes && entry.recoveryCodesIv)

  const isPIN = entry.entryType === 'pin'
  const isOld = Date.now() - new Date(entry.updatedAt).getTime() > AGE_WARNING_THRESHOLD_MS
  const updatedDaysAgo = Math.floor(
    (Date.now() - new Date(entry.updatedAt).getTime()) / (24 * 60 * 60 * 1000)
  )

  // ── Clipboard ────────────────────────────────────────────────────────────────
  // copyWithAutoClear schedules a 30s wipe and retries it on window focus,
  // so the clear still happens after the user alt-tabs away to paste.

  async function copyToClipboard(text: string, field: 'username' | 'password') {
    try {
      await copyWithAutoClear(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      alert('Clipboard access denied. Please copy manually.')
    }
  }

  // Auto-hide a revealed password so it can't sit on screen indefinitely
  useEffect(() => {
    if (!isRevealed) return
    const timer = setTimeout(() => {
      setIsRevealed(false)
      setRevealed(null)
    }, REVEAL_AUTO_HIDE_MS)
    return () => clearTimeout(timer)
  }, [isRevealed])

  // ── Current password reveal / copy ───────────────────────────────────────────

  async function handleReveal() {
    if (isRevealed) { setIsRevealed(false); setRevealed(null); return }
    if (decryptedPassword) { setRevealed(decryptedPassword); setIsRevealed(true); return }
    setIsRevealing(true)
    try {
      const pw = await onRevealRequest(entry.id!)
      setRevealed(pw); setIsRevealed(true)
    } finally { setIsRevealing(false) }
  }

  async function handleCopyPassword() {
    let pw = revealed ?? decryptedPassword
    if (!pw) pw = await onRevealRequest(entry.id!)
    await copyToClipboard(pw, 'password')
  }

  // ── History ──────────────────────────────────────────────────────────────────

  async function toggleHistory() {
    if (showHistory) { setShowHistory(false); return }
    setLoadingHistory(true)
    try {
      const rows = await db.password_history
        .where('entryId').equals(entry.id!)
        .sortBy('replacedAt')
      rows.reverse()  // most recent first
      setHistory(rows)
      setShowHistory(true)
    } finally { setLoadingHistory(false) }
  }

  async function toggleHistoryReveal(h: PasswordHistory) {
    const id = h.id!
    if (revealedHistory[id]) {
      setRevealedHistory(prev => { const n = { ...prev }; delete n[id]; return n })
      return
    }
    if (!encryptionKey) return
    setRevealingHistory(prev => new Set(prev).add(id))
    try {
      const pw = await decryptEntry(encryptionKey, h.encryptedPassword, h.iv)
      setRevealedHistory(prev => ({ ...prev, [id]: pw }))
      // Auto-hide this history item after the standard reveal window
      setTimeout(() => {
        setRevealedHistory(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }, REVEAL_AUTO_HIDE_MS)
    } finally {
      setRevealingHistory(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  // ── Recovery codes ───────────────────────────────────────────────────────────

  // Auto-hide decrypted recovery codes after the standard reveal window
  useEffect(() => {
    if (!showCodes) return
    const timer = setTimeout(() => {
      setShowCodes(false)
      setCodes([])
    }, REVEAL_AUTO_HIDE_MS)
    return () => clearTimeout(timer)
  }, [showCodes])

  async function toggleCodes() {
    if (showCodes) { setShowCodes(false); setCodes([]); return }
    if (!encryptionKey || !hasRecoveryCodes) return
    setLoadingCodes(true)
    try {
      const plain = await decryptEntry(
        encryptionKey,
        entry.encryptedRecoveryCodes!,
        entry.recoveryCodesIv!
      )
      setCodes(plain.split('\n').filter(Boolean))
      setShowCodes(true)
    } finally { setLoadingCodes(false) }
  }

  async function copyCode(code: string, index: number) {
    try {
      await copyWithAutoClear(code)
      setCopiedCode(index)
      setTimeout(() => setCopiedCode(null), 2000)
    } catch { alert('Clipboard access denied.') }
  }

  async function copyHistoryItem(h: PasswordHistory) {
    const id = h.id!
    let pw = revealedHistory[id]
    if (!pw && encryptionKey) pw = await decryptEntry(encryptionKey, h.encryptedPassword, h.iv)
    if (!pw) return
    try {
      await copyWithAutoClear(pw)
      setCopiedHistory(id)
      setTimeout(() => setCopiedHistory(null), 2000)
    } catch { alert('Clipboard access denied.') }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  // Letter tile: the site's first letter or digit ("github.com" → G, "1password" → 1),
  // or its first character when it has neither ("@home" → @). No favicons: fetching
  // one would be a network call (CLAUDE.md)
  const initial = (entry.site.match(/[a-z0-9]/i)?.[0] ?? entry.site.trim().charAt(0)).toUpperCase() || '?'

  const ICON_BUTTON =
    'p-1.5 rounded-lg text-slate-500 hover:text-primary hover:bg-slate-800 transition-colors ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50'
  const SMALL_ICON_BUTTON =
    'p-1 rounded-md text-slate-500 hover:text-primary hover:bg-slate-800 transition-colors flex-shrink-0 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
  const SPINNER = 'border-2 border-slate-500 border-t-transparent rounded-full animate-spin'
  const pinOrPassword = isPIN ? 'PIN' : 'password'

  return (
    <div className={`border border-slate-800 rounded-2xl p-4 sm:p-5 hover:border-slate-700 transition-colors animate-fade-in ${CARD_SURFACE}`}>

      {/* Header: tile, site and username, chips; edit and delete on the right */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {/* A 12rem basis, not flex-1's 0: with basis 0 the name squeezed to "git…"
            beside the delete confirm on a phone instead of the confirm wrapping */}
        <div className="flex min-w-0 flex-[1_1_12rem] items-start gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-700 text-base font-semibold text-slate-100"
            aria-hidden="true"
          >
            {initial}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-primary" title={entry.site}>
              {entry.site}
            </h3>
            <div className="mt-0.5 flex items-center gap-1">
              <span className="truncate text-sm text-slate-400">{entry.username}</span>
              <button
                onClick={() => copyToClipboard(entry.username, 'username')}
                title="Copy username"
                aria-label="Copy username"
                className={SMALL_ICON_BUTTON}
              >
                {copiedField === 'username'
                  ? <CheckIcon className="w-3.5 h-3.5 text-success" />
                  : <CopyIcon className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Status chips: neutral pills, the dot is the only colour (3.3) */}
            {(isPIN || strength || isDuplicate || isOld) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {isPIN && <span className={CHIP}>PIN</span>}
                {!isPIN && strength && (
                  <span className={CHIP}>
                    <span className={`${CHIP_DOT} ${STATUS_DOT[STRENGTH_TONE[strength.label]]}`} />
                    {strength.label}
                  </span>
                )}
                {isDuplicate && (
                  <span className={CHIP}>
                    <span className={`${CHIP_DOT} ${STATUS_DOT.warning}`} />
                    duplicate
                  </span>
                )}
                {isOld && (
                  <span className={CHIP}>
                    <span className={`${CHIP_DOT} ${STATUS_DOT.warning}`} />
                    {updatedDaysAgo}d old
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Edit / delete, or the delete confirm in their place. flex-wrap drops the
            confirm onto its own line on a narrow screen */}
        {showDeleteConfirm ? (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-slate-300">Delete this entry?</span>
            {/* Outlined, not filled, so it never looks like the graphite Save (3.2) */}
            <button
              onClick={() => onDelete(entry.id!)}
              className={`${DANGER_OUTLINE} text-xs px-3 py-1.5 rounded-lg`}
            >
              <WarningIcon className="w-3.5 h-3.5" />
              Yes
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="text-xs text-slate-400 hover:text-primary px-2 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <div className="flex flex-shrink-0 items-center gap-0.5">
            <button onClick={() => onEdit(entry)} title="Edit" aria-label={`Edit ${entry.site}`} className={ICON_BUTTON}>
              <PencilIcon />
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              title="Delete"
              aria-label={`Delete ${entry.site}`}
              className={ICON_BUTTON}
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </div>

      {/* Password / PIN row: masked until the eye is pressed */}
      <div className="mt-4 flex items-center gap-1 rounded-xl bg-slate-800 py-1.5 pl-3 pr-1.5">
        <span className="flex-1 truncate font-mono text-sm text-slate-300 select-all">
          {isRevealed && revealed
            ? revealed
            : isPIN ? '• • • •' : '••••••••••••'}
        </span>

        <button
          onClick={handleReveal}
          disabled={isRevealing}
          title={isRevealed ? `Hide ${pinOrPassword}` : `Show ${pinOrPassword}`}
          aria-label={isRevealed ? `Hide ${pinOrPassword}` : `Show ${pinOrPassword}`}
          className={ICON_BUTTON}
        >
          {isRevealing
            ? <div className={`w-4 h-4 ${SPINNER}`} />
            : isRevealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>

        <button
          onClick={handleCopyPassword}
          title={`Copy ${pinOrPassword} (cleared in 30s)`}
          aria-label={`Copy ${pinOrPassword} (cleared in 30s)`}
          className={ICON_BUTTON}
        >
          {copiedField === 'password' ? <CheckIcon className="w-4 h-4 text-success" /> : <CopyIcon />}
        </button>
      </div>

      {entry.notes && (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">{entry.notes}</p>
      )}

      {/* Footer: the expanders on the left, the last-updated date on the right */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          onClick={toggleHistory}
          disabled={loadingHistory}
          aria-expanded={showHistory}
          className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-primary transition-colors"
        >
          {loadingHistory
            ? <div className={`w-3 h-3 ${SPINNER}`} />
            : <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${showHistory ? 'rotate-180' : ''}`} />}
          History{showHistory && history.length > 0 ? ` (${history.length})` : ''}
        </button>

        {/* Only rendered when the entry has codes stored */}
        {hasRecoveryCodes && (
          <button
            onClick={toggleCodes}
            disabled={loadingCodes}
            aria-expanded={showCodes}
            className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-primary transition-colors"
          >
            {loadingCodes
              ? <div className={`w-3 h-3 ${SPINNER}`} />
              : <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${showCodes ? 'rotate-180' : ''}`} />}
            Recovery codes{showCodes ? ` (${codes.length})` : ''}
          </button>
        )}

        <span className="ml-auto text-xs text-slate-600">
          Updated {updatedDaysAgo === 0 ? 'today' : `${updatedDaysAgo}d ago`}
        </span>
      </div>

      {/* History list */}
      {showHistory && (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-xs">
          {history.length === 0 ? (
            <p className="px-3 py-2.5 text-slate-500">No previous passwords recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-700">
              {history.map(h => (
                <div key={h.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="w-[90px] flex-shrink-0 text-slate-600">
                    {new Date(h.replacedAt).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </span>
                  <span className="flex-1 truncate font-mono text-slate-400">
                    {revealedHistory[h.id!] ?? '••••••••'}
                  </span>
                  <button
                    onClick={() => toggleHistoryReveal(h)}
                    title={revealedHistory[h.id!] ? 'Hide' : 'Reveal'}
                    aria-label={revealedHistory[h.id!] ? 'Hide old password' : 'Reveal old password'}
                    className={SMALL_ICON_BUTTON}
                  >
                    {revealingHistory.has(h.id!)
                      ? <div className={`w-3.5 h-3.5 ${SPINNER}`} />
                      : revealedHistory[h.id!] ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => copyHistoryItem(h)}
                    title="Copy (cleared in 30s)"
                    aria-label="Copy old password (cleared in 30s)"
                    className={SMALL_ICON_BUTTON}
                  >
                    {copiedHistory === h.id
                      ? <CheckIcon className="w-3.5 h-3.5 text-success" />
                      : <CopyIcon className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recovery codes list — auto-hides after 30s like a revealed password */}
      {showCodes && (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-xs">
          <div className="divide-y divide-slate-700">
            {codes.map((code, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                <span className="w-[24px] flex-shrink-0 text-slate-600">{i + 1}.</span>
                <span className="flex-1 truncate font-mono text-slate-400 select-all">{code}</span>
                <button
                  onClick={() => copyCode(code, i)}
                  title="Copy (cleared in 30s)"
                  aria-label={`Copy code ${i + 1} (cleared in 30s)`}
                  className={SMALL_ICON_BUTTON}
                >
                  {copiedCode === i
                    ? <CheckIcon className="w-3.5 h-3.5 text-success" />
                    : <CopyIcon className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
