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
  const shineId = 'lokr-s' + rawId.replace(/[^a-zA-Z0-9]/g, '')

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
      {/* Task 3.6 logo. SVG fills cannot use the application's CSS variables, so
          these values deliberately mirror the palette and public/logo.svg. */}
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#393B41" />
          <stop offset="48%" stopColor="#2D2E32" />
          <stop offset="100%" stopColor="#0F1013" />
        </linearGradient>
        <linearGradient id={shineId} x1="32" y1="0" x2="32" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Gloss belongs to the black tile; the lock itself stays matte. */}
      <rect width="64" height="64" rx="14" fill={`url(#${gradId})`} />
      <path d="M1 14A13 13 0 0 1 14 1h36a13 13 0 0 1 13 13v12H1V14Z" fill={`url(#${shineId})`} />
      <rect x="0.5" y="0.5" width="63" height="63" rx="13.5" stroke="#D4E2EE" strokeOpacity="0.28" />

      {/* Shackle — drawn first so lock body overlaps the posts naturally */}
      <path
        d="M20 34V21A12 12 0 0 0 44 21V34"
        stroke="#F4F4F4"
        strokeWidth="4.5"
        strokeLinecap="round"
        opacity="0.95"
      />

      {/* Lock body */}
      <rect x="10" y="27" width="44" height="29" rx="6" fill="#F4F4F4" />

      {/* SPACED blue keyhole: 3.21:1 against the matte-white lock at icon size. */}
      <circle cx="32" cy="38.5" r="4.5" fill="#368CDD" />
      <rect x="30" y="41" width="4" height="8" rx="1.5" fill="#368CDD" />
    </svg>
  )
}
