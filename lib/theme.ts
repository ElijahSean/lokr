/** Non-sensitive presentation preference shared by server and client code. */
export type Theme = 'light' | 'dark'

export const THEME_COOKIE_NAME = 'lokr-theme'
export const DEFAULT_THEME: Theme = 'dark'
export const THEME_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

/** Invalid or absent values deliberately fall back to the less-bright theme. */
export function parseTheme(value: string | null | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : DEFAULT_THEME
}

export function oppositeTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}

/** The cookie contains presentation state only—never vault data or identifiers. */
export function serializeThemeCookie(theme: Theme): string {
  return (
    `${THEME_COOKIE_NAME}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; ` +
    'SameSite=Strict'
  )
}
