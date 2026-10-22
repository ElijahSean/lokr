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
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00c8f8" />
          <stop offset="100%" stopColor="#0077a8" />
        </linearGradient>
      </defs>

      {/* App-icon background */}
      <rect width="64" height="64" rx="14" fill={`url(#${gradId})`} />

      {/* Shackle — drawn first so lock body overlaps the posts naturally */}
      <path
        d="M20 34V21A12 12 0 0 0 44 21V34"
        stroke="white"
        strokeWidth="4.5"
        strokeLinecap="round"
        opacity="0.9"
      />

      {/* Lock body */}
      <rect x="10" y="27" width="44" height="29" rx="6" fill="white" opacity="0.96" />

      {/* Keyhole */}
      <circle cx="32" cy="38.5" r="4.5" fill="#0090bb" />
      <rect x="30" y="41" width="4" height="8" rx="1.5" fill="#0090bb" />
    </svg>
  )
}
