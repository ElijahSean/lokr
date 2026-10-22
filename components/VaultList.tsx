/**
 * components/VaultList.tsx — The main vault view: entry list + add/edit modal
 *
 * Responsibilities:
 *  - Load all vault entries from IndexedDB on mount
 *  - Decrypt passwords in memory (never stored as plaintext) for display/copy
 *  - Search/filter across site, username, and notes
 *  - Add, edit, and delete entries — always re-encrypts before writing to IndexedDB
 *  - Update the vault HMAC signature after every write
 *  - Compute and cache health flags (strength, duplicates, age) per entry
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
import EntryCard from './EntryCard'

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
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by site, username, or notes…"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-primary placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <button
          onClick={openAddModal}
          className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Entry
        </button>
      </div>

      {!isLoading && (
        <p className="text-slate-500 text-sm">
          {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
          {searchQuery && ` matching "${searchQuery}"`}
        </p>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && entries.length === 0 && (
        <div className="text-center py-16 border border-slate-800 border-dashed rounded-2xl">
          <div className="text-5xl mb-4">🔐</div>
          <h3 className="text-primary font-semibold mb-2">Your vault is empty</h3>
          <p className="text-slate-500 text-sm mb-6">Add your first password to get started.</p>
          <button
            onClick={openAddModal}
            className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-6 py-2.5 rounded-xl transition-colors"
          >
            Add Your First Entry
          </button>
        </div>
      )}

      {!isLoading && entries.length > 0 && filteredEntries.length === 0 && (
        <div className="text-center py-12 text-slate-500 text-sm">
          No entries match &ldquo;{searchQuery}&rdquo;
        </div>
      )}

      <div className="space-y-3">
        {filteredEntries.map(entry => (
          <EntryCard
            key={entry.id}
            entry={entry}
            onEdit={openEditModal}
            onDelete={handleDelete}
            onRevealRequest={handleRevealRequest}
          />
        ))}
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl animate-fade-in max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
              <h2 className="text-primary font-semibold">
                {editingEntry ? 'Edit Entry' : 'Add Entry'}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              {/* Entry type toggle */}
              <div className="flex gap-2">
                {(['password', 'pin'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, entryType: t, password: '' }))}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors border ${
                      form.entryType === t
                        ? 'bg-brand-500 text-white border-brand-500'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-primary'
                    }`}
                  >
                    {t === 'password' ? '🔑 Password / Passphrase' : '🏧 PIN / Code'}
                  </button>
                ))}
              </div>

              {/* Site */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">
                  {form.entryType === 'pin' ? 'Account / Card Name' : 'Site or Service'}
                </label>
                <input
                  type="text"
                  value={form.site}
                  onChange={e => setForm(f => ({ ...f, site: e.target.value }))}
                  placeholder={form.entryType === 'pin' ? 'e.g. Visa Debit' : 'e.g. github.com'}
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-primary placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>

              {/* Username / label */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">
                  {form.entryType === 'pin' ? 'Card / Account Label' : 'Username / Email'}
                </label>
                <input
                  type="text"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder={form.entryType === 'pin' ? 'e.g. ending in 4242' : 'e.g. john@example.com'}
                  required
                  autoComplete="off"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-primary placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>

              {/* Password / PIN */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-slate-400">
                    {form.entryType === 'pin' ? 'PIN / Code' : 'Password'}
                  </label>
                  {form.entryType === 'password' && (
                    <button
                      type="button"
                      onClick={quickGenerate}
                      className="text-xs text-brand-600 hover:text-brand-500 transition-colors"
                    >
                      Generate
                    </button>
                  )}
                </div>
                <div className="relative">
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
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 pr-10 text-sm text-primary placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowFormPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    {showFormPw
                      ? <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                </div>

                {formStrength && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${
                        formStrength.label === 'weak'   ? 'w-1/4 bg-red-500'    :
                        formStrength.label === 'fair'   ? 'w-2/4 bg-yellow-500' :
                        formStrength.label === 'good'   ? 'w-3/4 bg-blue-500'   :
                        'w-full bg-green-500'
                      }`} />
                    </div>
                    <span className={`text-xs ${
                      formStrength.label === 'weak'   ? 'text-red-600'    :
                      formStrength.label === 'fair'   ? 'text-yellow-600' :
                      formStrength.label === 'good'   ? 'text-blue-600'   :
                      'text-green-700'
                    }`}>{formStrength.label}</span>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder={form.entryType === 'pin'
                    ? 'Bank name, card type, branch, etc.'
                    : 'Recovery email, 2FA backup codes, etc.'}
                  rows={2}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-primary placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none"
                />
              </div>

              {/* Recovery codes — uploaded or pasted, encrypted at rest on save */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-slate-400">
                    Recovery codes (optional)
                  </label>
                  <button
                    type="button"
                    onClick={() => codesFileRef.current?.click()}
                    className="text-xs text-brand-600 hover:text-brand-500 transition-colors flex items-center gap-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
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
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm font-mono text-primary placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none"
                />
                {form.recoveryCodes.trim() && (
                  <p className="text-xs text-slate-500 mt-1">
                    {form.recoveryCodes.split(/\r?\n/).filter(l => l.trim()).length} codes — stored encrypted, viewable from the entry card
                  </p>
                )}
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
                  {formError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg py-2.5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 bg-brand-500 hover:bg-brand-600 disabled:bg-slate-700 text-white text-sm font-medium rounded-lg py-2.5 transition-colors flex items-center justify-center gap-2"
                >
                  {isSaving ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
                  ) : (
                    editingEntry ? 'Save Changes' : 'Add Entry'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
