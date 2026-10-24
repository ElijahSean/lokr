'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  oppositeTheme,
  serializeThemeCookie,
  type Theme,
} from '@/lib/theme'

interface ThemeContextValue {
  theme: Theme
  setTheme: (_theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme
  children: React.ReactNode
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)

  const setTheme = useCallback((nextTheme: Theme) => {
    document.documentElement.classList.toggle('dark', nextTheme === 'dark')
    document.documentElement.style.colorScheme = nextTheme
    document.cookie = serializeThemeCookie(nextTheme)
    setThemeState(nextTheme)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(oppositeTheme(theme))
  }, [setTheme, theme])

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [setTheme, theme, toggleTheme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
