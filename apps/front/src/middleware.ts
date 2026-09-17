import { NextResponse, type NextRequest } from 'next/server'
import { erlaubteUrspruenge, rahmenKopfzeilen } from '@/lib/einbettung'

// The ONLY reason this middleware exists: `headers()` in `next.config.ts` runs
// at BUILD time, and its result is frozen into `.next/routes-manifest.json`.
// Measured on 15 September 2026 — the frame header stayed `SAMEORIGIN` with
// `EDITOR_EINBETTUNG` set in the environment, because the build had run without
// it. On the Dokploy host that would have been the worst kind of failure: a
// switch that is set, reports nothing, and does nothing.
//
// Middleware runs per request, so `process.env` is read when it is read
// everywhere else in this app. The frame header therefore lives HERE and
// nowhere else — `next.config.ts` keeps the headers that never vary.

export function middleware(request: NextRequest): NextResponse {
  const einbettung = process.env.EDITOR_EINBETTUNG ?? ''

  // The editor opens the External App at `https://<front>/?token=<jwt>` — it
  // knows the registered address and nothing about our routes. So the entry is
  // recognised here and handed to the route that trades the token for a
  // session. A REDIRECT, not a rewrite: it takes the token out of the address
  // bar in one step, before any page renders with it.
  const token = request.nextUrl.searchParams.get('token')
  if (request.nextUrl.pathname === '/' && token !== null && token !== '') {
    const ziel = new URL('/api/auth/editor', request.nextUrl)
    ziel.searchParams.set('token', token)
    return NextResponse.redirect(ziel)
  }

  const antwort = NextResponse.next()
  for (const { key, value } of rahmenKopfzeilen(einbettung)) {
    antwort.headers.set(key, value)
  }

  // With the embedding switched on, an entry token travels in an address for
  // one hop. `no-referrer` is what keeps it out of everything this page then
  // loads or links to. Off by default, like the embedding itself.
  if (erlaubteUrspruenge(einbettung).length > 0) {
    antwort.headers.set('Referrer-Policy', 'no-referrer')
  }

  return antwort
}

export const config = {
  // Everything a browser renders. Static assets carry no frame decision.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
