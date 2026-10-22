'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from '@/hooks/useSession'
import { db, type VaultEntry } from '@/lib/db'
import { decryptEntry } from '@/lib/crypto'
import { scorePassword, type StrengthResult } from '@/lib/generator'

const AGE_WARNING_DAYS = 90

interface EntryAnalysis {
  entry:       VaultEntry
  plainPw:     string
  strength:    StrengthResult
  isPin:       boolean
  isDuplicate: boolean
  isOld:       boolean
  ageDays:     number
}

export default function HealthDashboard() {
  const { encryptionKey } = useSession()

  const [analyses, setAnalyses] = useState<EntryAnalysis[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzed, setAnalyzed] = useState(false)

  const runAnalysis = useCallback(async () => {
    if (!encryptionKey) return
    setIsAnalyzing(true)

    try {
      const entries = await db.vault_entries.orderBy('site').toArray()

      const decryptedMap = new Map<number, string>()
      await Promise.all(
        entries.map(async entry => {
          const pw = await decryptEntry(encryptionKey, entry.encryptedPassword, entry.iv)
          decryptedMap.set(entry.id!, pw)
        })
      )

      const pwGroups = new Map<string, number[]>()
      for (const [id, pw] of decryptedMap) {
        const group = pwGroups.get(pw) ?? []
        group.push(id)
        pwGroups.set(pw, group)
      }
      const duplicateIds = new Set<number>()
      for (const ids of pwGroups.values()) {
        if (ids.length > 1) ids.forEach(id => duplicateIds.add(id))
      }

      const now = Date.now()
      const results: EntryAnalysis[] = entries.map(entry => {
        const plainPw = decryptedMap.get(entry.id!)!
        const ageDays = Math.floor((now - new Date(entry.updatedAt).getTime()) / (24 * 60 * 60 * 1000))
        return {
          entry,
          plainPw,
          strength:    scorePassword(plainPw),
          isPin:       (entry.entryType ?? 'password') === 'pin',
          isDuplicate: duplicateIds.has(entry.id!),
          isOld:       ageDays >= AGE_WARNING_DAYS,
          ageDays,
        }
      })

      setAnalyses(results)
      setAnalyzed(true)

      // Results stay in memory only. Persisting strength/duplicate flags to
      // IndexedDB would hand anyone who reads the DB a map of the weakest
      // entries. The clear() removes flags written by older versions.
      await db.health_flags.clear()

    } finally {
      setIsAnalyzing(false)
    }
  }, [encryptionKey])

  useEffect(() => { runAnalysis() }, [runAnalysis])

  // PINs are inherently low-entropy — scoring them as "weak" is expected, not
  // actionable. They are excluded from strength scoring but still checked for
  // reuse and age, which apply to PINs just as much as passwords.
  const total      = analyses.length
  const pinCount   = analyses.filter(a => a.isPin).length
  const weakCount  = analyses.filter(a => !a.isPin && a.strength.label === 'weak').length
  const fairCount  = analyses.filter(a => !a.isPin && a.strength.label === 'fair').length
  const dupCount   = analyses.filter(a => a.isDuplicate).length
  const oldCount   = analyses.filter(a => a.isOld).length
  // fairCount is included: fair entries appear in the issue section below,
  // so "No issues found" must not show while that section is visible
  const issueCount = weakCount + fairCount + dupCount + oldCount

  const weakEntries      = analyses.filter(a => !a.isPin && (a.strength.label === 'weak' || a.strength.label === 'fair'))
  const duplicateEntries = analyses.filter(a => a.isDuplicate)
  const oldEntries       = analyses.filter(a => a.isOld)

  if (isAnalyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">Decrypting and analyzing your vault…</p>
      </div>
    )
  }

  if (!analyzed) return null

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-primary text-xl font-semibold">Security Health</h2>
          <p className="text-slate-400 text-sm mt-1">
            {total} entr{total === 1 ? 'y' : 'ies'} analyzed · {issueCount === 0 ? 'No issues found' : `${issueCount} issue${issueCount > 1 ? 's' : ''} found`}
            {pinCount > 0 && ` · ${pinCount} PIN${pinCount > 1 ? 's' : ''} excluded from strength scoring`}
          </p>
        </div>
        <button
          onClick={runAnalysis}
          className="text-sm text-brand-600 hover:text-brand-500 flex items-center gap-1.5 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Re-analyze
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          label="Total"
          value={total}
          color="text-primary"
          bg="bg-slate-800"
          border="border-slate-700"
        />
        <SummaryCard
          label="Weak / Fair"
          value={weakCount + fairCount}
          color={weakCount + fairCount > 0 ? 'text-red-600' : 'text-green-700'}
          bg={weakCount + fairCount > 0 ? 'bg-red-50' : 'bg-green-50'}
          border={weakCount + fairCount > 0 ? 'border-red-200' : 'border-green-200'}
        />
        <SummaryCard
          label="Duplicates"
          value={dupCount}
          color={dupCount > 0 ? 'text-orange-600' : 'text-green-700'}
          bg={dupCount > 0 ? 'bg-orange-50' : 'bg-green-50'}
          border={dupCount > 0 ? 'border-orange-200' : 'border-green-200'}
        />
        <SummaryCard
          label={`${AGE_WARNING_DAYS}d+ Old`}
          value={oldCount}
          color={oldCount > 0 ? 'text-amber-700' : 'text-green-700'}
          bg={oldCount > 0 ? 'bg-amber-50' : 'bg-green-50'}
          border={oldCount > 0 ? 'border-amber-200' : 'border-green-200'}
        />
      </div>

      {/* All clear */}
      {issueCount === 0 && total > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">✅</div>
          <h3 className="text-green-700 font-semibold text-lg mb-1">All Clear!</h3>
          <p className="text-green-600 text-sm">
            All {total} entr{total === 1 ? 'y is' : 'ies are'} unique and up to date, with no weak passwords.
          </p>
        </div>
      )}

      {weakEntries.length > 0 && (
        <IssueSection
          title="Weak or Fair Passwords"
          icon="⚠️"
          color="red"
          description="These passwords may be easy to guess or brute-force. Consider replacing them with stronger ones."
          analyses={weakEntries}
        />
      )}

      {duplicateEntries.length > 0 && (
        <IssueSection
          title="Reused Passwords"
          icon="🔁"
          color="orange"
          description="These sites share the same password. If one account is breached, all others with this password are at risk."
          analyses={duplicateEntries}
        />
      )}

      {oldEntries.length > 0 && (
        <IssueSection
          title={`Passwords Older Than ${AGE_WARNING_DAYS} Days`}
          icon="📅"
          color="amber"
          description="These passwords haven't been changed in a while. Regular rotation reduces risk from unreported breaches."
          analyses={oldEntries}
        />
      )}
    </div>
  )
}

