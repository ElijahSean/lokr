'use client'

import { useId } from 'react'

interface LokrIconProps {
  size?: number
  className?: string
  'aria-hidden'?: boolean
}

export function LokrIcon({
  size = 64,
  className = '',
  'aria-hidden': ariaHidden = true,
}: LokrIconProps) {
  const rawId = useId()
  const gradId = 'lokr-g' + rawId.replace(/[^a-zA-Z0-9]/g, '')

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaHidden || undefined}
      role={ariaHidden ? undefined : 'img'}
      aria-label={ariaHidden ? undefined : 'Lokr'}
      className={className}
    >
      {/* Neutral graphite tile (task 3.2; Elijah chose it over an orange gradient
          to sit with the black top bar). SVG fills can't take Tailwind classes,
          so the hex values repeat here: ink.border → ink.surface, the lock in
          ink.text, the keyhole in accent.strong. public/logo.svg mirrors them. */}
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#393b3d" />
          <stop offset="100%" stopColor="#232121" />
        </linearGradient>
      </defs>

      {/* App-icon background, with a faint light edge so it shows on the #121212 bar */}
      <rect width="64" height="64" rx="14" fill={`url(#${gradId})`} />
      <rect x="0.5" y="0.5" width="63" height="63" rx="13.5" stroke="white" strokeOpacity="0.14" />

      {/* Shackle — drawn first so lock body overlaps the posts naturally */}
      <path
        d="M20 34V21A12 12 0 0 0 44 21V34"
        stroke="#f6efee"
        strokeWidth="4.5"
        strokeLinecap="round"
        opacity="0.9"
      />

      {/* Lock body */}
      <rect x="10" y="27" width="44" height="29" rx="6" fill="#f6efee" />

      {/* Keyhole — the app's one small coral accent (accent.strong) */}
      <circle cx="32" cy="38.5" r="4.5" fill="#c64c3a" />
      <rect x="30" y="41" width="4" height="8" rx="1.5" fill="#c64c3a" />
    </svg>
  )
}
