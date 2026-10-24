/**
 * components/StickyNotes.tsx — the Notes tab: a grid of encrypted sticky notes
 *
 * Each note's title, body, colour and pin are one AES-256-GCM blob
 * (lib/notes.ts encodes it, encryptEntry encrypts it with a fresh IV on every
 * save). All notes are decrypted when the tab opens, for the previews and the
 * search; the plaintext lives only in this component's state, which is
 * discarded on tab switch and on lock (the vault page unmounts).
 * Picture bytes are not part of that list load; StickyNoteView decrypts them
 * only after their note opens and revokes every object URL when it closes.
 *
 * Every write goes through lib/db.ts and is followed by updateVaultSignature(),
 * because the vault HMAC covers sticky_notes.
 */

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/hooks/useSession'
import {
  listStickyNotes,
  addStickyNote,
  addStickyNoteWithPictures,
  countNotePictures,
  deleteNotePicture,
  updateStickyNote,
  deleteStickyNote,
  saveStickyNoteWithPicture,
} from '@/lib/db'
import { encryptBytes, encryptEntry, decryptEntry } from '@/lib/crypto'
import {
  encodeNote,
  decodeNote,
  compareNotes,
  noteMatches,
  NEW_NOTE_COLOUR,
  type NoteContent,
} from '@/lib/notes'
import StickyNoteView, { NOTE_CLASSES, TONE_CLASSES, type NoteTone } from './StickyNoteView'
import { DEFAULT_NOTE_FONT_FAMILY, DEFAULT_NOTE_FONT_SIZE, documentToPlainText, plainTextToDocument } from '@/lib/noteDoc'
import { CheckIcon, GridIcon, ListIcon, NotesIcon, PinIcon, PlusIcon, SearchIcon, UploadIcon, WarningIcon } from '@/components/Icons'
import { CARD_SURFACE, ERROR_BANNER, INPUT, PRIMARY_BUTTON, QUIET_BUTTON, SEGMENT, SEGMENTED, SEGMENT_OFF, SEGMENT_ON } from '@/components/ui'
import {
  NOTE_IMPORT_ACCEPT,
  assertFileSize,
  assertTextFileSize,
  noteFromTextFile,
  noteImportKind,
  openNoteFile,
} from '@/lib/noteFile'

interface LoadedNote {
  id: number
  /** null when the blob would not decrypt or decode; shown as an error card */
  content: NoteContent | null
  updatedAt: Date
  pictureCount: number
}

interface OpenNote {
  key: number        // stable per opening, so a new note's first Save doesn't remount the view
  id: number | null  // null = a new note not yet saved
  content: NoteContent
}

const NEW_NOTE: NoteContent = {
  title: '',
  body: plainTextToDocument(''),
  fontFamily: DEFAULT_NOTE_FONT_FAMILY,
  fontSize: DEFAULT_NOTE_FONT_SIZE,
  colour: NEW_NOTE_COLOUR,
  pinned: false,
  lined: false,
}

// Grid of square cards, or a compact list. Not remembered between visits:
// CLAUDE.md forbids localStorage, and a view mode isn't worth an IndexedDB field.
type NotesView = 'grid' | 'list'

interface StickyNotesProps {
  /** Told whenever a note opens or closes full-window; the vault page skips its tab-switch lock while open (task 2.7). */
  onNoteOpenChange: (_open: boolean) => void
}

