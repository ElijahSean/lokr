/**
 * components/StickyNotes.tsx — the Notes tab: a grid of encrypted sticky notes
 *
 * Each note's title, body, colour and pin are one AES-256-GCM blob
 * (lib/notes.ts encodes it, encryptEntry encrypts it with a fresh IV on every
 * save). All notes are decrypted when the tab opens, for the previews and the
 * search; the plaintext lives only in this component's state, which is
 * discarded on tab switch and on lock (the vault page unmounts).
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
  updateStickyNote,
  deleteStickyNote,
} from '@/lib/db'
import { encryptEntry, decryptEntry } from '@/lib/crypto'
import {
  encodeNote,
  decodeNote,
  compareNotes,
  noteMatches,
  DEFAULT_NOTE_COLOUR,
  type NoteContent,
} from '@/lib/notes'
import StickyNoteView, { NOTE_CLASSES, PinIcon } from './StickyNoteView'

interface LoadedNote {
  id: number
  /** null when the blob would not decrypt or decode; shown as an error card */
  content: NoteContent | null
  updatedAt: Date
}

interface OpenNote {
  key: number        // stable per opening, so a new note's first Save doesn't remount the view
  id: number | null  // null = a new note not yet saved
  content: NoteContent
}

const NEW_NOTE: NoteContent = { title: '', body: '', colour: DEFAULT_NOTE_COLOUR, pinned: false, lined: false }

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

  // Focus goes back to the card that was opened (or the New note button) on close
  const cardRefs     = useRef(new Map<number, HTMLButtonElement>())
  const newButtonRef = useRef<HTMLButtonElement>(null)
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
          return { id: row.id!, content: decodeNote(json), updatedAt: row.updatedAt }
        } catch {
          return { id: row.id!, content: null, updatedAt: row.updatedAt }
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
      {/* Toolbar */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search notes…"
            autoComplete="off"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-primary placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <button
          ref={newButtonRef}
          onClick={() => openView(null, NEW_NOTE)}
          className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New note
        </button>
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      {!isLoading && notes.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-sm">
            {visibleNotes.length} {visibleNotes.length === 1 ? 'note' : 'notes'}
            {searchQuery && ` matching "${searchQuery}"`}
          </p>
          <div className="flex rounded-lg border border-slate-800 overflow-hidden" role="group" aria-label="Notes view">
            {(['grid', 'list'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  view === v ? 'bg-brand-500 text-white' : 'bg-slate-900 text-slate-400 hover:text-primary'
                }`}
              >
                {v === 'grid' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                )}
                {v === 'grid' ? 'Grid' : 'List'}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && notes.length === 0 && (
        <div className="text-center py-16 border border-slate-800 border-dashed rounded-2xl">
          <div className="text-5xl mb-4">📝</div>
          <h3 className="text-primary font-semibold mb-2">No notes yet</h3>
          <p className="text-slate-500 text-sm mb-6">
            For secrets that aren&apos;t a login: Wi-Fi details, combinations, instructions.
          </p>
          <button
            onClick={() => openView(null, NEW_NOTE)}
            className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-6 py-2.5 rounded-xl transition-colors"
          >
            New note
          </button>
        </div>
      )}

      {!isLoading && notes.length > 0 && visibleNotes.length === 0 && (
        <div className="text-center py-12 text-slate-500 text-sm">
          No notes match &ldquo;{searchQuery}&rdquo;
        </div>
      )}

      {/* Grid of square sticky-note cards */}
      {view === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {visibleNotes.map(note => {
            if (!note.content) {
              return (
                <div key={note.id} className="aspect-square rounded-sm border border-red-200 bg-red-50 p-4 flex items-center justify-center text-center">
                  <p className="text-sm text-red-700">Couldn&apos;t decrypt this note.</p>
                </div>
              )
            }
            const content = note.content
            const classes = NOTE_CLASSES[content.colour]
            return (
              <div key={note.id} className={`relative aspect-square rounded-sm shadow-md hover:shadow-lg transition-shadow ${classes.paper}`}>
                <button
                  ref={el => setCardRef(note.id, el)}
                  onClick={() => openExisting(note)}
                  className="absolute inset-0 flex flex-col text-left rounded-sm overflow-hidden focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <span className={`block h-6 w-full shrink-0 ${classes.strip}`} aria-hidden="true" />
                  <span className="block px-3 pt-2 pr-9 font-semibold text-sm text-primary line-clamp-2 break-words">
                    {content.title || <span className="text-slate-500">Untitled</span>}
                  </span>
                  <span className={`block mx-3 mt-1 mb-3 text-xs leading-4 text-slate-300 whitespace-pre-wrap break-words overflow-hidden flex-1 ${
                    content.lined ? 'bg-notebook-lines-sm' : ''
                  }`}>
                    {content.body}
                  </span>
                </button>
                <PinButton note={note} onToggle={handleTogglePin} className="absolute top-7 right-1.5" />
              </div>
            )
          })}
        </div>
      )}

      {/* Compact list: one row per note */}
      {view === 'list' && visibleNotes.length > 0 && (
        <ul className="bg-slate-900 border border-slate-800 rounded-2xl divide-y divide-slate-800 overflow-hidden">
          {visibleNotes.map(note => {
            if (!note.content) {
              return (
                <li key={note.id} className="px-4 py-3 text-sm text-red-700 bg-red-50">
                  Couldn&apos;t decrypt this note.
                </li>
              )
            }
            const content = note.content
            const firstLine = content.body.split('\n').find(l => l.trim()) ?? ''
            return (
              <li key={note.id} className="relative flex items-center">
                <button
                  ref={el => setCardRef(note.id, el)}
                  onClick={() => openExisting(note)}
                  className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-12 py-3 text-left hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500"
                >
                  <span className={`w-3 h-3 rounded-full shrink-0 border border-slate-700 ${NOTE_CLASSES[content.colour].strip}`} aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-primary truncate">
                      {content.title || <span className="text-slate-500">Untitled</span>}
                    </span>
                    {firstLine && <span className="block text-xs text-slate-500 truncate">{firstLine}</span>}
                  </span>
                  <span className="text-xs text-slate-500 shrink-0 hidden sm:inline">
                    {note.updatedAt.toLocaleDateString()}
                  </span>
                </button>
                <PinButton note={note} onToggle={handleTogglePin} className="absolute right-2" />
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
        isNew={openNote.id === null}
        onSave={handleSave}
        onDelete={handleDelete}
        onClose={handleClose}
      />
    )}
    </>
  )
}

/** Pin toggle shared by grid cards and list rows; saves straight away. */
function PinButton({ note, onToggle, className }: {
  note: LoadedNote
  onToggle: (_note: LoadedNote) => Promise<void>
  className: string
}) {
  const pinned = note.content?.pinned ?? false
  return (
    <button
      onClick={() => void onToggle(note)}
      aria-pressed={pinned}
      aria-label={pinned ? 'Unpin note' : 'Pin note'}
      title={pinned ? 'Unpin' : 'Pin to top'}
      className={`${className} w-7 h-7 rounded-md flex items-center justify-center text-slate-100 transition-opacity hover:bg-black/5 ${
        pinned ? 'opacity-100' : 'opacity-40 hover:opacity-100'
      }`}
    >
      <PinIcon filled={pinned} />
    </button>
  )
}
