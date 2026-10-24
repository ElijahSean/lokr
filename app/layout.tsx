/**
 * app/layout.tsx — Root layout (Next.js App Router)
 *
 * This file wraps EVERY page in the app.
 * It imports global CSS, sets page metadata, and mounts the SessionProvider
 * so all components can access session state via useSession().
 *
 * Note: layout.tsx is a Server Component by default in Next.js 14.
 * We cannot use React hooks directly here. Client-side features (SessionProvider)
 * are wrapped in a separate Providers component marked 'use client'.
 */

import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import './globals.css'
import { SessionProvider } from '@/hooks/useSession'
import { ThemeProvider } from '@/hooks/useTheme'
import { parseTheme, THEME_COOKIE_NAME } from '@/lib/theme'

// Task 4.2: a CSP nonce is fresh per request, so the App Router must render the
// document per request rather than reusing HTML whose script nonces are stale.
export const dynamic = 'force-dynamic'

// Next.js uses this object to set <title> and <meta description> tags automatically
export const metadata: Metadata = {
  title: 'Lokr — Your secrets, your machine.',
  description:
    'A local password manager. All vault data stays on your device, encrypted with your master password. No cloud. No accounts. No network.',
  robots: 'noindex, nofollow',
  icons: {
    // Version the path when the artwork changes so Chrome does not keep an old
    // tab icon after task 3.6's black/white/blue logo refresh.
    icon: '/logo.svg?v=3.6',
  },
}

/**
 * RootLayout wraps every page.
 *
 * Providers must be here (not in individual pages) so that:
 *  - Theme and session state persist during client-side navigation
 *  - All components in the app tree can call useTheme() and useSession()
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const theme = parseTheme(cookies().get(THEME_COOKIE_NAME)?.value)

  return (
    <html
      lang="en"
      className={theme === 'dark' ? 'dark' : undefined}
      style={{ colorScheme: theme }}
    >
      <body className="min-h-screen bg-slate-950">
        {/* The validated theme is already rendered on <html> before these client
            provider boundaries hydrate. */}
        <ThemeProvider initialTheme={theme}>
          <SessionProvider>
            {children}
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
