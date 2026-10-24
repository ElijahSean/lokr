/**
 * components/Icons.tsx — small line icons (task 3.2)
 *
 * Hand-written inline SVG in place of emoji, so the redesign adds no icon
 * dependency and no network call. All share one 24×24 stroke style and take
 * their colour from the text (currentColor). Decorative: hidden from screen
 * readers, so the button or label beside each one carries the meaning.
 * Elijah found the colour emoji too cartoony (2026-10-23), so every emoji in
 * the app is one of these now, and the stroke is a fine 1.75.
 */

interface IconProps {
  className?: string
}

// `filled` paints the shape in the text colour too: only the pinned pushpin (3.4)
function Svg({ className = 'w-4 h-4', filled = false, children }: IconProps & { filled?: boolean; children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function VaultIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </Svg>
  )
}

export function NotesIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z" />
      <path d="M15 3v6h6" />
    </Svg>
  )
}

export function GeneratorIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </Svg>
  )
}

export function HealthIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  )
}

export function BackupIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M21 8v13H3V8" />
      <rect x="1" y="3" width="22" height="5" />
      <path d="M10 12h4" />
    </Svg>
  )
}

export function LockIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Svg>
  )
}

export function WarningIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  )
}

export function PinCodeIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 9h16" />
      <path d="M4 15h16" />
      <path d="M10 3L8 21" />
      <path d="M16 3l-2 18" />
    </Svg>
  )
}

export function ClockIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Svg>
  )
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </Svg>
  )
}

export function UploadIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </Svg>
  )
}

export function TrashIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Svg>
  )
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12l3 3 5-6" />
    </Svg>
  )
}

export function RepeatIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </Svg>
  )
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </Svg>
  )
}

export function InfoIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </Svg>
  )
}

// Entry cards, the vault toolbar and the add/edit dialog (task 3.3), moved here
// from inline SVG in EntryCard.tsx and VaultList.tsx

export function SearchIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </Svg>
  )
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  )
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </Svg>
  )
}

export function EyeIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

export function EyeOffIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.5 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 5.24A9.12 9.12 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M2 2l20 20" />
    </Svg>
  )
}

export function CopyIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M20 6L9 17l-5-5" />
    </Svg>
  )
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  )
}

export function PencilIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </Svg>
  )
}

// Generator and Health (task 3.5), moved here from inline SVG

export function RefreshIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </Svg>
  )
}

// Notes tab and the open note (task 3.4), moved here from inline SVG in
// StickyNotes.tsx and StickyNoteView.tsx

/** Pushpin, filled when the note is pinned. */
export function PinIcon({ className, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <Svg className={className} filled={filled}>
      <path d="M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6z" />
      <path d="M12 15v6" />
    </Svg>
  )
}

/** Notebook rulings, for the Lined toggle. */
export function LinesIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </Svg>
  )
}

export function GridIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Svg>
  )
}

export function ListIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </Svg>
  )
}

/** Theme-setting icons (task 3.7). */
export function SunIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.93 4.93l1.42 1.42" />
      <path d="M17.66 17.66l1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M4.93 19.07l1.42-1.41" />
      <path d="M17.66 6.34l1.41-1.41" />
    </Svg>
  )
}

export function MoonIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Svg>
  )
}