export default function StickyNotes({ onNoteOpenChange }: StickyNotesProps) {
  const { encryptionKey, updateVaultSignature } = useSession()

  const [notes, setNotes]             = useState<LoadedNote[]>([])
  const [isLoading, setIsLoading]     = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [openNote, setOpenNote]       = useState<OpenNote | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [view, setView]               = useState<NotesView>('grid')
  const [pendingImport, setPendingImport] = useState<File | null>(null)
  const [importPassword, setImportPassword] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [importSuccess, setImportSuccess] = useState(false)

  // Focus goes back to the card that was opened (or the New note button) on close
  const cardRefs     = useRef(new Map<number, HTMLButtonElement>())
  const newButtonRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [returnFocusTo, setReturnFocusTo] = useState<number | 'new' | null>(null)
  const openCount = useRef(0)

  function setCardRef(id: number, el: HTMLButtonElement | null) {
    if (el) cardRefs.current.set(id, el)
    else cardRefs.current.delete(id)
  }

  function openView(id: number | null, content: NoteContent) {
    openCount.current += 1
    setOpenNote({ key: openCount.current, id, content })
  }

  // Load once on mount; the tab remounts on every visit and after every lock
  useEffect(() => { void loadNotes() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // One place that sees every open and close (open, Close, Escape, Delete);
  // the cleanup also reports "closed" if this tab unmounts with a note open.
  const isNoteOpen = openNote !== null
  useEffect(() => {
    onNoteOpenChange(isNoteOpen)
    return () => onNoteOpenChange(false)
  }, [isNoteOpen, onNoteOpenChange])

  useEffect(() => {
    if (openNote || returnFocusTo === null) return
    const target = returnFocusTo === 'new' ? newButtonRef.current : cardRefs.current.get(returnFocusTo)
    ;(target ?? newButtonRef.current)?.focus()
    setReturnFocusTo(null)
  }, [openNote, returnFocusTo, notes])

  async function loadNotes() {
    if (!encryptionKey) return
    setIsLoading(true)
    const rows = await listStickyNotes()
    const loaded = await Promise.all(
      rows.map(async (row): Promise<LoadedNote> => {
        try {
          const json = await decryptEntry(encryptionKey, row.encryptedNote, row.iv)
          return {
            id: row.id!,
            content: decodeNote(json),
            updatedAt: row.updatedAt,
            pictureCount: await countNotePictures(row.id!),
          }
        } catch {
          return {
            id: row.id!,
            content: null,
            updatedAt: row.updatedAt,
            pictureCount: await countNotePictures(row.id!),
          }
        }
      })
    )
    setNotes(loaded)
    setIsLoading(false)
  }

  /** Encrypts and stores a note, re-signs the vault, reloads. Returns the note id. */
  async function persist(id: number | null, content: NoteContent): Promise<number> {
    if (!encryptionKey) throw new Error('Vault is locked.')
    // encodeNote enforces the 200 / 20,000 caps, as the form's maxLength does
    const { ciphertext, iv } = await encryptEntry(encryptionKey, encodeNote(content))
    let noteId = id
    if (noteId === null) noteId = await addStickyNote(ciphertext, iv)
    else await updateStickyNote(noteId, ciphertext, iv)
    await updateVaultSignature()
    await loadNotes()
    return noteId
  }

  /** Imports a complete note only after every picture has been encrypted in memory. */
  async function persistImported(content: NoteContent, pictures: Uint8Array[]): Promise<number> {
    if (!encryptionKey) throw new Error('Vault is locked.')
    const encryptedNote = await encryptEntry(encryptionKey, encodeNote(content))
    const encryptedPictures = await Promise.all(
      pictures.map(picture => encryptBytes(encryptionKey, picture)),
    )
    const noteId = await addStickyNoteWithPictures(
      encryptedNote.ciphertext,
      encryptedNote.iv,
      encryptedPictures,
    )
    await updateVaultSignature()
    await loadNotes()
    return noteId
  }

  async function handleSave(content: NoteContent): Promise<string | null> {
    if (!openNote) return null
    try {
      const id = await persist(openNote.id, content)
      setOpenNote({ ...openNote, id, content })
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not save the note.'
    }
  }

  async function handleAddPicture(
    content: NoteContent,
    bytes: Uint8Array,
  ): Promise<{ noteId: number; pictureId: number; error: string | null }> {
    if (!openNote || !encryptionKey) {
      return { noteId: 0, pictureId: 0, error: 'Vault is locked.' }
    }
    try {
      const encryptedNote = await encryptEntry(encryptionKey, encodeNote(content))
      const encryptedPicture = await encryptBytes(encryptionKey, bytes)
      const result = await saveStickyNoteWithPicture(
        openNote.id,
        encryptedNote.ciphertext,
        encryptedNote.iv,
        encryptedPicture.ciphertext,
        encryptedPicture.iv,
      )
      await updateVaultSignature()
      setOpenNote(current => current ? { ...current, id: result.noteId, content } : current)
      await loadNotes()
      return { ...result, error: null }
    } catch (err) {
      return {
        noteId: openNote.id ?? 0,
        pictureId: 0,
        error: err instanceof Error ? err.message : 'Could not attach the picture.',
      }
    }
  }

  async function handleDeletePicture(id: number): Promise<string | null> {
    try {
      await deleteNotePicture(id)
      await updateVaultSignature()
      await loadNotes()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not remove the picture.'
    }
  }

  async function handleDelete() {
    if (!openNote || openNote.id === null) return
    const id = openNote.id
    await deleteStickyNote(id)
    await updateVaultSignature()
    setOpenNote(null)
    setReturnFocusTo('new')
    await loadNotes()
  }

  async function handleTogglePin(note: LoadedNote) {
    if (!note.content) return
    setError(null)
    try {
      await persist(note.id, { ...note.content, pinned: !note.content.pinned })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the note.')
    }
  }

  async function handleImportSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)
    setImportSuccess(false)
    setPendingImport(null)
    setImportPassword('')
    try {
      const kind = noteImportKind(file.name)
      if (kind === 'lokrnote') {
        assertFileSize(file.size)
        setPendingImport(file)
        return
      }

      assertTextFileSize(file.size)
      setIsImporting(true)
      const content = noteFromTextFile(file.name, new Uint8Array(await file.arrayBuffer()))
      await persist(null, content)
      setImportSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import the note.')
    } finally {
      setIsImporting(false)
    }
  }

  async function handleEncryptedImport() {
    if (!pendingImport || !importPassword) return
    setIsImporting(true)
    setError(null)
    setImportSuccess(false)
    try {
      // The file-derived key only decrypts in memory; persist() re-encrypts the
      // validated note under this vault's key and re-signs the whole vault.
      const imported = await openNoteFile(await pendingImport.text(), importPassword)
      await persistImported(imported.content, imported.pictures)
      setPendingImport(null)
      setImportPassword('')
      setImportSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import the note.')
    } finally {
      setIsImporting(false)
    }
  }

  function openExisting(note: LoadedNote) {
    if (!note.content) return
    openView(note.id, note.content)
  }

  function handleClose() {
    setReturnFocusTo(openNote?.id ?? 'new')
    setOpenNote(null)
  }

  const visibleNotes = useMemo(() => {
    const sortable = notes.map(n => ({ ...n, pinned: n.content?.pinned ?? false }))
    return sortable
      .filter(n => !searchQuery.trim() || (n.content !== null && noteMatches(n.content, searchQuery)))
      .sort(compareNotes)
  }, [notes, searchQuery])

  return (
    <>
    <div className="space-y-4">
      {/* Toolbar, as on the Vault tab (3.3) */}
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[12rem] flex-1">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search notes…"
            aria-label="Search notes"
            autoComplete="off"
            className="w-full rounded-full border border-slate-700 bg-slate-950 py-2.5 pl-11 pr-4 text-sm text-primary placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={NOTE_IMPORT_ACCEPT}
          onChange={event => void handleImportSelection(event)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
          className={`${QUIET_BUTTON} whitespace-nowrap disabled:opacity-50`}
        >
          <UploadIcon />
          {isImporting && !pendingImport ? 'Importing…' : 'Import'}
        </button>
        <button
          ref={newButtonRef}
          onClick={() => openView(null, NEW_NOTE)}
          className={`${PRIMARY_BUTTON} whitespace-nowrap`}
        >
          <PlusIcon />
          New note
        </button>
      </div>

      {error && (
        <div className={ERROR_BANNER} role="alert">
          <WarningIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
          <span>{error}</span>
        </div>
      )}

      {importSuccess && (
        <p className="flex items-center gap-2 px-1 text-sm text-primary" role="status">
          <CheckIcon className="h-4 w-4 text-success" />
          Note imported.
        </p>
      )}

      {pendingImport && (
        <div className={`rounded-3xl p-5 ${CARD_SURFACE}`}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[14rem] flex-1 text-sm text-primary">
              Password for {pendingImport.name}
              <input
                type="password"
                value={importPassword}
                onChange={event => setImportPassword(event.target.value)}
                autoComplete="off"
                disabled={isImporting}
                className={`${INPUT} mt-1.5`}
              />
            </label>
            <button
              type="button"
              onClick={() => void handleEncryptedImport()}
              disabled={!importPassword || isImporting}
              className={PRIMARY_BUTTON}
            >
              <UploadIcon />
              {isImporting ? 'Decrypting…' : 'Import note'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingImport(null)
                setImportPassword('')
                setError(null)
              }}
              disabled={isImporting}
              className={`${QUIET_BUTTON} disabled:opacity-50`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!isLoading && notes.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="px-1 text-sm text-slate-500">
            {visibleNotes.length} {visibleNotes.length === 1 ? 'note' : 'notes'}
            {searchQuery && ` matching "${searchQuery}"`}
          </p>
          <div className={SEGMENTED} role="group" aria-label="Notes view">
            {(['grid', 'list'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`${SEGMENT} ${view === v ? SEGMENT_ON : SEGMENT_OFF}`}
              >
                {v === 'grid' ? <GridIcon className="h-3.5 w-3.5" /> : <ListIcon className="h-3.5 w-3.5" />}
                {v === 'grid' ? 'Grid' : 'List'}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        </div>
      )}

      {!isLoading && notes.length === 0 && (
        <div className={`rounded-3xl px-6 py-16 text-center ${CARD_SURFACE}`}>
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-700 text-slate-300">
            <NotesIcon className="h-7 w-7" />
          </div>
          <h3 className="mb-2 font-semibold text-primary">
            No notes <span className="font-serif italic">yet</span>
          </h3>
          <p className="mb-6 text-sm text-slate-500">
            For secrets that aren&apos;t a login: Wi-Fi details, combinations, instructions.
          </p>
          <button onClick={() => openView(null, NEW_NOTE)} className={PRIMARY_BUTTON}>
            New note
          </button>
        </div>
      )}

      {!isLoading && notes.length > 0 && visibleNotes.length === 0 && (
        <div className={`rounded-3xl py-12 text-center text-sm text-slate-500 ${CARD_SURFACE}`}>
          No notes match &ldquo;{searchQuery}&rdquo;
        </div>
      )}

      {/* Grid of paper cards: the note's colour, no band or shadow (3.4) */}
      {view === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {visibleNotes.map(note => {
            if (!note.content) {
              // Neutral, with a status icon, like every other error since 3.5; not openable
              return (
                <div key={note.id} className={`aspect-square rounded-2xl p-4 flex flex-col items-center justify-center gap-2 text-center ${CARD_SURFACE}`}>
                  <WarningIcon className="h-5 w-5 text-danger" />
                  <p className="text-sm text-primary">Couldn&apos;t read this note.</p>
                </div>
              )
            }
            const content = note.content
            const classes = NOTE_CLASSES[content.colour]
            // Light text on the black paper, dark on the rest (task 2.8)
            const tone = TONE_CLASSES[classes.tone]
            return (
              <div key={note.id} className={`relative aspect-square rounded-2xl ${classes.paper} ${classes.edge}`}>
                <button
                  ref={el => setCardRef(note.id, el)}
                  onClick={() => openExisting(note)}
                  className={`absolute inset-0 flex flex-col p-4 text-left rounded-2xl overflow-hidden transition-colors ${tone.hover} focus:outline-none focus:ring-2 ${tone.focusRing}`}
                >
                  <span className={`block pr-7 font-semibold text-sm ${tone.text} line-clamp-2 break-words`}>
                    {content.title || <span className={tone.faint}>Untitled</span>}
                  </span>
                  <span className={`block mt-1.5 text-xs leading-4 ${tone.secondary} whitespace-pre-wrap break-words overflow-hidden flex-1 ${
                    content.lined ? tone.linesSm : ''
                  }`}>
                    {documentToPlainText(content.body)}
                  </span>
                  <span className={`block mt-2 text-xs ${tone.faint}`}>
                    {note.updatedAt.toLocaleDateString()}
                    {note.pictureCount > 0 && ` · ${note.pictureCount} ${note.pictureCount === 1 ? 'picture' : 'pictures'}`}
                  </span>
                </button>
                <PinButton note={note} onToggle={handleTogglePin} tone={classes.tone} className="absolute top-2.5 right-2.5" />
              </div>
            )
          })}
        </div>
      )}

      {/* Compact list: one row per note, in one card */}
      {view === 'list' && visibleNotes.length > 0 && (
        <ul className={`divide-y divide-slate-700 overflow-hidden rounded-3xl ${CARD_SURFACE}`}>
          {visibleNotes.map(note => {
            if (!note.content) {
              return (
                <li key={note.id} className="flex items-center gap-3 px-5 py-3.5 text-sm text-primary">
                  <WarningIcon className="h-4 w-4 flex-shrink-0 text-danger" />
                  Couldn&apos;t read this note.
                </li>
              )
            }
            const content = note.content
            const firstLine = documentToPlainText(content.body).split('\n').find(line => line.trim()) ?? ''
            return (
              <li key={note.id} className="relative flex items-center">
                <button
                  ref={el => setCardRef(note.id, el)}
                  onClick={() => openExisting(note)}
                  className="flex-1 min-w-0 flex items-center gap-3 pl-5 pr-14 py-3.5 text-left transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500"
                >
                  {/* border-slate-500, not -700: the white and grey dots vanished into the row (2.8) */}
                  <span className={`w-3 h-3 rounded-full shrink-0 border border-slate-500 ${NOTE_CLASSES[content.colour].strip}`} aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-primary truncate">
                      {content.title || <span className="text-slate-500">Untitled</span>}
                    </span>
                    {firstLine && <span className="block text-xs text-slate-500 truncate">{firstLine}</span>}
                  </span>
                  <span className="text-xs text-slate-500 shrink-0 hidden sm:inline">
                    {note.pictureCount > 0 && `${note.pictureCount} ${note.pictureCount === 1 ? 'picture' : 'pictures'} · `}
                    {note.updatedAt.toLocaleDateString()}
                  </span>
                </button>
                <PinButton note={note} onToggle={handleTogglePin} className="absolute right-3" />
              </li>
            )
          })}
        </ul>
      )}

    </div>

    {/* Outside the space-y-4 wrapper: its sibling margin would push the fixed overlay down 16px */}
    {openNote && (
      <StickyNoteView
        key={openNote.key}
        initial={openNote.content}
        noteId={openNote.id}
        isNew={openNote.id === null}
        onSave={handleSave}
        onAddPicture={handleAddPicture}
        onDeletePicture={handleDeletePicture}
        onDelete={handleDelete}
        onClose={handleClose}
      />
    )}
    </>
  )
}

/** Pin toggle shared by grid cards and list rows; saves straight away. */
function PinButton({ note, onToggle, className, tone = 'dark-text' }: {
  note: LoadedNote
  onToggle: (_note: LoadedNote) => Promise<void>
  className: string
  // The grid card passes its paper's tone; the list row sits on the light list, so stays dark
  tone?: NoteTone
}) {
  const pinned = note.content?.pinned ?? false
  const toneClasses = TONE_CLASSES[tone]
  return (
    <button
      onClick={() => void onToggle(note)}
      aria-pressed={pinned}
      aria-label={pinned ? 'Unpin note' : 'Pin note'}
      title={pinned ? 'Unpin' : 'Pin to top'}
      className={`${className} w-8 h-8 rounded-full flex items-center justify-center ${toneClasses.text} transition-opacity ${toneClasses.hover} ${
        pinned ? 'opacity-100' : 'opacity-40 hover:opacity-100'
      }`}
    >
      <PinIcon filled={pinned} />
    </button>
  )
}
