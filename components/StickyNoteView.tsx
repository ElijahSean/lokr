/**
 * components/StickyNoteView.tsx — one sticky note, opened over the whole window
 *
 * A fixed overlay inside the Notes tab, not a route, so lock and unmount behave
 * as for every other tab: locking unmounts the vault page and the decrypted
 * draft with it. An unsaved edit is lost on lock by design; keeping it would
 * mean storing plaintext somewhere. While this view is open, hiding the tab
 * doesn't lock (task 2.7); the 5-minute idle lock still does.
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
import { WarningIcon } from '@/components/Icons'
import { DANGER_OUTLINE, DANGER_OUTLINE_ON_DARK } from '@/components/ui'

/** Which text a paper takes: dark text on the light papers, light text on black (task 2.8). */
export type NoteTone = 'dark-text' | 'light-text'

/**
 * Literal class strings per colour: Tailwind only generates classes it finds
 * written out in full, so these can't be built as `bg-note-${colour}`.
 * Tokens live in tailwind.config.js (`note.*`), never hex here. `edge` is the
 * white card's hairline, so it doesn't vanish into the white page.
 */
export const NOTE_CLASSES: Record<NoteColour, { paper: string; strip: string; swatch: string; label: string; tone: NoteTone; edge: string }> = {
  yellow: { paper: 'bg-note-yellow', strip: 'bg-note-yellow-strip', swatch: 'bg-note-yellow-strip', label: 'Yellow', tone: 'dark-text', edge: '' },
  green:  { paper: 'bg-note-green',  strip: 'bg-note-green-strip',  swatch: 'bg-note-green-strip',  label: 'Green',  tone: 'dark-text', edge: '' },
  blue:   { paper: 'bg-note-blue',   strip: 'bg-note-blue-strip',   swatch: 'bg-note-blue-strip',   label: 'Blue',   tone: 'dark-text', edge: '' },
  pink:   { paper: 'bg-note-pink',   strip: 'bg-note-pink-strip',   swatch: 'bg-note-pink-strip',   label: 'Pink',   tone: 'dark-text', edge: '' },
  orange: { paper: 'bg-note-orange', strip: 'bg-note-orange-strip', swatch: 'bg-note-orange-strip', label: 'Orange', tone: 'dark-text', edge: '' },
  white:  { paper: 'bg-note-white',  strip: 'bg-note-white-strip',  swatch: 'bg-note-white-strip',  label: 'White',  tone: 'dark-text', edge: 'border border-slate-700' },
  grey:   { paper: 'bg-note-grey',   strip: 'bg-note-grey-strip',   swatch: 'bg-note-grey-strip',   label: 'Grey',   tone: 'dark-text', edge: '' },
  black:  { paper: 'bg-note-black',  strip: 'bg-note-black-strip',  swatch: 'bg-note-black-strip',  label: 'Black',  tone: 'light-text', edge: '' },
}

/**
 * Text and control classes per tone, for everything drawn on the paper.
 * Light text is the app's dark-part `ink` tokens; contrast for both tones on
 * every paper is checked in tests/theme.spec.ts.
 */
export const TONE_CLASSES: Record<NoteTone, {
  // muted: quiet text on the strip ("Saved", Delete); faint: on the paper (footer, "Untitled")
  text: string; secondary: string; muted: string; faint: string; placeholder: string
  hover: string; pressed: string; swatchRing: string; focusRing: string
  lines: string; linesSm: string; danger: string; dangerText: string; dangerHover: string; save: string
}> = {
  'dark-text': {
    text: 'text-primary', secondary: 'text-slate-300', muted: 'text-slate-400', faint: 'text-slate-500', placeholder: 'placeholder-slate-500',
    hover: 'hover:bg-black/5', pressed: 'bg-black/10', swatchRing: 'border-slate-100 ring-2 ring-slate-100', focusRing: 'focus:ring-brand-500',
    lines: 'bg-notebook-lines', linesSm: 'bg-notebook-lines-sm',
    danger: DANGER_OUTLINE, dangerText: 'text-red-700', dangerHover: 'hover:text-red-700',
    save: 'bg-brand-500 hover:bg-brand-600 text-white',
  },
  'light-text': {
    text: 'text-ink-text', secondary: 'text-ink-muted', muted: 'text-ink-muted', faint: 'text-ink-muted', placeholder: 'placeholder-ink-subtle',
    // The card's focus ring is drawn outside the card, on the white page, so it stays
    // graphite; the offset leaves a white gap so it doesn't merge with the dark edge
    hover: 'hover:bg-white/10', pressed: 'bg-white/15', swatchRing: 'border-ink-text ring-2 ring-ink-text', focusRing: 'focus:ring-brand-500 focus:ring-offset-2',
    lines: 'bg-notebook-lines-light', linesSm: 'bg-notebook-lines-light-sm',
    danger: DANGER_OUTLINE_ON_DARK, dangerText: 'text-red-400', dangerHover: 'hover:text-red-400',
    save: 'bg-ink-text hover:bg-white text-ink',
  },
}

