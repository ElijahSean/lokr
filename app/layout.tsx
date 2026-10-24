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
import './globals.css'
import { SessionProvider } from '@/hooks/useSession'

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
 * SessionProvider must be here (not in individual pages) so that:
 *  - The session state persists during client-side navigation (no re-mount)
 *  - All components in the app tree can call useSession()
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/*
        suppressHydrationWarning on <html>: Tailwind sometimes adds classes during
        SSR that differ from the client's first render (e.g. dark mode). This attr
        tells React to skip the warning for the html/body elements only.
      */}
      <body className="min-h-screen bg-slate-950">
        {/*
          SessionProvider wraps the whole app so any component can call useSession().
          It's a Client Component (see hooks/useSession.ts) even though layout.tsx is a Server Component.
          Next.js allows Server Components to render Client Components as children.
        */}
        <SessionProvider>
          {children}
        </SessionProvider>
      </body>
    </html>
  )
}
