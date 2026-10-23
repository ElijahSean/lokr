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
  NEW_NOTE_COLOUR,
  type NoteContent,
} from '@/lib/notes'
import StickyNoteView, { NOTE_CLASSES, TONE_CLASSES, type NoteTone } from './StickyNoteView'
import { GridIcon, ListIcon, NotesIcon, PinIcon, PlusIcon, SearchIcon, WarningIcon } from '@/components/Icons'
import { ERROR_BANNER, PRIMARY_BUTTON, SEGMENT, SEGMENTED, SEGMENT_OFF, SEGMENT_ON } from '@/components/ui'

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

const NEW_NOTE: NoteContent = { title: '', body: '', colour: NEW_NOTE_COLOUR, pinned: false, lined: false }

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
      {/* Toolbar, as on the Vault tab (3.3) */}
      <div className="flex gap-3">
        <div className="relative flex-1">
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
        <div className="rounded-3xl bg-slate-900 px-6 py-16 text-center">
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
        <div className="rounded-3xl bg-slate-900 py-12 text-center text-sm text-slate-500">
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
                <div key={note.id} className="aspect-square rounded-2xl bg-slate-900 p-4 flex flex-col items-center justify-center gap-2 text-center">
                  <WarningIcon className="h-5 w-5 text-danger" />
                  <p className="text-sm text-primary">Couldn&apos;t decrypt this note.</p>
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
                    {content.body}
                  </span>
                  <span className={`block mt-2 text-xs ${tone.faint}`}>
                    {note.updatedAt.toLocaleDateString()}
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
        <ul className="divide-y divide-slate-700 overflow-hidden rounded-3xl bg-slate-900">
          {visibleNotes.map(note => {
            if (!note.content) {
              return (
                <li key={note.id} className="flex items-center gap-3 px-5 py-3.5 text-sm text-primary">
                  <WarningIcon className="h-4 w-4 flex-shrink-0 text-danger" />
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
