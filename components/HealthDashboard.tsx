'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from '@/hooks/useSession'
import { db, type VaultEntry } from '@/lib/db'
import { decryptEntry } from '@/lib/crypto'
import { analyseEntries, type DecryptedItem, type EntryFlags } from '@/lib/entryAnalysis'
import {
  CalendarIcon, CheckCircleIcon, RefreshIcon, RepeatIcon, WarningIcon,
} from '@/components/Icons'
import {
  CARD, CARD_SURFACE, CHIP, CHIP_DOT, ERROR_BANNER, QUIET_BUTTON, STATUS_DOT, STRENGTH_TONE, type StatusTone,
} from '@/components/ui'

const AGE_WARNING_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

interface EntryAnalysis {
  entry:       VaultEntry
  flags:       EntryFlags   // strength is null for PINs
  isOld:       boolean
  ageDays:     number
}

export default function HealthDashboard() {
  const { encryptionKey } = useSession()

  const [analyses, setAnalyses] = useState<EntryAnalysis[]>([])
  const [unreadable, setUnreadable] = useState(0)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzed, setAnalyzed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runAnalysis = useCallback(async () => {
    if (!encryptionKey) return
    setIsAnalyzing(true)
    setError(null)

    try {
      const entries = await db.vault_entries.orderBy('site').toArray()

      // Each entry is decrypted on its own (as on the Vault tab, 3.3): one that
      // won't decrypt is left out and counted, instead of failing the whole
      // analysis and leaving the screen blank (3.5)
      const decrypted = await Promise.all(entries.map(async (e): Promise<DecryptedItem | null> => {
        try {
          const password = await decryptEntry(encryptionKey, e.encryptedPassword, e.iv)
          return { id: e.id!, password, isPin: e.entryType === 'pin' }
        } catch {
          return null
        }
      }))
      const readable = decrypted.filter((d): d is DecryptedItem => d !== null)
      // Only flags come back; the plaintext goes out of scope here
      const flags = analyseEntries(readable)

      const now = Date.now()
      const results: EntryAnalysis[] = []
      for (const entry of entries) {
        const f = flags.get(entry.id!)
        if (!f) continue
        const ageDays = Math.floor((now - new Date(entry.updatedAt).getTime()) / DAY_MS)
        results.push({ entry, flags: f, isOld: ageDays >= AGE_WARNING_DAYS, ageDays })
      }

      setAnalyses(results)
      setUnreadable(entries.length - readable.length)
      setAnalyzed(true)

      // Results stay in memory only. Persisting strength/duplicate flags to
      // IndexedDB would hand anyone who reads the DB a map of the weakest
      // entries. The clear() removes flags written by older versions.
      await db.health_flags.clear()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsAnalyzing(false)
    }
  }, [encryptionKey])

  useEffect(() => { runAnalysis() }, [runAnalysis])

  // PINs are inherently low-entropy — scoring them as "weak" is expected, not
  // actionable. They are excluded from strength scoring (analyseEntries gives
  // them no strength) but still checked for reuse and age.
  const isWeakOrFair = (a: EntryAnalysis) =>
    a.flags.strength?.label === 'weak' || a.flags.strength?.label === 'fair'

  const total      = analyses.length
  const pinCount   = analyses.filter(a => a.flags.strength === null).length
  const weakEntries      = analyses.filter(isWeakOrFair)
  const duplicateEntries = analyses.filter(a => a.flags.isDuplicate)
  const oldEntries       = analyses.filter(a => a.isOld)
  // Fair entries appear in the issue list below, so they count: "No issues
  // found" must not show while that section is visible
  const issueCount = weakEntries.length + duplicateEntries.length + oldEntries.length

  if (isAnalyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">Decrypting and analyzing your vault…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className={ERROR_BANNER} role="alert">
          <WarningIcon className="w-4 h-4 mt-0.5 flex-shrink-0 text-danger" />
          <div className="flex-1">
            <p>Couldn&apos;t analyse the vault: {error}</p>
            <button onClick={runAnalysis} className="mt-1 text-sm font-medium text-brand-600 hover:text-brand-500">
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!analyzed) return null

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-[1_1_16rem]">
          <h2 className="text-primary text-xl font-semibold">
            Security <span className="font-serif italic font-normal">health</span>
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            {total} entr{total === 1 ? 'y' : 'ies'} analyzed · {issueCount === 0 ? 'No issues found' : `${issueCount} issue${issueCount > 1 ? 's' : ''} found`}
            {pinCount > 0 && ` · ${pinCount} PIN${pinCount > 1 ? 's' : ''} excluded from strength scoring`}
            {unreadable > 0 && ` · ${unreadable} entr${unreadable === 1 ? 'y' : 'ies'} couldn't be read`}
          </p>
        </div>
        <button
          onClick={runAnalysis}
          className={QUIET_BUTTON}
        >
          <RefreshIcon className="w-4 h-4" />
          Re-analyze
        </button>
      </div>

      {/* Summary tiles: plain numbers, a status dot only when there is something to fix */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Total" value={total} tone={null} />
        <StatTile label="Weak / fair" value={weakEntries.length} tone="danger" />
        <StatTile label="Reused" value={duplicateEntries.length} tone="warning" />
        <StatTile label={`${AGE_WARNING_DAYS}d+ old`} value={oldEntries.length} tone="warning" />
      </div>

      {/* All clear: only when nothing is wrong and every entry could be read */}
      {issueCount === 0 && unreadable === 0 && total > 0 && (
        <div className={`${CARD} text-center py-10`}>
          <CheckCircleIcon className="w-9 h-9 mx-auto mb-3 text-success" />
          <h3 className="text-primary font-semibold text-lg mb-1">
            All <span className="font-serif italic font-normal">clear</span>
          </h3>
          <p className="text-slate-400 text-sm">
            All {total} entr{total === 1 ? 'y is' : 'ies are'} unique and up to date, with no weak passwords.
          </p>
        </div>
      )}

      {weakEntries.length > 0 && (
        <IssueSection
          title="Weak or fair passwords"
          Icon={WarningIcon}
          iconClass="text-danger"
          description="These passwords may be easy to guess or brute-force. Consider replacing them with stronger ones."
          analyses={weakEntries}
        />
      )}

      {duplicateEntries.length > 0 && (
        <IssueSection
          title="Reused passwords"
          Icon={RepeatIcon}
          iconClass="text-warning"
          description="These sites share the same password. If one account is breached, all others with this password are at risk."
          analyses={duplicateEntries}
        />
      )}

      {oldEntries.length > 0 && (
        <IssueSection
          title={`Older than ${AGE_WARNING_DAYS} days`}
          Icon={CalendarIcon}
          iconClass="text-warning"
          description="These passwords haven't been changed in a while. Regular rotation reduces risk from unreported breaches."
          analyses={oldEntries}
        />
      )}
    </div>
  )
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: StatusTone | null }) {
  return (
    <div className={`rounded-2xl px-4 py-4 ${CARD_SURFACE}`}>
      <div className="text-2xl font-semibold text-primary tabular-nums">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
        {tone && value > 0 && <span className={`${CHIP_DOT} ${STATUS_DOT[tone]}`} aria-hidden="true" />}
        {label}
      </div>
    </div>
  )
}

