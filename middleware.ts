import { NextRequest, NextResponse } from 'next/server'
import { buildContentSecurityPolicy, createNonce } from '@/lib/csp'

/**
 * Next.js must see the CSP on the request so it can copy the nonce onto its
 * App Router bootstrap scripts. Chrome must receive the identical policy on
 * the response so those scripts are allowed to run.
 */
export function middleware(request: NextRequest) {
  const nonce = createNonce()
  const contentSecurityPolicy = buildContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === 'development'
  )
  const requestHeaders = new Headers(request.headers)

  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })
  response.headers.set('Content-Security-Policy', contentSecurityPolicy)

  return response
}

// Static assets contain no inline App Router bootstrap, so they do not need a
// per-request nonce or the extra request-time rendering work.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.svg).*)'],
}
