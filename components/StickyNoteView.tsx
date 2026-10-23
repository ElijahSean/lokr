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
 *
 * Layout (task 3.4): a top bar (Close; Saved, Delete, Save) over a tool row
 * (colour, Pin, Lined; 2.2's formatting buttons join it later), both on the
 * paper with a thin divider. A confirm takes the tool row's place, so the top
 * bar never has to wrap on a phone.
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
import { CloseIcon, LinesIcon, PinIcon, TrashIcon, WarningIcon } from '@/components/Icons'
import { DANGER_OUTLINE, DANGER_OUTLINE_ON_DARK } from '@/components/ui'

/** Which text a paper takes: dark text on the light papers, light text on black (task 2.8). */
export type NoteTone = 'dark-text' | 'light-text'

/**
 * Literal class strings per colour: Tailwind only generates classes it finds
 * written out in full, so these can't be built as `bg-note-${colour}`.
 * Tokens live in tailwind.config.js (`note.*`), never hex here. `strip` is the
 * deeper shade, now only the list's colour dot (3.4 took the band off cards and
 * the open note). `edge` is a hairline for the papers that fade into the white
 * page: white, and grey once the cards lost their shadow (3.4).
 */
export const NOTE_CLASSES: Record<NoteColour, { paper: string; strip: string; swatch: string; label: string; tone: NoteTone; edge: string }> = {
  yellow: { paper: 'bg-note-yellow', strip: 'bg-note-yellow-strip', swatch: 'bg-note-yellow-strip', label: 'Yellow', tone: 'dark-text', edge: '' },
  green:  { paper: 'bg-note-green',  strip: 'bg-note-green-strip',  swatch: 'bg-note-green-strip',  label: 'Green',  tone: 'dark-text', edge: '' },
  blue:   { paper: 'bg-note-blue',   strip: 'bg-note-blue-strip',   swatch: 'bg-note-blue-strip',   label: 'Blue',   tone: 'dark-text', edge: '' },
  pink:   { paper: 'bg-note-pink',   strip: 'bg-note-pink-strip',   swatch: 'bg-note-pink-strip',   label: 'Pink',   tone: 'dark-text', edge: '' },
  orange: { paper: 'bg-note-orange', strip: 'bg-note-orange-strip', swatch: 'bg-note-orange-strip', label: 'Orange', tone: 'dark-text', edge: '' },
  white:  { paper: 'bg-note-white',  strip: 'bg-note-white-strip',  swatch: 'bg-note-white-strip',  label: 'White',  tone: 'dark-text', edge: 'border border-slate-700' },
  grey:   { paper: 'bg-note-grey',   strip: 'bg-note-grey-strip',   swatch: 'bg-note-grey-strip',   label: 'Grey',   tone: 'dark-text', edge: 'border border-slate-700' },
  // In dark mode the black paper is the dark card colour on the near-black page, so
  // it gets the hairline there too (task 3.1)
  black:  { paper: 'bg-note-black',  strip: 'bg-note-black-strip',  swatch: 'bg-note-black-strip',  label: 'Black',  tone: 'light-text', edge: 'dark:border dark:border-slate-700' },
}

/**
 * Text and control classes per tone, for everything drawn on the paper.
 * Light text is the app's dark-part `ink` tokens; contrast for both tones on
 * every paper is checked in tests/theme.spec.ts.
 */
export const TONE_CLASSES: Record<NoteTone, {
  // muted: "Saved"; faint: the footer, the card's date and "Untitled"
  text: string; secondary: string; muted: string; faint: string; placeholder: string
  hover: string; pressed: string; swatchRing: string; focusRing: string; divider: string
  lines: string; linesSm: string; danger: string; dangerIcon: string; save: string
}> = {
  // Slate text: dark on the light papers, light in dark mode (task 3.1), where these
  // papers turn into dark tints, so the translucent hovers, divider and ruled lines
  // switch from black to white under `dark:`
  'dark-text': {
    text: 'text-primary', secondary: 'text-slate-300', muted: 'text-slate-400', faint: 'text-slate-500', placeholder: 'placeholder-slate-500',
    hover: 'hover:bg-black/5 dark:hover:bg-white/10', pressed: 'bg-black/10 dark:bg-white/15',
    swatchRing: 'border-slate-100 ring-2 ring-slate-100', focusRing: 'focus:ring-brand-500',
    // Translucent, like the hovers, so one class suits every paper (no new hex)
    divider: 'border-black/10 dark:border-white/10',
    lines: 'bg-notebook-lines dark:bg-notebook-lines-light', linesSm: 'bg-notebook-lines-sm dark:bg-notebook-lines-light-sm',
    // Warnings are main text with a status-coloured icon, never red text (3.4, as 3.5)
    danger: DANGER_OUTLINE, dangerIcon: 'text-danger',
    save: 'bg-brand-500 hover:bg-brand-600 text-brand-label',
  },
  'light-text': {
    text: 'text-ink-text', secondary: 'text-ink-muted', muted: 'text-ink-muted', faint: 'text-ink-muted', placeholder: 'placeholder-ink-subtle',
    // The card's focus ring is drawn outside the card, on the page, so it takes the
    // page's ring colour; the offset leaves a page-coloured gap (white, or dark in
    // dark mode, 3.1) so it doesn't merge with the dark edge
    hover: 'hover:bg-white/10', pressed: 'bg-white/15', swatchRing: 'border-ink-text ring-2 ring-ink-text',
    focusRing: 'focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-slate-950',
    divider: 'border-white/10',
    lines: 'bg-notebook-lines-light', linesSm: 'bg-notebook-lines-light-sm',
    danger: DANGER_OUTLINE_ON_DARK, dangerIcon: 'text-danger-dark',
    save: 'bg-ink-text hover:bg-white text-ink',
  },
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

  const pill = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors'
  const row = 'mx-auto flex w-full max-w-4xl items-center gap-2 px-4 sm:px-6'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={draft.title || 'Untitled note'}
      className={`fixed inset-0 z-50 flex flex-col ${classes.paper} animate-fade-in`}
    >
      {/* Top bar: leave on the left, keep on the right */}
      <div className={`border-b ${tone.divider}`}>
        {/* Fixed height: the bar doesn't shrink when a confirm hides the buttons on the right */}
        <div className={`${row} h-14`}>
          <button type="button" onClick={requestClose} className={`${pill} -ml-2 ${tone.secondary} ${tone.hover}`}>
            <CloseIcon />
            Close
          </button>

          <div className="flex-1" />

          {/* Hidden while a confirm asks, as before 3.4, so Save can't answer it */}
          {confirm === 'none' && (
            <>
              {justSaved && !isDirty && <span className={`text-sm ${tone.muted}`}>Saved</span>}
              {!isNew && (
                <button
                  type="button"
                  onClick={() => setConfirm('delete')}
                  aria-label="Delete note"
                  title="Delete"
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${tone.secondary} ${tone.hover}`}
                >
                  <TrashIcon />
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving || !isDirty}
                className={`rounded-full px-5 py-1.5 text-sm font-medium transition-colors ${tone.save} disabled:opacity-50`}
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tool row, or the confirm in its place. flex-wrap: on a phone the swatches
          or the confirm's buttons go onto a second line instead of overflowing */}
      <div className={`border-b ${tone.divider}`}>
        <div className={`${row} min-h-[3.25rem] flex-wrap gap-y-2 py-2`}>
          {confirm === 'none' && (
            <>
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
                    className={`h-6 w-6 rounded-full border ${NOTE_CLASSES[c].swatch} ${c === 'white' ? 'ml-2' : ''} ${
                      draft.colour === c ? tone.swatchRing : 'border-slate-500'
                    }`}
                  />
                ))}
              </div>

              <span className={`mx-1 hidden h-5 border-l sm:block ${tone.divider}`} aria-hidden="true" />

              <button
                type="button"
                onClick={() => update({ pinned: !draft.pinned })}
                aria-pressed={draft.pinned}
                className={`${pill} ${tone.text} ${draft.pinned ? tone.pressed : tone.hover}`}
              >
                <PinIcon filled={draft.pinned} />
                {draft.pinned ? 'Pinned' : 'Pin'}
              </button>

              <button
                type="button"
                onClick={() => update({ lined: !draft.lined })}
                aria-pressed={draft.lined}
                className={`${pill} ${tone.text} ${draft.lined ? tone.pressed : tone.hover}`}
              >
                <LinesIcon />
                Lined
              </button>
            </>
          )}

          {confirm === 'discard' && (
            <div className="flex flex-wrap items-center gap-2" role="alert">
              <span className={`flex items-center gap-2 text-sm ${tone.text}`}>
                <WarningIcon className={`h-4 w-4 flex-shrink-0 ${tone.dangerIcon}`} />
                Discard unsaved changes?
              </span>
              {/* Outlined, not filled, so it never looks like Save (3.2) */}
              <button type="button" onClick={onClose} className={`${pill} ${tone.danger}`}>
                <WarningIcon className="h-3.5 w-3.5" />
                Discard
              </button>
              <button type="button" onClick={() => setConfirm('none')} className={`${pill} ${tone.secondary} ${tone.hover}`}>
                Keep editing
              </button>
            </div>
          )}

          {confirm === 'delete' && (
            <div className="flex flex-wrap items-center gap-2" role="alert">
              <span className={`flex items-center gap-2 text-sm ${tone.text}`}>
                <WarningIcon className={`h-4 w-4 flex-shrink-0 ${tone.dangerIcon}`} />
                Delete this note?
              </span>
              <button type="button" onClick={() => void onDelete()} className={`${pill} ${tone.danger}`}>
                <WarningIcon className="h-3.5 w-3.5" />
                Yes, delete
              </button>
              <button type="button" onClick={() => setConfirm('none')} className={`${pill} ${tone.secondary} ${tone.hover}`}>
                No
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className={`${row} pt-3`}>
          <p className={`flex items-start gap-2 text-sm ${tone.text}`} role="alert">
            <WarningIcon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${tone.dangerIcon}`} />
            {error}
          </p>
        </div>
      )}

      <div className="flex-1 flex flex-col w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 min-h-0">
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
