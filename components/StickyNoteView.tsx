/**
 * components/StickyNoteView.tsx — one sticky note, opened over the whole window
 *
 * A fixed overlay inside the Notes tab, not a route, so lock and unmount behave
 * as for every other tab: locking unmounts the vault page and the decrypted
 * draft with it. An unsaved edit is lost on lock by design; keeping it would
 * mean storing plaintext somewhere.
 *
 * Edits stay in the local draft until Save. Close and Escape ask before
 * discarding unsaved changes; while a confirm is showing, Escape cancels it.
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import {
  NOTE_COLOURS,
  NOTE_TITLE_MAX,
  NOTE_BODY_MAX,
  type NoteColour,
  type NoteContent,
} from '@/lib/notes'

/**
 * Literal class strings per colour: Tailwind only generates classes it finds
 * written out in full, so these can't be built as `bg-note-${colour}`.
 * Tokens live in tailwind.config.js (`note.*`), never hex here.
 */
export const NOTE_CLASSES: Record<NoteColour, { paper: string; strip: string; swatch: string; label: string }> = {
  yellow: { paper: 'bg-note-yellow', strip: 'bg-note-yellow-strip', swatch: 'bg-note-yellow-strip', label: 'Yellow' },
  green:  { paper: 'bg-note-green',  strip: 'bg-note-green-strip',  swatch: 'bg-note-green-strip',  label: 'Green' },
  blue:   { paper: 'bg-note-blue',   strip: 'bg-note-blue-strip',   swatch: 'bg-note-blue-strip',   label: 'Blue' },
  pink:   { paper: 'bg-note-pink',   strip: 'bg-note-pink-strip',   swatch: 'bg-note-pink-strip',   label: 'Pink' },
  orange: { paper: 'bg-note-orange', strip: 'bg-note-orange-strip', swatch: 'bg-note-orange-strip', label: 'Orange' },
}

/** Pushpin in the current text colour (dark on every note), filled when pinned. */
export function PinIcon({ filled, className = 'w-4 h-4' }: { filled: boolean; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6z" />
      <line x1="12" y1="15" x2="12" y2="21" />
    </svg>
  )
}

interface StickyNoteViewProps {
  initial: NoteContent
  isNew: boolean
  /** Encrypts and stores the note; resolves to an error message or null. */
  onSave: (_content: NoteContent) => Promise<string | null>
  onDelete: () => Promise<void>
  onClose: () => void
}

type Confirm = 'none' | 'discard' | 'delete'

function sameContent(a: NoteContent, b: NoteContent): boolean {
  return a.title === b.title && a.body === b.body && a.colour === b.colour &&
    a.pinned === b.pinned && a.lined === b.lined
}

