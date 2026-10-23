/**
 * components/ui.ts — class strings shared across screens (task 3.2)
 *
 * Lives in components/ because Tailwind's content globs skip lib/, so class
 * names written anywhere else would be dropped from the CSS.
 */

// Destructive buttons (delete, discard, CSV export, full reset). Once the brand
// became YouVersion red, a filled red Delete looked just like a filled red Save,
// so destructive actions are an outline instead, paired with a <WarningIcon />.
// Colour, border and icon spacing only: each button keeps its own size and shape.
// The translucent hover reads on any background (card, red panel, note paper).
export const DANGER_OUTLINE =
  'inline-flex items-center justify-center gap-1.5 border border-red-600 text-red-700 ' +
  'bg-transparent hover:bg-red-600/10 transition-colors ' +
  'disabled:border-slate-700 disabled:text-slate-500 disabled:hover:bg-transparent'

// The same on a dark surface (the black note paper, task 2.8; dark mode in 3.1):
// red-700 is unreadable on #121212, red-400 is 6.8:1 (tests/theme.spec.ts)
export const DANGER_OUTLINE_ON_DARK =
  'inline-flex items-center justify-center gap-1.5 border border-red-400 text-red-400 ' +
  'bg-transparent hover:bg-red-400/10 transition-colors ' +
  'disabled:border-ink-border disabled:text-ink-subtle disabled:hover:bg-transparent'

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

// Strength scale, the same on the chips and both meters: only weak, fair and
// strong get a status colour; "good" is graphite (Elijah, 2026-10-23). The bar
// fills a quarter more at each level.
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

// The create-vault meter sits on the dark unlock screen, so it takes the `dark` values
export const STRENGTH_BAR_ON_DARK: Record<StrengthLabel, string> = {
  weak:   'w-1/4 bg-danger-dark',
  fair:   'w-2/4 bg-warning-dark',
  good:   'w-3/4 bg-ink-muted',
  strong: 'w-full bg-success-dark',
}

// Error banner on the light parts: main text colour with a thin red edge and a
// <WarningIcon className="text-danger" />, never a red fill
export const ERROR_BANNER =
  'flex items-start gap-2.5 rounded-xl border border-slate-700 border-l-4 border-l-danger ' +
  'bg-slate-950 px-4 py-3 text-sm text-primary'