function SummaryCard({
  label, value, color, bg, border
}: {
  label: string; value: number; color: string; bg: string; border: string
}) {
  return (
    <div className={`${bg} border ${border} rounded-xl p-4 text-center`}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  )
}

const issueColors = {
  red:    { section: 'bg-red-50 border-red-200',    title: 'text-red-700'    },
  orange: { section: 'bg-orange-50 border-orange-200', title: 'text-orange-700' },
  amber:  { section: 'bg-amber-50 border-amber-200',  title: 'text-amber-700'  },
} as const

function IssueSection({
  title, icon, color, description, analyses
}: {
  title: string
  icon: string
  color: keyof typeof issueColors
  description: string
  analyses: EntryAnalysis[]
}) {
  const { section, title: titleColor } = issueColors[color]

  return (
    <div className={`border ${section} rounded-2xl overflow-hidden`}>
      <div className="px-5 py-4 border-b border-slate-700">
        <h3 className={`font-semibold flex items-center gap-2 ${titleColor}`}>
          <span aria-hidden="true">{icon}</span>
          {title} ({analyses.length})
        </h3>
        <p className="text-slate-500 text-xs mt-1">{description}</p>
      </div>
      <div className="divide-y divide-slate-700">
        {analyses.map(({ entry, strength, isPin, ageDays }) => (
          <div key={entry.id} className="px-5 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-primary text-sm font-medium truncate">{entry.site}</p>
              <p className="text-slate-500 text-xs truncate">{entry.username}</p>
            </div>
            <div className="flex items-center gap-2 text-xs flex-shrink-0">
              {isPin ? (
                <span className="bg-slate-800 border border-slate-700 text-slate-400 rounded px-1.5 py-0.5">
                  PIN
                </span>
              ) : (
                <span className={
                  strength.label === 'weak' ? 'text-red-600' :
                  strength.label === 'fair' ? 'text-yellow-600' :
                  'text-slate-400'
                }>
                  {strength.label} ({strength.score}/100)
                </span>
              )}
              {ageDays >= 90 && (
                <span className="text-amber-700">{ageDays}d</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