/** Pushpin in the current text colour, filled when pinned. */
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
  const tone = TONE_CLASSES[classes.tone]

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
              // ml-2 on white: a small gap between the pastels and the neutral papers
              className={`w-6 h-6 rounded-full border ${NOTE_CLASSES[c].swatch} ${c === 'white' ? 'ml-2' : ''} ${
                draft.colour === c ? tone.swatchRing : 'border-slate-500'
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => update({ pinned: !draft.pinned })}
          aria-pressed={draft.pinned}
          className={`${buttonBase} flex items-center gap-1.5 ${tone.text} ${draft.pinned ? tone.pressed : tone.hover}`}
        >
          <PinIcon filled={draft.pinned} />
          {draft.pinned ? 'Pinned' : 'Pin'}
        </button>

        <button
          type="button"
          onClick={() => update({ lined: !draft.lined })}
          aria-pressed={draft.lined}
          className={`${buttonBase} flex items-center gap-1.5 ${tone.text} ${draft.lined ? tone.pressed : tone.hover}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
          </svg>
          Lined
        </button>

        <div className="flex-1" />

        {confirm === 'discard' && (
          <div className="flex items-center gap-2" role="alert">
            <span className={`text-sm ${tone.text}`}>Discard unsaved changes?</span>
            {/* Outlined, not filled, so it never looks like Save (3.2) */}
            <button type="button" onClick={onClose} className={`${buttonBase} ${tone.danger}`}>
              <WarningIcon className="w-3.5 h-3.5" />
              Discard
            </button>
            <button type="button" onClick={() => setConfirm('none')} className={`${buttonBase} ${tone.secondary} ${tone.hover}`}>
              Keep editing
            </button>
          </div>
        )}

        {confirm === 'delete' && (
          <div className="flex items-center gap-2" role="alert">
            <span className={`text-sm ${tone.dangerText}`}>Delete this note?</span>
            <button type="button" onClick={() => void onDelete()} className={`${buttonBase} ${tone.danger}`}>
              <WarningIcon className="w-3.5 h-3.5" />
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirm('none')} className={`${buttonBase} ${tone.secondary} ${tone.hover}`}>
              No
            </button>
          </div>
        )}

        {confirm === 'none' && (
          <>
            {justSaved && !isDirty && <span className={`text-sm ${tone.muted}`}>Saved</span>}
            {!isNew && (
              <button type="button" onClick={() => setConfirm('delete')} className={`${buttonBase} ${tone.muted} ${tone.dangerHover} ${tone.hover}`}>
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || !isDirty}
              className={`${buttonBase} ${tone.save} disabled:opacity-50`}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={requestClose} className={`${buttonBase} ${tone.secondary} ${tone.hover}`}>
              Close
            </button>
          </>
        )}
      </div>

      {error && <p className={`px-6 pt-3 text-sm ${tone.dangerText}`} role="alert">{error}</p>}

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
          className={`w-full bg-transparent text-2xl font-semibold ${tone.text} ${tone.placeholder} focus:outline-none mb-4`}
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
          className={`flex-1 w-full bg-transparent resize-none text-base leading-7 ${tone.text} ${tone.placeholder} focus:outline-none ${
            draft.lined ? `${tone.lines} bg-local` : ''
          }`}
        />
        <div className={`flex items-center justify-between gap-4 pt-2 text-xs ${tone.faint}`}>
          {/* Task 2.7: switching tabs or minimising doesn't lock while a note is open */}
          <p>Stays unlocked while open · locks after 5 min idle</p>
          <p>{draft.body.length.toLocaleString('en-US')} / {NOTE_BODY_MAX.toLocaleString('en-US')}</p>
        </div>
      </div>
    </div>
  )
}
