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
 * Badges shown on the card:
 *  - PIN badge: entry is a numeric PIN (entryType === 'pin')
 *  - Strength bar: weak/fair/good/strong (skipped for PINs)
 *  - Duplicate warning: same password used on another entry
 *  - Age warning: password not changed in 90+ days
 */

'use client'

import { useState, useEffect } from 'react'
import { useSession } from '@/hooks/useSession'
import { db, type VaultEntry, type PasswordHistory } from '@/lib/db'
import { decryptEntry } from '@/lib/crypto'
import { copyWithAutoClear } from '@/lib/clipboard'
import type { StrengthResult } from '@/lib/generator'

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

  // ── Shared SVG snippets ───────────────────────────────────────────────────────

  const CheckIcon = ({ size = 'w-4 h-4' }: { size?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={`${size} text-green-600`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>
  )
  const CopyIcon = ({ size = 'w-4 h-4' }: { size?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
  )
  const EyeIcon = ({ crossed = false, size = 'w-4 h-4' }: { crossed?: boolean; size?: string }) => crossed ? (
    <svg xmlns="http://www.w3.org/2000/svg" className={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" className={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
  )

  const strengthColors = {
    weak:   'bg-red-50 text-red-700 border-red-200',
    fair:   'bg-yellow-50 text-yellow-700 border-yellow-200',
    good:   'bg-blue-50 text-blue-700 border-blue-200',
    strong: 'bg-green-50 text-green-700 border-green-200',
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors animate-fade-in">

      {/* Top row: site + badges */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-primary font-semibold text-base truncate" title={entry.site}>
            {entry.site}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-slate-400 text-sm truncate">{entry.username}</span>
            <button
              onClick={() => copyToClipboard(entry.username, 'username')}
              title="Copy username"
              className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
            >
              {copiedField === 'username' ? <CheckIcon size="w-3.5 h-3.5" /> : <CopyIcon size="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {isPIN && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-300">
              PIN
            </span>
          )}
          {!isPIN && strength && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${strengthColors[strength.label]}`}>
              {strength.label}
            </span>
          )}
          {isDuplicate && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-orange-50 text-orange-700 border-orange-200">
              duplicate
            </span>
          )}
          {isOld && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
              {updatedDaysAgo}d old
            </span>
          )}
        </div>
      </div>

      {/* Password / PIN row */}
      <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 mb-2">
        <span className="flex-1 text-sm font-mono text-slate-300 truncate select-all">
          {isRevealed && revealed
            ? revealed
            : isPIN ? '• • • •' : '••••••••••••'}
        </span>

        <button
          onClick={handleReveal}
          disabled={isRevealing}
          title={isRevealed ? `Hide ${isPIN ? 'PIN' : 'password'}` : `Show ${isPIN ? 'PIN' : 'password'}`}
          className="text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
        >
          {isRevealing
            ? <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
            : <EyeIcon crossed={isRevealed} />
          }
        </button>

        <button
          onClick={handleCopyPassword}
          title={`Copy ${isPIN ? 'PIN' : 'password'} (cleared in 30s)`}
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          {copiedField === 'password' ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>

      {/* History toggle */}
      <button
        onClick={toggleHistory}
        disabled={loadingHistory}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 transition-colors mb-2"
      >
        {loadingHistory
          ? <div className="w-3 h-3 border border-slate-500 border-t-transparent rounded-full animate-spin" />
          : (
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 transition-transform ${showHistory ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="6 9 12 15 18 9"/></svg>
          )
        }
        History{showHistory && history.length > 0 ? ` (${history.length})` : ''}
      </button>

      {/* History list */}
      {showHistory && (
        <div className="mb-3 border border-slate-800 rounded-lg overflow-hidden text-xs">
          {history.length === 0 ? (
            <p className="text-slate-500 px-3 py-2.5">No previous passwords recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-800">
              {history.map(h => (
                <div key={h.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="text-slate-600 w-[90px] flex-shrink-0">
                    {new Date(h.replacedAt).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </span>
                  <span className="flex-1 font-mono text-slate-400 truncate">
                    {revealedHistory[h.id!] ?? '••••••••'}
                  </span>
                  <button
                    onClick={() => toggleHistoryReveal(h)}
                    title="Reveal"
                    className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
                  >
                    {revealingHistory.has(h.id!)
                      ? <div className="w-3.5 h-3.5 border border-slate-500 border-t-transparent rounded-full animate-spin" />
                      : <EyeIcon crossed={!!revealedHistory[h.id!]} size="w-3.5 h-3.5" />
                    }
                  </button>
                  <button
                    onClick={() => copyHistoryItem(h)}
                    title="Copy (cleared in 30s)"
                    className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
                  >
                    {copiedHistory === h.id ? <CheckIcon size="w-3.5 h-3.5" /> : <CopyIcon size="w-3.5 h-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recovery codes toggle — only rendered when the entry has codes stored */}
      {hasRecoveryCodes && (
        <button
          onClick={toggleCodes}
          disabled={loadingCodes}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 transition-colors mb-2"
        >
          {loadingCodes
            ? <div className="w-3 h-3 border border-slate-500 border-t-transparent rounded-full animate-spin" />
            : (
              <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 transition-transform ${showCodes ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="6 9 12 15 18 9"/></svg>
            )
          }
          Recovery codes{showCodes ? ` (${codes.length})` : ''}
        </button>
      )}

      {/* Recovery codes list — auto-hides after 30s like a revealed password */}
      {showCodes && (
        <div className="mb-3 border border-slate-800 rounded-lg overflow-hidden text-xs">
          <div className="divide-y divide-slate-800">
            {codes.map((code, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2">
                <span className="text-slate-600 w-[24px] flex-shrink-0">{i + 1}.</span>
                <span className="flex-1 font-mono text-slate-400 truncate select-all">{code}</span>
                <button
                  onClick={() => copyCode(code, i)}
                  title="Copy (cleared in 30s)"
                  className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
                >
                  {copiedCode === i ? <CheckIcon size="w-3.5 h-3.5" /> : <CopyIcon size="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {entry.notes && (
        <p className="text-slate-500 text-xs mb-3 leading-relaxed">{entry.notes}</p>
      )}

      {/* Action row */}
      <div className="flex items-center justify-between">
        <span className="text-slate-600 text-xs">
          Updated {updatedDaysAgo === 0 ? 'today' : `${updatedDaysAgo}d ago`}
        </span>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(entry)}
            className="text-xs text-slate-400 hover:text-primary px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            Edit
          </button>

          {showDeleteConfirm ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-600">Delete?</span>
              <button
                onClick={() => onDelete(entry.id!)}
                className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
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
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-xs text-slate-500 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