export default function StickyNoteView({ initial, isNew, onSave, onDelete, onClose }: StickyNoteViewProps) {
  const [draft, setDraft]       = useState<NoteContent>(initial)
  const [saved, setSaved]       = useState<NoteContent>(initial)
  const [unsaved, setUnsaved]   = useState(isNew)  // a new note is unsaved until its first Save
  const [confirm, setConfirm]   = useState<Confirm>('none')
  const [isSaving, setIsSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const titleRef                = useRef<HTMLInputElement>(null)

  const isDirty = unsaved || !sameContent(draft, saved)
  const classes = NOTE_CLASSES[draft.colour]

  // Focus the title on open; the parent returns focus to the card on close.
  useEffect(() => { titleRef.current?.focus() }, [])

  // Escape: cancel an open confirm first, otherwise close (asking if dirty).
  // The listener is removed on unmount, which includes every lock.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (confirm !== 'none') setConfirm('none')
      else if (isDirty) setConfirm('discard')
      else onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [confirm, isDirty, onClose])

  function update(patch: Partial<NoteContent>) {
    setDraft(d => ({ ...d, ...patch }))
    setJustSaved(false)
  }

  function requestClose() {
    if (isDirty) setConfirm('discard')
    else onClose()
  }

  async function handleSave() {
    setIsSaving(true)
    setError(null)
    const err = await onSave(draft)
    setIsSaving(false)
    if (err) {
      setError(err)
      return
    }
    setSaved(draft)
    setUnsaved(false)
    setJustSaved(true)
  }

  const buttonBase = 'text-sm font-medium px-3 py-1.5 rounded-lg transition-colors'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={draft.title || 'Untitled note'}
      className={`fixed inset-0 z-50 flex flex-col ${classes.paper} animate-fade-in`}
    >
      {/* Darker top strip: the sticky part of the note, holding the controls */}
      <div className={`${classes.strip} shadow-md px-4 py-2 flex flex-wrap items-center gap-2`}>
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Note colour">
          {NOTE_COLOURS.map(c => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={draft.colour === c}
              aria-label={NOTE_CLASSES[c].label}
              title={NOTE_CLASSES[c].label}
              onClick={() => update({ colour: c })}
              className={`w-6 h-6 rounded-full border ${NOTE_CLASSES[c].swatch} ${
                draft.colour === c ? 'border-slate-100 ring-2 ring-slate-100' : 'border-slate-500'
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => update({ pinned: !draft.pinned })}
          aria-pressed={draft.pinned}
          className={`${buttonBase} flex items-center gap-1.5 text-slate-100 ${draft.pinned ? 'bg-black/10' : 'hover:bg-black/5'}`}
        >
          <PinIcon filled={draft.pinned} />
          {draft.pinned ? 'Pinned' : 'Pin'}
        </button>

        <button
          type="button"
          onClick={() => update({ lined: !draft.lined })}
          aria-pressed={draft.lined}
          className={`${buttonBase} flex items-center gap-1.5 text-slate-100 ${draft.lined ? 'bg-black/10' : 'hover:bg-black/5'}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
          </svg>
          Lined
        </button>

        <div className="flex-1" />

        {confirm === 'discard' && (
          <div className="flex items-center gap-2" role="alert">
            <span className="text-sm text-slate-100">Discard unsaved changes?</span>
            <button type="button" onClick={onClose} className={`${buttonBase} bg-red-600 hover:bg-red-700 text-white`}>
              Discard
            </button>
            <button type="button" onClick={() => setConfirm('none')} className={`${buttonBase} text-slate-300 hover:bg-black/5`}>
              Keep editing
            </button>
          </div>
        )}

        {confirm === 'delete' && (
          <div className="flex items-center gap-2" role="alert">
            <span className="text-sm text-red-700">Delete this note?</span>
            <button type="button" onClick={() => void onDelete()} className={`${buttonBase} bg-red-600 hover:bg-red-700 text-white`}>
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirm('none')} className={`${buttonBase} text-slate-300 hover:bg-black/5`}>
              No
            </button>
          </div>
        )}

        {confirm === 'none' && (
          <>
            {justSaved && !isDirty && <span className="text-sm text-slate-400">Saved</span>}
            {!isNew && (
              <button type="button" onClick={() => setConfirm('delete')} className={`${buttonBase} text-slate-400 hover:text-red-700 hover:bg-black/5`}>
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || !isDirty}
              className={`${buttonBase} bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50`}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={requestClose} className={`${buttonBase} text-slate-300 hover:bg-black/5`}>
              Close
            </button>
          </>
        )}
      </div>

      {error && <p className="px-6 pt-3 text-sm text-red-700" role="alert">{error}</p>}

      <div className="flex-1 flex flex-col w-full max-w-4xl mx-auto px-6 py-6 min-h-0">
        <input
          ref={titleRef}
          type="text"
          value={draft.title}
          onChange={e => update({ title: e.target.value })}
          maxLength={NOTE_TITLE_MAX}
          placeholder="Title"
          aria-label="Title"
          autoComplete="off"
          className="w-full bg-transparent text-2xl font-semibold text-primary placeholder-slate-500 focus:outline-none mb-4"
        />
        <textarea
          value={draft.body}
          onChange={e => update({ body: e.target.value })}
          maxLength={NOTE_BODY_MAX}
          placeholder="Write something…"
          aria-label="Note"
          autoComplete="off"
          // Chrome's enhanced spell check sends text to a server; notes hold secrets
          spellCheck={false}
          // leading-7 matches the 1.75rem ruling; bg-local makes the lines scroll with the text
          className={`flex-1 w-full bg-transparent resize-none text-base leading-7 text-primary placeholder-slate-500 focus:outline-none ${
            draft.lined ? 'bg-notebook-lines bg-local' : ''
          }`}
        />
        <p className="text-xs text-slate-500 text-right pt-2">
          {draft.body.length.toLocaleString('en-US')} / {NOTE_BODY_MAX.toLocaleString('en-US')}
        </p>
      </div>
    </div>
  )
}
