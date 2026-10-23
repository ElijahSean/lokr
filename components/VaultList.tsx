/**
 * components/VaultList.tsx — The main vault view: entry list + add/edit modal
 *
 * Responsibilities:
 *  - Load all vault entries from IndexedDB on mount
 *  - Decrypt passwords in memory (never stored as plaintext) for display/copy
 *  - Search/filter across site, username, and notes
 *  - Add, edit, and delete entries — always re-encrypts before writing to IndexedDB
 *  - Update the vault HMAC signature after every write
 *  - Work out strength and duplicate flags per entry for the card chips, in
 *    memory only (lib/entryAnalysis.ts, task 3.3); age is worked out on the card
 *
 * Encryption lifecycle per save:
 *  plaintext password → encryptEntry(key, plaintext) → { ciphertext, iv }
 *  Only the { ciphertext, iv } pair is written to vault_entries in IndexedDB.
 *  The plaintext is discarded immediately after encryption.
 *
 * Decryption lifecycle per reveal/copy:
 *  { ciphertext, iv } from IndexedDB → decryptEntry(key, ciphertext, iv) → plaintext
 *  Plaintext exists only in memory for as long as the user needs it.
 */

'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useSession } from '@/hooks/useSession'
import { db, type VaultEntry } from '@/lib/db'
import { encryptEntry, decryptEntry } from '@/lib/crypto'
import { scorePassword, generatePassword, type GeneratorOptions } from '@/lib/generator'
import { analyseEntries, type DecryptedItem, type EntryFlags } from '@/lib/entryAnalysis'
import EntryCard from './EntryCard'
import {
  CloseIcon, EyeIcon, EyeOffIcon, LockIcon, PinCodeIcon, PlusIcon, SearchIcon, UploadIcon, VaultIcon, WarningIcon,
} from '@/components/Icons'
import { ERROR_BANNER, STRENGTH_BAR } from '@/components/ui'

const EMPTY_FORM = {
  site:          '',
  username:      '',
  password:      '',
  notes:         '',
  recoveryCodes: '',  // newline-separated 2FA backup codes — encrypted at rest
  entryType:     'password' as 'password' | 'pin',
}

// Uploaded recovery-code files are plain text and small — reject anything
// that clearly isn't a codes file before reading it into memory.
const MAX_CODES_FILE_BYTES = 100_000
const MAX_CODES_LINES      = 100

const QUICK_GEN_OPTIONS: GeneratorOptions = {
  length: 20, uppercase: true, lowercase: true,
  numbers: true, symbols: true, excludeAmbiguous: false,
}

