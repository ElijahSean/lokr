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
