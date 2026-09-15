import { NextResponse } from 'next/server'
import { rahmenKopfzeilen } from '@/lib/einbettung'

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

export function middleware(): NextResponse {
  const antwort = NextResponse.next()
  for (const { key, value } of rahmenKopfzeilen(process.env.EDITOR_EINBETTUNG ?? '')) {
    antwort.headers.set(key, value)
  }
  return antwort
}

export const config = {
  // Everything a browser renders. Static assets carry no frame decision.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
