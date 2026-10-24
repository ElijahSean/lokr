'use client'

import { MoonIcon, SunIcon } from '@/components/Icons'
import { useTheme } from '@/hooks/useTheme'
import { oppositeTheme } from '@/lib/theme'

export default function ThemeToggle({
  className = '',
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  const { theme, toggleTheme } = useTheme()
  const nextTheme = oppositeTheme(theme)
  const actionLabel = `Switch to ${nextTheme} mode`

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={actionLabel}
      title={actionLabel}
      className={`inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium
        text-shell-muted transition-colors hover:bg-shell-surface hover:text-shell-text
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
        focus-visible:ring-offset-shell ${compact ? 'p-2.5' : 'px-3 py-2'} ${className}`}
    >
      {theme === 'dark'
        ? <SunIcon className="h-4 w-4" />
        : <MoonIcon className="h-4 w-4" />}
      <span className={compact ? 'sr-only' : 'hidden sm:inline'}>
        {nextTheme === 'dark' ? 'Dark' : 'Light'}
      </span>
    </button>
  )
}
