/**
 * components/ExportImport.tsx — Vault backup, restore, and full reset
 *
 * Four operations:
 *
 *  1. Export .vault (encrypted backup)
 *     - Bundles all encrypted entries + Argon2 salt into a JSON file
 *     - HMAC-signed to detect corruption
 *     - Safe to store anywhere — requires master password to decrypt
 *     - Filename: lokr-backup.vault
 *
 *  2. Export .csv (plaintext — DANGEROUS)
 *     - Decrypts all passwords and writes them to a plain text CSV
 *     - User must type "CONFIRM" in a text field before button enables
 *     - Warns prominently that this file contains all passwords in plaintext
 *     - Filename: lokr-export.csv
 *
 *  3. Import .vault
 *     - User picks the file AND enters the master password the backup was
 *       created with — keys are derived from the file's own salt, so backups
 *       from another device or a pre-reset vault restore correctly
 *     - HMAC is verified with the file-derived key before any local write
 *     - Existing vault is cleared before import (full replace, not merge)
 *     - Sticky notes aren't in backups yet (task 2.3), so restore deletes them;
 *       when there are any, the user must tick a box naming how many first
 *     - Vault is re-signed and the session adopts the file-derived keys
 *
 *  4. Full reset (⚠️ DESTRUCTIVE)
 *     - Wipes all IndexedDB data (entries, notes, history, metadata, health flags)
 *     - User must type "RESET" in a text field
 *     - Locks the vault and redirects to /
 *     - Irreversible without a backup
 */

'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from '@/hooks/useSession'
import { db, countStickyNotes, clearStickyNotes } from '@/lib/db'
import { downloadVaultFile, restoreVaultFile, exportCSV } from '@/lib/export'

