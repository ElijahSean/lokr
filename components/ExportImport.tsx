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
 *  4. Full reset (DESTRUCTIVE)
 *     - Wipes all IndexedDB data (entries, notes, history, metadata, health flags)
 *     - User must type "RESET" in a text field
 *     - Locks the vault and redirects to /
 *     - Irreversible without a backup
 */

'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from '@/hooks/useSession'
import { db, countStickyNotes, clearAllVaultData } from '@/lib/db'
import { downloadVaultFile, restoreVaultFile, exportCSV } from '@/lib/export'
import { CheckIcon, ClockIcon, DownloadIcon, TrashIcon, UploadIcon, WarningIcon } from '@/components/Icons'
import {
  CARD, DANGER_CARD, DANGER_OUTLINE, ERROR_BANNER, INPUT, NOTICE_BANNER, PRIMARY_BUTTON,
} from '@/components/ui'

export default function ExportImport() {
  const { encryptionKey, hmacKey, lock, adoptSessionKeys } = useSession()

  // ── Vault export state ────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false)
  const [exportSuccess, setExportSuccess] = useState(false)
  // Failures show in their own section, never as a browser pop-up (3.5)
  const [exportError, setExportError] = useState<string | null>(null)

  // ── CSV export state ──────────────────────────────────────────────────────────
  const [csvConfirmText, setCsvConfirmText] = useState('')
  const [isExportingCsv, setIsExportingCsv] = useState(false)
  const [csvError, setCsvError] = useState<string | null>(null)

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
  const [resetError, setResetError] = useState<string | null>(null)

  // ── Last backup info ──────────────────────────────────────────────────────────
  const [lastBackupDate, setLastBackupDate] = useState<Date | null>(null)

  // Load last backup date on mount
  useEffect(() => {
    async function loadLastBackup() {
      const meta = await db.vault_meta.get(1)
      if (meta?.lastBackupAt) setLastBackupDate(new Date(meta.lastBackupAt))
    }
    void loadLastBackup()
  }, [])

  // ── Export .vault ─────────────────────────────────────────────────────────────
  async function handleExportVault() {
    if (!hmacKey) return
    setIsExporting(true)
    setExportSuccess(false)
    setExportError(null)

    try {
      const meta = await db.vault_meta.get(1)
      if (!meta?.salt) throw new Error('No vault metadata found.')
      await downloadVaultFile(hmacKey, meta.salt)
      setExportSuccess(true)
      setLastBackupDate(new Date())
      setTimeout(() => setExportSuccess(false), 3000)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsExporting(false)
    }
  }

  // ── Export .csv ───────────────────────────────────────────────────────────────
  async function handleExportCsv() {
    if (!encryptionKey || csvConfirmText !== 'CONFIRM') return
    setIsExportingCsv(true)
    setCsvError(null)
    try {
      await exportCSV(encryptionKey)
      setCsvConfirmText('')
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Unknown error')
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
      const { count, encryptionKey: newEncKey, hmacKey: newHmacKey, lastBackupAt } =
        await restoreVaultFile(importPassword, content)

      // The restored vault may have a different salt/password than the current
      // session — swap in the keys that actually match the restored data.
      adoptSessionKeys(newEncKey, newHmacKey)
      setLastBackupDate(lastBackupAt)

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
    setResetError(null)

    try {
      // The database helper owns one transaction across every store, so a
      // failed clear rolls the whole wipe back before this success-only lock.
      await clearAllVaultData()
      lock()
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Unknown error')
      setIsResetting(false)
    }
  }

  // ── Days since last backup ────────────────────────────────────────────────────
  const daysSinceBackup = lastBackupDate
    ? Math.floor((Date.now() - lastBackupDate.getTime()) / (24 * 60 * 60 * 1000))
    : null

  const shouldWarnBackup = daysSinceBackup === null || daysSinceBackup >= 7

  // ── Render ────────────────────────────────────────────────────────────────────
  // Two groups (3.5): Backup (export, import) on plain cards, then a Danger zone
  // (CSV export, full reset) on cards with a thin red edge. Colour is only ever
  // an edge, a dot or an icon; text stays neutral (CLAUDE.md, status tokens).
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-primary text-xl font-semibold mb-1">
          Backup <span className="font-serif italic font-normal">&amp;</span> Restore
        </h2>
        <p className="text-slate-400 text-sm">
          Export encrypted backups regularly. Store them in a cloud drive or external disk.
        </p>
      </div>

      {/* ── Backup reminder ──────────────────────────────────────────────── */}
      {shouldWarnBackup && (
        <div className={NOTICE_BANNER}>
          <ClockIcon className="w-4 h-4 mt-0.5 flex-shrink-0 text-warning" />
          <div>
            <p className="font-medium">Time for a backup</p>
            <p className="text-slate-400 text-xs mt-0.5">
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
      <section className={`${CARD} space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0 flex-[1_1_16rem]">
            <h3 className="text-primary font-medium flex items-center gap-2">
              <DownloadIcon /> Export encrypted backup
            </h3>
            <p className="text-slate-500 text-sm mt-1">
              Downloads a <code className="text-slate-400">.vault</code> file. Passwords stay encrypted — safe to store anywhere.
            </p>
            <p className="text-slate-500 text-xs mt-1">
              Sticky notes aren&apos;t included in backups yet.
            </p>
          </div>
          {lastBackupDate && (
            <span className="text-xs text-slate-500 flex-shrink-0">
              Last: {lastBackupDate.toLocaleDateString()}
            </span>
          )}
        </div>

        <button
          onClick={handleExportVault}
          disabled={isExporting}
          className={`${PRIMARY_BUTTON} w-full`}
        >
          {isExporting ? (
            <><span className="w-4 h-4 border-2 border-brand-label border-t-transparent rounded-full animate-spin" /> Exporting…</>
          ) : exportSuccess ? (
            <><CheckIcon className="w-4 h-4" /> Saved</>
          ) : (
            'Download lokr-backup.vault'
          )}
        </button>

        {exportError && (
          <div className={ERROR_BANNER} role="alert">
            <WarningIcon className="w-4 h-4 mt-0.5 flex-shrink-0 text-danger" />
            <span>Export failed: {exportError}</span>
          </div>
        )}
      </section>

      {/* ── Section 2: Import .vault ──────────────────────────────────────── */}
      <section className={`${CARD} space-y-4`}>
        <div>
          <h3 className="text-primary font-medium flex items-center gap-2">
            <UploadIcon /> Import backup
          </h3>
          <p className="text-slate-500 text-sm mt-1">
            Restore from a <code className="text-slate-400">.vault</code> file.
            <strong className="text-primary font-medium"> This replaces your current vault.</strong>
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
              file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0
              file:text-sm file:font-medium file:bg-slate-800 file:text-slate-300
              hover:file:bg-slate-700 hover:file:text-primary file:transition-colors file:cursor-pointer
              cursor-pointer"
          />
        </label>

        {importFile && (
          <div className="space-y-3">
            <div>
              <label htmlFor="import-password" className="block text-sm font-medium text-slate-400 mb-1.5">
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
                className={INPUT}
              />
              <p className="text-slate-500 text-xs mt-1.5">
                Backups from another device or an older vault are fine — the file
                carries everything needed except this password.
              </p>
            </div>
            {noteCount > 0 && (
              <div className={NOTICE_BANNER}>
                <WarningIcon className="w-4 h-4 mt-0.5 flex-shrink-0 text-warning" />
                <div className="space-y-2">
                  <p>
                    Notes aren&apos;t included in backups yet; restoring deletes
                    your {noteCount} {noteCount === 1 ? 'note' : 'notes'}.
                  </p>
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notesAcknowledged}
                      onChange={e => setNotesAcknowledged(e.target.checked)}
                      disabled={isImporting}
                      className="w-4 h-4 rounded accent-brand-500"
                    />
                    I understand my {noteCount} {noteCount === 1 ? 'note' : 'notes'} will be deleted
                  </label>
                </div>
              </div>
            )}
            <button
              onClick={handleRestore}
              disabled={!importPassword || isImporting || restoreBlockedByNotes}
              className={`${PRIMARY_BUTTON} w-full`}
            >
              {isImporting ? 'Verifying and restoring…' : 'Restore backup'}
            </button>
          </div>
        )}

        {isImporting && (
          <p className="text-slate-400 text-sm flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
            Verifying and importing…
          </p>
        )}
        {importResult && (
          <p className="text-primary text-sm flex items-center gap-2" role="status">
            <CheckIcon className="w-4 h-4 text-success" />
            Imported {importResult.count} entries successfully.
          </p>
        )}
        {importError && (
          <div className={ERROR_BANNER} role="alert">
            <WarningIcon className="w-4 h-4 mt-0.5 flex-shrink-0 text-danger" />
            <span>{importError}</span>
          </div>
        )}
      </section>

      {/* ── Danger zone ───────────────────────────────────────────────────── */}
      <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider pt-2">
        Danger zone
      </h3>

      {/* ── Section 3: CSV export (dangerous) ────────────────────────────── */}
      <section className={`${DANGER_CARD} space-y-4`}>
        <div>
          <h3 className="text-primary font-medium flex items-center gap-2">
            <WarningIcon className="w-4 h-4 text-danger" /> Export plaintext CSV
          </h3>
          <p className="text-primary text-sm font-medium mt-2">Contains all passwords in plaintext</p>
          <p className="text-slate-400 text-sm mt-1">
            This CSV contains every password unencrypted. Anyone who opens this file
            can read all your credentials. Delete it immediately after use.
            Only export if migrating to another password manager.
          </p>
        </div>

        {/* Hard confirmation: must type CONFIRM */}
        <div>
          <label htmlFor="csv-confirm" className="block text-sm text-slate-400 mb-1.5">
            Type <span className="text-primary font-mono font-bold">CONFIRM</span> to enable export:
          </label>
          <input
            id="csv-confirm"
            type="text"
            value={csvConfirmText}
            onChange={e => setCsvConfirmText(e.target.value)}
            placeholder="Type CONFIRM here"
            autoComplete="off"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-primary placeholder-slate-500 focus:border-danger focus:outline-none focus:ring-1 focus:ring-danger"
          />
        </div>

        <button
          onClick={handleExportCsv}
          disabled={csvConfirmText !== 'CONFIRM' || isExportingCsv}
          className={`${DANGER_OUTLINE} w-full font-medium text-sm py-2.5 rounded-full`}
        >
          {/* Outlined, not filled, so it never looks like the graphite Save (3.2) */}
          <WarningIcon />
          {isExportingCsv ? 'Exporting…' : 'Download lokr-export.csv'}
        </button>

        {csvError && (
          <div className={ERROR_BANNER} role="alert">
            <WarningIcon className="w-4 h-4 mt-0.5 flex-shrink-0 text-danger" />
            <span>CSV export failed: {csvError}</span>
          </div>
        )}
      </section>

      {/* ── Section 4: Full reset ─────────────────────────────────────────── */}
      <section className={`${DANGER_CARD} space-y-4`}>
        <div>
          <h3 className="text-primary font-medium flex items-center gap-2">
            <TrashIcon className="w-4 h-4 text-danger" /> Full reset — wipe all data
          </h3>
          <p className="text-slate-400 text-sm mt-1">
            Permanently deletes all vault entries, sticky notes and metadata from this device.
            This cannot be undone. Export a backup first.
          </p>
        </div>

        {/* Hard confirmation: must type RESET */}
        <div>
          <label htmlFor="reset-confirm" className="block text-sm text-slate-400 mb-1.5">
            Type <span className="text-primary font-mono font-bold">RESET</span> to confirm permanent deletion:
          </label>
          <input
            id="reset-confirm"
            type="text"
            value={resetConfirmText}
            onChange={e => setResetConfirmText(e.target.value)}
            placeholder="Type RESET here"
            autoComplete="off"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-primary placeholder-slate-500 focus:border-danger focus:outline-none focus:ring-1 focus:ring-danger"
          />
        </div>

        <button
          onClick={handleReset}
          disabled={resetConfirmText !== 'RESET' || isResetting}
          className={`${DANGER_OUTLINE} w-full font-medium text-sm py-2.5 rounded-full`}
        >
          <WarningIcon />
          {isResetting ? 'Wiping vault…' : 'Permanently delete everything'}
        </button>

        {resetError && (
          <div className={ERROR_BANNER} role="alert">
            <WarningIcon className="w-4 h-4 mt-0.5 flex-shrink-0 text-danger" />
            <span>
              Reset failed: {resetError}. No data was deleted; your vault is unchanged.
            </span>
          </div>
        )}
      </section>
    </div>
  )
}
