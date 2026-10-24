import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  oppositeTheme,
  parseTheme,
  serializeThemeCookie,
  THEME_COOKIE_MAX_AGE,
  THEME_COOKIE_NAME,
} from '@/lib/theme'

describe('persistent theme preference', () => {
  it('defaults missing and invalid values to dark', () => {
    expect(DEFAULT_THEME).toBe('dark')
    expect(parseTheme(undefined)).toBe('dark')
    expect(parseTheme(null)).toBe('dark')
    expect(parseTheme('')).toBe('dark')
    expect(parseTheme('system')).toBe('dark')
    expect(parseTheme('DARK')).toBe('dark')
  })

  it('accepts only the two supported values', () => {
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('dark')).toBe('dark')
  })

  it('toggles between light and dark', () => {
    expect(oppositeTheme('dark')).toBe('light')
    expect(oppositeTheme('light')).toBe('dark')
  })

  it('serializes only presentation state with strict local attributes', () => {
    expect(THEME_COOKIE_NAME).toBe('lokr-theme')
    expect(THEME_COOKIE_MAX_AGE).toBe(31_536_000)
    expect(serializeThemeCookie('dark')).toBe(
      'lokr-theme=dark; Path=/; Max-Age=31536000; SameSite=Strict'
    )
    expect(serializeThemeCookie('light')).toBe(
      'lokr-theme=light; Path=/; Max-Age=31536000; SameSite=Strict'
    )
  })

  it('uses the root class for both Tailwind variants and colour variables', () => {
    const config = readFileSync(new URL('../tailwind.config.js', import.meta.url), 'utf8')
    const palette = readFileSync(new URL('../tailwind.palette.js', import.meta.url), 'utf8')
    expect(config).toContain("darkMode: 'class'")
    expect(config).toContain("':root.dark': { ...darkVars, colorScheme: 'dark' }")
    expect(config).not.toContain('prefers-color-scheme')
    expect(palette).not.toContain('prefers-color-scheme')
  })

  it('server-renders the validated cookie value before hydration', () => {
    const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8')
    expect(layout).toContain('parseTheme(cookies().get(THEME_COOKIE_NAME)?.value)')
    expect(layout).toContain("className={theme === 'dark' ? 'dark' : undefined}")
    expect(layout).toContain('style={{ colorScheme: theme }}')
    expect(layout).toContain('<ThemeProvider initialTheme={theme}>')
  })

  it('keeps an accessible control on locked and unlocked shells', () => {
    const toggle = readFileSync(new URL('../components/ThemeToggle.tsx', import.meta.url), 'utf8')
    const unlock = readFileSync(new URL('../components/UnlockScreen.tsx', import.meta.url), 'utf8')
    const vault = readFileSync(new URL('../app/vault/page.tsx', import.meta.url), 'utf8')
    const provider = readFileSync(new URL('../hooks/useTheme.tsx', import.meta.url), 'utf8')

    expect(toggle).toContain('aria-label={actionLabel}')
    expect(toggle).toContain('focus-visible:ring-2')
    expect((unlock.match(/<ThemeToggle/g) ?? [])).toHaveLength(3)
    expect(vault).toContain('<ThemeToggle compact />')
    expect(vault).toContain('flex-shrink-0')
    expect(provider).toContain("classList.toggle('dark', nextTheme === 'dark')")
    expect(provider).toContain('document.cookie = serializeThemeCookie(nextTheme)')
  })
})