function IssueSection({
  title, Icon, iconClass, description, analyses
}: {
  title: string
  Icon: (_props: { className?: string }) => JSX.Element  // a line icon from Icons.tsx (3.2)
  iconClass: 'text-danger' | 'text-warning'  // literal, so Tailwind builds it
  description: string
  analyses: EntryAnalysis[]
}) {
  return (
    <section className={`rounded-3xl overflow-hidden ${CARD_SURFACE}`}>
      <div className="px-5 pt-5 pb-3">
        <h3 className="text-primary font-semibold flex items-center gap-2">
          <Icon className={`w-4 h-4 ${iconClass}`} />
          {title}
          <span className="text-slate-500 font-normal">{analyses.length}</span>
        </h3>
        <p className="text-slate-500 text-xs mt-1">{description}</p>
      </div>
      <div className="divide-y divide-slate-700 border-t border-slate-700">
        {analyses.map(({ entry, flags, isOld, ageDays }) => (
          <div key={entry.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-[1_1_10rem]">
              <p className="text-primary text-sm font-medium truncate">{entry.site}</p>
              <p className="text-slate-500 text-xs truncate">{entry.username}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {flags.strength === null ? (
                <span className={CHIP}>PIN</span>
              ) : (
                <span className={CHIP}>
                  <span className={`${CHIP_DOT} ${STATUS_DOT[STRENGTH_TONE[flags.strength.label]]}`} aria-hidden="true" />
                  {flags.strength.label} · {flags.strength.score}/100
                </span>
              )}
              {isOld && (
                <span className={CHIP}>
                  <span className={`${CHIP_DOT} ${STATUS_DOT.warning}`} aria-hidden="true" />
                  {ageDays}d old
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