export default function ExportImport() {
  const { encryptionKey, hmacKey, lock, adoptSessionKeys } = useSession()

  // ── Vault export state ────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false)
  const [exportSuccess, setExportSuccess] = useState(false)

  // ── CSV export state ──────────────────────────────────────────────────────────
  const [csvConfirmText, setCsvConfirmText] = useState('')
  const [isExportingCsv, setIsExportingCsv] = useState(false)

  // ── Import state ──────────────────────────────────────────────────────────────
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPassword, setImportPassword] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ count: number } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Local sticky notes a restore would delete (backups don't carry them until 2.3)
  const [noteCount, setNoteCount] = useState(0)
  const [notesAcknowledged, setNotesAcknowledged] = useState(false)

  // ── Reset state ───────────────────────────────────────────────────────────────
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [isResetting, setIsResetting] = useState(false)

  // ── Last backup info ──────────────────────────────────────────────────────────
  const [lastBackupDate, setLastBackupDate] = useState<Date | null>(null)

  // Load last backup date on mount
  useEffect(() => {
    db.vault_meta.get(1).then(meta => {
      if (meta?.lastBackupAt) setLastBackupDate(new Date(meta.lastBackupAt))
    })
  }, [])

  // ── Export .vault ─────────────────────────────────────────────────────────────
  async function handleExportVault() {
    if (!hmacKey) return
    setIsExporting(true)
    setExportSuccess(false)

    try {
      const meta = await db.vault_meta.get(1)
      if (!meta?.salt) throw new Error('No vault metadata found.')
      await downloadVaultFile(hmacKey, meta.salt)
      setExportSuccess(true)
      setLastBackupDate(new Date())
      setTimeout(() => setExportSuccess(false), 3000)
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsExporting(false)
    }
  }

  // ── Export .csv ───────────────────────────────────────────────────────────────
  async function handleExportCsv() {
    if (!encryptionKey || csvConfirmText !== 'CONFIRM') return
    setIsExportingCsv(true)
    try {
      await exportCSV(encryptionKey)
      setCsvConfirmText('')
    } catch (err) {
      alert(`CSV export failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsExportingCsv(false)
    }
  }

  // ── Import .vault ─────────────────────────────────────────────────────────────
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setImportFile(e.target.files?.[0] ?? null)
    setImportResult(null)
    setImportError(null)
    setNotesAcknowledged(false)
    // Counted from the table, never decrypted — no key needed
    setNoteCount(await countStickyNotes())
  }

  const restoreBlockedByNotes = noteCount > 0 && !notesAcknowledged

  async function handleRestore() {
    if (!importFile || !importPassword || restoreBlockedByNotes) return

    setIsImporting(true)
    setImportResult(null)
    setImportError(null)

    try {
      const content = await importFile.text()

      // Derives keys from the FILE's salt + the entered password, verifies the
      // HMAC, replaces all local data, and re-signs the vault.
      const { count, encryptionKey: newEncKey, hmacKey: newHmacKey } =
        await restoreVaultFile(importPassword, content)

      // The restored vault may have a different salt/password than the current
      // session — swap in the keys that actually match the restored data.
      adoptSessionKeys(newEncKey, newHmacKey)

      setImportResult({ count })
      setImportFile(null)
      setImportPassword('')
      setNoteCount(0)
      setNotesAcknowledged(false)
      if (fileInputRef.current) fileInputRef.current.value = ''

    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  // ── Full reset ────────────────────────────────────────────────────────────────
  async function handleReset() {
    if (resetConfirmText !== 'RESET') return
    setIsResetting(true)

    try {
      // Wipe all IndexedDB tables
      await db.vault_entries.clear()
      await db.health_flags.clear()
      await db.password_history.clear()
      // Notes must go too: left behind under the old key, a new vault's next
      // re-sign would include them and its unlock would be refused.
      await clearStickyNotes()
      await db.vault_meta.clear()
      // Lock vault and redirect to /
      lock()
    } catch (err) {
      alert(`Reset failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      setIsResetting(false)
    }
  }

  // ── Days since last backup ────────────────────────────────────────────────────
  const daysSinceBackup = lastBackupDate
    ? Math.floor((Date.now() - lastBackupDate.getTime()) / (24 * 60 * 60 * 1000))
    : null

  const shouldWarnBackup = daysSinceBackup === null || daysSinceBackup >= 7

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-primary text-xl font-semibold mb-1">Backup & Restore</h2>
        <p className="text-slate-400 text-sm">
          Export encrypted backups regularly. Store them in a cloud drive or external disk.
        </p>
      </div>

      {/* ── Backup reminder ──────────────────────────────────────────────── */}
      {shouldWarnBackup && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-start gap-3">
          <span className="text-xl mt-0.5" aria-hidden="true">⏰</span>
          <div>
            <p className="text-amber-700 font-medium text-sm">Time for a backup</p>
            <p className="text-amber-600 text-xs mt-0.5">
              {daysSinceBackup === null
                ? "You haven't made a backup yet."
                : `Last backup was ${daysSinceBackup} days ago.`
              }
              {' '}Regular backups protect you if your device is lost or damaged.
            </p>
          </div>
        </div>
      )}

      {/* ── Section 1: Encrypted .vault export ───────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-primary font-medium flex items-center gap-2">
              <span aria-hidden="true">💾</span> Export Encrypted Backup
            </h3>
            <p className="text-slate-500 text-sm mt-1">
              Downloads a <code className="text-slate-400">.vault</code> file. Passwords stay encrypted — safe to store anywhere.
            </p>
            <p className="text-slate-500 text-xs mt-1">
              Sticky notes aren&apos;t included in backups yet.
            </p>
          </div>
          {lastBackupDate && (
            <span className="text-xs text-slate-500 flex-shrink-0 ml-4">
              Last: {lastBackupDate.toLocaleDateString()}
            </span>
          )}
        </div>

        <button
          onClick={handleExportVault}
          disabled={isExporting}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium text-sm py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {isExporting ? (
            <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Exporting…</>
          ) : exportSuccess ? (
            <><svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg> Saved!</>
          ) : (
            'Download lokr-backup.vault'
          )}
        </button>
      </div>

      {/* ── Section 2: Import .vault ──────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-primary font-medium flex items-center gap-2">
            <span aria-hidden="true">📥</span> Import Backup
          </h3>
          <p className="text-slate-500 text-sm mt-1">
            Restore from a <code className="text-slate-400">.vault</code> file.
            <strong className="text-amber-700"> This replaces your current vault.</strong>
          </p>
        </div>

        <label className="block">
          <input
            ref={fileInputRef}
            type="file"
            accept=".vault,application/json"
            onChange={handleFileSelect}
            disabled={isImporting}
            className="block w-full text-sm text-slate-400
              file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
              file:text-sm file:font-medium file:bg-brand-500 file:text-white
              hover:file:bg-brand-600 file:transition-colors file:cursor-pointer
              cursor-pointer"
          />
        </label>

        {importFile && (
          <div className="space-y-3">
            <div>
              <label htmlFor="import-password" className="block text-sm text-slate-400 mb-1.5">
                Master password of this backup
              </label>
              <input
                id="import-password"
                type="password"
                value={importPassword}
                onChange={e => setImportPassword(e.target.value)}
                placeholder="The password used when the backup was created"
                autoComplete="off"
                disabled={isImporting}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-primary placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
              />
              <p className="text-slate-500 text-xs mt-1.5">
                Backups from another device or an older vault are fine — the file
                carries everything needed except this password.
              </p>
            </div>
            {noteCount > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-2">
                <p className="text-amber-700 text-sm">
                  Notes aren&apos;t included in backups yet; restoring deletes
                  your {noteCount} {noteCount === 1 ? 'note' : 'notes'}.
                </p>
                <label className="flex items-center gap-2 text-sm text-amber-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notesAcknowledged}
                    onChange={e => setNotesAcknowledged(e.target.checked)}
                    disabled={isImporting}
                    className="accent-amber-600"
                  />
                  I understand my {noteCount} {noteCount === 1 ? 'note' : 'notes'} will be deleted
                </label>
              </div>
            )}
            <button
              onClick={handleRestore}
              disabled={!importPassword || isImporting || restoreBlockedByNotes}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium text-sm py-2.5 rounded-xl transition-colors"
            >
              {isImporting ? 'Verifying and restoring…' : 'Restore Backup'}
            </button>
          </div>
        )}

        {isImporting && (
          <p className="text-brand-600 text-sm flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
            Verifying and importing…
          </p>
        )}
        {importResult && (
          <p className="text-green-600 text-sm">
            ✓ Imported {importResult.count} entries successfully.
          </p>
        )}
        {importError && (
          <p className="text-red-600 text-sm">✗ {importError}</p>
        )}
      </div>

      {/* ── Section 3: CSV export (dangerous) ────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-primary font-medium flex items-center gap-2">
            <span aria-hidden="true">⚠️</span> Export Plaintext CSV
          </h3>
          {/* Large, prominent warning */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-2">
            <p className="text-red-700 text-sm font-medium">Danger: Contains All Passwords In Plaintext</p>
            <p className="text-red-600 text-xs mt-1">
              This CSV contains every password unencrypted. Anyone who opens this file
              can read all your credentials. Delete it immediately after use.
              Only export if migrating to another password manager.
            </p>
          </div>
        </div>

        {/* Hard confirmation: must type CONFIRM */}
        <div>
          <label className="block text-sm text-slate-400 mb-1.5">
            Type <span className="text-primary font-mono font-bold">CONFIRM</span> to enable export:
          </label>
          <input
            type="text"
            value={csvConfirmText}
            onChange={e => setCsvConfirmText(e.target.value)}
            placeholder="Type CONFIRM here"
            autoComplete="off"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-primary placeholder-slate-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
          />
        </div>

        <button
          onClick={handleExportCsv}
          disabled={csvConfirmText !== 'CONFIRM' || isExportingCsv}
          className="w-full bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium text-sm py-2.5 rounded-xl transition-colors"
        >
          {isExportingCsv ? 'Exporting…' : 'Download lokr-export.csv'}
        </button>
      </div>

      {/* ── Section 4: Full reset ─────────────────────────────────────────── */}
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-red-700 font-medium flex items-center gap-2">
            <span aria-hidden="true">💣</span> Full Reset — Wipe All Data
          </h3>
          <p className="text-red-600 text-sm mt-1">
            Permanently deletes all vault entries, sticky notes and metadata from this device.
            This cannot be undone. Export a backup first.
          </p>
        </div>

        {/* Hard confirmation: must type RESET */}
        <div>
          <label className="block text-sm text-red-600 mb-1.5">
            Type <span className="text-red-700 font-mono font-bold">RESET</span> to confirm permanent deletion:
          </label>
          <input
            type="text"
            value={resetConfirmText}
            onChange={e => setResetConfirmText(e.target.value)}
            placeholder="Type RESET here"
            autoComplete="off"
            className="w-full bg-slate-800 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-primary placeholder-slate-500 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600"
          />
        </div>

        <button
          onClick={handleReset}
          disabled={resetConfirmText !== 'RESET' || isResetting}
          className="w-full bg-red-800 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium text-sm py-2.5 rounded-xl transition-colors"
        >
          {isResetting ? 'Wiping vault…' : 'Permanently Delete Everything'}
        </button>
      </div>
    </div>
  )
}
