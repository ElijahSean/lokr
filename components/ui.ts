/**
 * components/ui.ts — class strings shared across screens (tasks 3.2–3.6)
 *
 * Lives in components/ because Tailwind's content globs skip lib/, so class
 * names written anywhere else would be dropped from the CSS.
 */

// Destructive buttons (delete, discard, CSV export, full reset) remain an
// outline paired with a <WarningIcon />, visibly separate from the blue brand.
// Colour, border and icon spacing only: each button keeps its own size and shape.
// The translucent hover reads on any background (card, red panel, note paper).
// In dark mode (task 3.1) it takes DANGER_OUTLINE_ON_DARK's red-400, below.
export const DANGER_OUTLINE =
  'inline-flex items-center justify-center gap-1.5 border border-red-600 text-red-700 ' +
  'bg-transparent hover:bg-red-600/10 transition-colors ' +
  'dark:border-red-400 dark:text-red-400 dark:hover:bg-red-400/10 ' +
  'disabled:border-slate-700 disabled:text-slate-500 disabled:hover:bg-transparent'

// The same on a surface that is dark in both themes (the black note paper, task 2.8):
// red-700 is unreadable on the fixed black paper; red-400 passes (theme spec)
export const DANGER_OUTLINE_ON_DARK =
  'inline-flex items-center justify-center gap-1.5 border border-red-400 text-red-400 ' +
  'bg-transparent hover:bg-red-400/10 transition-colors ' +
  'disabled:border-ink-border disabled:text-ink-subtle disabled:hover:bg-transparent'

// Task 3.6 material finishes. A light surface is a flat matte fill. The same
// component gains its restrained gradient, highlight edge and shadow only under
// the explicit dark class; keeping the recipe here prevents screens drifting.
export const CARD_SURFACE =
  'bg-slate-900 dark:bg-gloss-card dark:ring-1 dark:ring-inset dark:ring-slate-700 dark:shadow-gloss-sm'
export const SHELL_SURFACE = 'bg-shell dark:bg-gloss-shell'
export const SHELL_CARD_SURFACE =
  'bg-shell-surface border border-shell-border dark:bg-gloss-shell dark:shadow-gloss'
export const DIALOG_SURFACE =
  'bg-slate-950 dark:bg-gloss-card dark:ring-1 dark:ring-inset dark:ring-slate-700 dark:shadow-gloss'
export const BRAND_FINISH =
  'bg-brand-500 text-brand-label hover:bg-brand-600 ' +
  'dark:bg-gloss-brand dark:hover:bg-gloss-brand dark:hover:brightness-110 dark:shadow-gloss-sm'

// Status chips (task 3.3): a neutral pill whose only colour is a small dot, after
// Elijah's neutral look (no coloured fills). Shared so the Health screen (3.5)
// lists the same chips. Each value is a whole class name: Tailwind can't build
// `bg-${status}`, so the lookups below spell every one out.
export const CHIP =
  'inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300'

export const CHIP_DOT = 'h-1.5 w-1.5 flex-shrink-0 rounded-full'

export type StatusTone = 'danger' | 'warning' | 'success' | 'neutral'

export const STATUS_DOT: Record<StatusTone, string> = {
  danger:  'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
  neutral: 'bg-brand-600',
}

// Strength scale, the same on the chips and both meters: weak, fair and strong
// keep semantic colours; "good" uses the blue brand. The bar fills a quarter
// more at each level.
export type StrengthLabel = 'weak' | 'fair' | 'good' | 'strong'

export const STRENGTH_TONE: Record<StrengthLabel, StatusTone> = {
  weak:   'danger',
  fair:   'warning',
  good:   'neutral',
  strong: 'success',
}

export const STRENGTH_BAR: Record<StrengthLabel, string> = {
  weak:   'w-1/4 bg-danger',
  fair:   'w-2/4 bg-warning',
  good:   'w-3/4 bg-brand-600',
  strong: 'w-full bg-success',
}

// The create-vault meter follows the now-swapping application shell (task 3.6).
export const STRENGTH_BAR_ON_SHELL: Record<StrengthLabel, string> = {
  weak:   'w-1/4 bg-danger',
  fair:   'w-2/4 bg-warning',
  good:   'w-3/4 bg-brand-600',
  strong: 'w-full bg-success',
}

// Error banner on the light parts: main text colour with a thin red edge and a
// <WarningIcon className="text-danger" />, never a red fill
export const ERROR_BANNER =
  'flex items-start gap-2.5 rounded-xl border border-slate-700 border-l-4 border-l-danger ' +
  'bg-slate-950 px-4 py-3 text-sm text-primary'

// The same shape with an amber edge, for a heads-up rather than an error (task 3.5:
// the backup reminder, the "restoring deletes your notes" tick box), with a
// <ClockIcon /> or <WarningIcon className="text-warning" />
export const NOTICE_BANNER =
  'flex items-start gap-2.5 rounded-xl border border-slate-700 border-l-4 border-l-warning ' +
  'bg-slate-950 px-4 py-3 text-sm text-primary'

// Plain card on the light parts, and the Backup tab's "Danger zone" card (CSV
// export, full reset): neutral with a thin red left edge, never a pink panel (3.5)
export const CARD = `rounded-3xl p-6 ${CARD_SURFACE}`
export const DANGER_CARD = `rounded-3xl border-l-4 border-l-danger p-6 ${CARD_SURFACE}`

// Pill switch (the add/edit dialog's Password/PIN, the Generator's modes): a grey
// track with the chosen option as a white pill; each option sets aria-pressed
export const SEGMENTED = 'flex gap-1 rounded-full bg-slate-800 p-1'
export const SEGMENT =
  'flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs font-medium transition-colors'
export const SEGMENT_ON = 'bg-slate-950 text-primary shadow-sm'
export const SEGMENT_OFF = 'text-slate-400 hover:text-primary'

// Main and quiet buttons on the content surfaces. `brand-label` swaps from white
// on the accessible light-theme blue to near-black on SPACED blue in dark mode.
export const PRIMARY_BUTTON =
  `inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium ${BRAND_FINISH} ` +
  'transition-[filter,box-shadow,background-color] disabled:bg-none disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none'
export const QUIET_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-full bg-slate-800 px-5 py-2.5 text-sm font-medium ' +
  'text-slate-300 transition-colors hover:bg-slate-700 hover:text-primary'

// Text box on a card (3.3's dialog INPUT)
export const INPUT =
  'w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-primary placeholder-slate-500 ' +
  'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50'