export default function VaultList() {
  const { encryptionKey, updateVaultSignature } = useSession()

  const [entries, setEntries]           = useState<VaultEntry[]>([])
  const [flags, setFlags]               = useState<Map<number, EntryFlags>>(new Map())
  const [searchQuery, setSearchQuery]   = useState('')
  const [isLoading, setIsLoading]       = useState(true)
  const [showModal, setShowModal]       = useState(false)
  const [editingEntry, setEditingEntry] = useState<VaultEntry | null>(null)
  const [form, setForm]                 = useState(EMPTY_FORM)
  const [showFormPw, setShowFormPw]     = useState(false)
  const [isSaving, setIsSaving]         = useState(false)
  const [formError, setFormError]       = useState<string | null>(null)
  const codesFileRef                    = useRef<HTMLInputElement>(null)

  useEffect(() => { loadEntries() }, [])

  async function loadEntries() {
    setIsLoading(true)
    let all = await db.vault_entries.orderBy('site').toArray()

    if (encryptionKey) {
      // One-time migration: older versions stored notes as plaintext.
      // Encrypt them at rest now, then re-sign the vault.
      const legacy = all.filter(e => e.notes && !e.encryptedNotes)
      if (legacy.length > 0) {
        for (const e of legacy) {
          const { ciphertext, iv } = await encryptEntry(encryptionKey, e.notes!)
          await db.vault_entries.update(e.id!, {
            encryptedNotes: ciphertext,
            notesIv:        iv,
            notes:          undefined,  // Dexie deletes the property
          })
        }
        await updateVaultSignature()
        all = await db.vault_entries.orderBy('site').toArray()
      }

      // Hydrate notes in memory only — the plaintext lives in React state
      // while unlocked and is never written back to IndexedDB.
      all = await Promise.all(
        all.map(async e =>
          e.encryptedNotes && e.notesIv
            ? { ...e, notes: await decryptEntry(encryptionKey, e.encryptedNotes, e.notesIv) }
            : e
        )
      )

      // Strength and reuse chips (task 3.3): decrypt each password in memory and
      // keep only the flags. `decrypted` goes out of scope when this function
      // returns and is never written anywhere ("Health analysis stays in memory").
      // An entry that fails to decrypt just gets no chips, rather than hiding the list.
      const decrypted = await Promise.all(
        all.map(async e => {
          try {
            const password = await decryptEntry(encryptionKey, e.encryptedPassword, e.iv)
            return { id: e.id!, password, isPin: e.entryType === 'pin' }
          } catch {
            return null
          }
        })
      )
      setFlags(analyseEntries(decrypted.filter((d): d is DecryptedItem => d !== null)))
    }

    setEntries(all)
    setIsLoading(false)
  }

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries
    const q = searchQuery.toLowerCase()
    return entries.filter(e =>
      e.site.toLowerCase().includes(q) ||
      e.username.toLowerCase().includes(q) ||
      (e.notes ?? '').toLowerCase().includes(q)
    )
  }, [entries, searchQuery])

  async function handleRevealRequest(id: number): Promise<string> {
    if (!encryptionKey) throw new Error('Not unlocked')
    const entry = entries.find(e => e.id === id)
    if (!entry) throw new Error('Entry not found')
    return decryptEntry(encryptionKey, entry.encryptedPassword, entry.iv)
  }

  function openAddModal() {
    setEditingEntry(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setShowModal(true)
  }

  async function openEditModal(entry: VaultEntry) {
    if (!encryptionKey) return
    const pw = await decryptEntry(encryptionKey, entry.encryptedPassword, entry.iv)
    const codes = entry.encryptedRecoveryCodes && entry.recoveryCodesIv
      ? await decryptEntry(encryptionKey, entry.encryptedRecoveryCodes, entry.recoveryCodesIv)
      : ''
    setEditingEntry(entry)
    setForm({
      site:          entry.site,
      username:      entry.username,
      password:      pw,
      notes:         entry.notes ?? '',
      recoveryCodes: codes,
      entryType:     entry.entryType ?? 'password',
    })
    setFormError(null)
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingEntry(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!encryptionKey) return
    if (!form.site.trim() || !form.username.trim() || !form.password) {
      setFormError('Site, username, and password are required.')
      return
    }
    if (form.entryType === 'pin' && !/^\d{4,8}$/.test(form.password)) {
      setFormError('PIN must be 4–8 digits (numbers only).')
      return
    }

    setIsSaving(true)
    setFormError(null)

    try {
      const { ciphertext, iv } = await encryptEntry(encryptionKey, form.password)

      // Notes are encrypted too — they often hold recovery codes and other secrets
      const notesPlain = form.notes.trim()
      const encNotes = notesPlain ? await encryptEntry(encryptionKey, notesPlain) : null

      // Recovery codes: normalize to trimmed, non-empty lines before encrypting
      const codesPlain = form.recoveryCodes
        .split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n')
      const encCodes = codesPlain ? await encryptEntry(encryptionKey, codesPlain) : null

      if (editingEntry) {
        // Only write history if the password actually changed
        const oldPw = await decryptEntry(encryptionKey, editingEntry.encryptedPassword, editingEntry.iv)
        if (oldPw !== form.password) {
          await db.password_history.add({
            entryId:           editingEntry.id!,
            encryptedPassword: editingEntry.encryptedPassword,
            iv:                editingEntry.iv,
            replacedAt:        new Date(),
          })
          // Keep only the most recent 10 per entry
          const all = await db.password_history
            .where('entryId').equals(editingEntry.id!)
            .sortBy('replacedAt')
          if (all.length > 10) {
            await db.password_history.bulkDelete(
              all.slice(0, all.length - 10).map(h => h.id!)
            )
          }
        }

        await db.vault_entries.update(editingEntry.id!, {
          site:                   form.site.trim(),
          username:               form.username.trim(),
          encryptedPassword:      ciphertext,
          iv,
          notes:                  undefined,  // clears any legacy plaintext notes
          encryptedNotes:         encNotes?.ciphertext,
          notesIv:                encNotes?.iv,
          encryptedRecoveryCodes: encCodes?.ciphertext,
          recoveryCodesIv:        encCodes?.iv,
          updatedAt:              new Date(),
          entryType:              form.entryType,
        })
      } else {
        await db.vault_entries.add({
          site:              form.site.trim(),
          username:          form.username.trim(),
          encryptedPassword: ciphertext,
          iv,
          ...(encNotes ? { encryptedNotes: encNotes.ciphertext, notesIv: encNotes.iv } : {}),
          ...(encCodes ? { encryptedRecoveryCodes: encCodes.ciphertext, recoveryCodesIv: encCodes.iv } : {}),
          createdAt:         new Date(),
          updatedAt:         new Date(),
          entryType:         form.entryType,
        })
      }

      await updateVaultSignature()
      await loadEntries()
      closeModal()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(id: number) {
    await db.vault_entries.delete(id)
    await db.health_flags.where('entryId').equals(id).delete()
    await db.password_history.where('entryId').equals(id).delete()
    await updateVaultSignature()
    await loadEntries()
  }

  function quickGenerate() {
    try { setForm(f => ({ ...f, password: generatePassword(QUICK_GEN_OPTIONS) })) } catch {}
  }

  /**
   * Reads an uploaded recovery-codes file (the .txt most sites offer when you
   * enable 2FA) into the form. The file is only read into memory here — the
   * codes are encrypted on save and the file itself is never stored.
   */
  async function handleCodesFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''  // allow re-selecting the same file later
    if (!file) return

    if (file.size > MAX_CODES_FILE_BYTES) {
      setFormError('Recovery codes file is too large — expected a small text file.')
      return
    }

    const text  = await file.text()
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

    if (lines.length === 0) {
      setFormError('No recovery codes found in that file.')
      return
    }
    if (lines.length > MAX_CODES_LINES) {
      setFormError(`That file has ${lines.length} lines — expected at most ${MAX_CODES_LINES} recovery codes.`)
      return
    }

    setFormError(null)
    setForm(f => ({ ...f, recoveryCodes: lines.join('\n') }))
  }

  const formStrength = (form.entryType === 'password' && form.password)
    ? scorePassword(form.password)
    : null

  return (
    <>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by site, username, or notes…"
              aria-label="Search entries"
              className="w-full rounded-full border border-slate-700 bg-slate-950 py-2.5 pl-11 pr-4 text-sm text-primary placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 whitespace-nowrap rounded-full bg-brand-500 px-5 py-2.5 text-sm font-medium text-brand-label transition-colors hover:bg-brand-600"
          >
            <PlusIcon />
            Add Entry
          </button>
        </div>

        {!isLoading && (
          <p className="px-1 text-sm text-slate-500">
            {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
            {searchQuery && ` matching "${searchQuery}"`}
          </p>
        )}

        {isLoading && (
          <div className="flex justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        )}

        {!isLoading && entries.length === 0 && (
          <div className="rounded-3xl bg-slate-900 px-6 py-16 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-700 text-slate-300">
              <LockIcon className="h-7 w-7" />
            </div>
            <h3 className="mb-2 font-semibold text-primary">
              Your vault is <span className="font-serif italic">empty</span>
            </h3>
            <p className="mb-6 text-sm text-slate-500">Add your first password to get started.</p>
            <button
              onClick={openAddModal}
              className="rounded-full bg-brand-500 px-6 py-2.5 text-sm font-medium text-brand-label transition-colors hover:bg-brand-600"
            >
              Add Your First Entry
            </button>
          </div>
        )}

        {!isLoading && entries.length > 0 && filteredEntries.length === 0 && (
          <div className="rounded-3xl bg-slate-900 py-12 text-center text-sm text-slate-500">
            No entries match &ldquo;{searchQuery}&rdquo;
          </div>
        )}

        <div className="space-y-3">
          {filteredEntries.map(entry => (
            <EntryCard
              key={entry.id}
              entry={entry}
              strength={flags.get(entry.id!)?.strength ?? undefined}
              isDuplicate={flags.get(entry.id!)?.isDuplicate}
              onEdit={openEditModal}
              onDelete={handleDelete}
              onRevealRequest={handleRevealRequest}
            />
          ))}
        </div>
      </div>

      {/* Add / Edit dialog. Rendered outside the space-y wrapper: a fixed overlay
          inside one picks up its top margin and sits low (LEARNINGS 2.1) */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          {/* dark: hairline, since the shadow doesn't show on the dark page (task 3.1) */}
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="entry-dialog-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-slate-950 shadow-2xl animate-fade-in dark:border dark:border-slate-700"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-950 px-6 pb-3 pt-5">
              <h2 id="entry-dialog-title" className="text-lg font-semibold text-primary">
                {editingEntry ? 'Edit Entry' : 'Add Entry'}
              </h2>
              <button
                onClick={closeModal}
                aria-label="Close"
                className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-primary"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 px-6 pb-6">
              {/* Entry type switch */}
              <div className="flex gap-1 rounded-full bg-slate-800 p-1" role="group" aria-label="Entry type">
                {(['password', 'pin'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={form.entryType === t}
                    onClick={() => setForm(f => ({ ...f, entryType: t, password: '' }))}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-medium transition-colors ${
                      form.entryType === t
                        ? 'bg-slate-950 text-primary shadow-sm'
                        : 'text-slate-400 hover:text-primary'
                    }`}
                  >
                    {t === 'password'
                      ? <><VaultIcon className="h-3.5 w-3.5" /> Password / Passphrase</>
                      : <><PinCodeIcon className="h-3.5 w-3.5" /> PIN / Code</>}
                  </button>
                ))}
              </div>

              {/* Login group: what the entry is and how to sign in */}
              <div className="space-y-4 rounded-2xl bg-slate-900 p-4">
                <div>
                  <label className={LABEL}>
                    {form.entryType === 'pin' ? 'Account / Card Name' : 'Site or Service'}
                  </label>
                  <input
                    type="text"
                    value={form.site}
                    onChange={e => setForm(f => ({ ...f, site: e.target.value }))}
                    placeholder={form.entryType === 'pin' ? 'e.g. Visa Debit' : 'e.g. github.com'}
                    required
                    className={INPUT}
                  />
                </div>

                <div>
                  <label className={LABEL}>
                    {form.entryType === 'pin' ? 'Card / Account Label' : 'Username / Email'}
                  </label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    placeholder={form.entryType === 'pin' ? 'e.g. ending in 4242' : 'e.g. john@example.com'}
                    required
                    autoComplete="off"
                    className={INPUT}
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block text-sm font-medium text-slate-400">
                      {form.entryType === 'pin' ? 'PIN / Code' : 'Password'}
                    </label>
                    {form.entryType === 'password' && (
                      <button
                        type="button"
                        onClick={quickGenerate}
                        className="text-xs font-medium text-brand-600 underline-offset-2 transition-colors hover:text-brand-500 hover:underline"
                      >
                        Generate
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    {/* "new-password", not "off": Chrome ignores "off" on password boxes
                        and would fill a saved password in here (CLAUDE.md, task 3.3) */}
                    <input
                      type={showFormPw ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => setForm(f => ({
                        ...f,
                        password: form.entryType === 'pin'
                          ? e.target.value.replace(/\D/g, '').slice(0, 8)
                          : e.target.value,
                      }))}
                      placeholder={form.entryType === 'pin' ? '4–8 digit PIN' : 'Enter or generate a password'}
                      required
                      autoComplete="new-password"
                      inputMode={form.entryType === 'pin' ? 'numeric' : undefined}
                      className={`${INPUT} pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowFormPw(v => !v)}
                      aria-label={showFormPw ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-primary"
                    >
                      {showFormPw ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>

                  {formStrength && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-700">
                        <div className={`h-full rounded-full transition-all ${STRENGTH_BAR[formStrength.label]}`} />
                      </div>
                      <span className="w-12 text-right text-xs text-slate-400">{formStrength.label}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Extras group: notes and recovery codes, both encrypted on save */}
              <div className="space-y-4 rounded-2xl bg-slate-900 p-4">
                <div>
                  <label className={LABEL}>Notes (optional)</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder={form.entryType === 'pin'
                      ? 'Bank name, card type, branch, etc.'
                      : 'Recovery email, 2FA backup codes, etc.'}
                    rows={2}
                    className={`${INPUT} resize-none`}
                  />
                </div>

                {/* Recovery codes — uploaded or pasted, encrypted at rest on save */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block text-sm font-medium text-slate-400">
                      Recovery codes (optional)
                    </label>
                    <button
                      type="button"
                      onClick={() => codesFileRef.current?.click()}
                      className="flex items-center gap-1 text-xs font-medium text-brand-600 underline-offset-2 transition-colors hover:text-brand-500 hover:underline"
                    >
                      <UploadIcon className="h-3.5 w-3.5" />
                      Upload .txt
                    </button>
                    <input
                      ref={codesFileRef}
                      type="file"
                      accept=".txt,text/plain"
                      onChange={handleCodesFileUpload}
                      className="hidden"
                    />
                  </div>
                  <textarea
                    value={form.recoveryCodes}
                    onChange={e => setForm(f => ({ ...f, recoveryCodes: e.target.value }))}
                    placeholder="Paste 2FA backup codes (one per line) or upload the .txt file from the site"
                    rows={form.recoveryCodes ? 4 : 2}
                    spellCheck={false}
                    className={`${INPUT} resize-none font-mono`}
                  />
                  {form.recoveryCodes.trim() && (
                    <p className="mt-1 text-xs text-slate-500">
                      {form.recoveryCodes.split(/\r?\n/).filter(l => l.trim()).length} codes — stored encrypted, viewable from the entry card
                    </p>
                  )}
                </div>
              </div>

              {formError && (
                <div className={ERROR_BANNER} role="alert">
                  <WarningIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 rounded-full py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand-500 py-2.5 text-sm font-medium text-brand-label transition-colors hover:bg-brand-600 disabled:bg-slate-700 disabled:text-slate-500"
                >
                  {isSaving ? (
                    <><div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-label border-t-transparent" /> Saving…</>
                  ) : (
                    editingEntry ? 'Save Changes' : 'Add Entry'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

// Dialog field styles. White fields on the grey groups; the focus ring is
// graphite, which reads on both (2.8: a ring sits outside its element)
const LABEL = 'mb-1.5 block text-sm font-medium text-slate-400'
const INPUT =
  'w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-primary placeholder-slate-500 ' +
  'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'
