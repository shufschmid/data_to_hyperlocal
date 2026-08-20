import 'server-only'
import { NextResponse } from 'next/server'
import { directusUrl } from './directus.server'

// The paths into Directus that carry no session — kept few, kept narrow.
//
// `proxyToDirectus` refuses without cookies, and rightly so — but the person
// counter-checking an article has no account. So there is a second, deliberately
// unauthenticated route, kept apart from the first and kept narrow.
//
// The narrowness is the entire safety argument. An unauthenticated proxy that
// forwarded an arbitrary path would be an open door to every collection
// Directus exposes to the public role, reachable from our own origin. Only the
// prefixes below can be reached, and they are the two approval routes, which
// authenticate by token themselves.

const ERLAUBTE_PFADE = ['/redaktion/freigabe']

function istErlaubt(pfad: string): boolean {
  // `startsWith` alone would let "/redaktion/freigabe-etwas-anderes" through,
  // so the boundary has to be explicit.
  return ERLAUBTE_PFADE.some((erlaubt) => pfad === erlaubt || pfad.startsWith(`${erlaubt}/`))
}

export interface PublicRequest {
  method: 'GET' | 'POST'
  /** A string, not a stream — same reason as in proxy.server.ts. */
  body?: string
}

export async function publicToDirectus(path: string, request: PublicRequest): Promise<NextResponse> {
  const [pfad] = path.split('?')

  if (pfad === undefined || !istErlaubt(pfad)) {
    // A bug on our side, not the caller's — but it must never become a request.
    return problemOeffentlich(404, 'Nicht gefunden.')
  }

  const upstream = await fetch(`${directusUrl()}${path}`, {
    method: request.method,
    headers: { 'Content-Type': 'application/json' },
    ...(request.body === undefined ? {} : { body: request.body }),
    cache: 'no-store'
  })

  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
      // The token is in this URL. Keep it out of anything downstream.
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow'
    }
  })
}

export function problemOeffentlich(status: number, message: string): NextResponse {
  return NextResponse.json(
    { errors: [{ message }] },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow'
      }
    }
  )
}

// --- the public blog ----------------------------------------------------------
//
// The second unauthenticated path, and like the first it is narrow by
// construction: the extension endpoint it calls hard-wires the filter to
// published articles and projects only reader-facing fields. This helper is for
// server components — the blog page renders without a session, so it cannot go
// through proxyToDirectus.

export interface BlogBeitrag {
  id: string
  titel: string | null
  lead: string | null
  text: string | null
  publiziert_am: string | null
  gemeinde: { name: string } | null
  spiel: { sportart: string; heim: string; gast: string; datum: string } | null
}

export async function holeBlog(): Promise<BlogBeitrag[]> {
  const upstream = await fetch(`${directusUrl()}/redaktion/blog`, {
    // Public content may be cached briefly; a minute is invisible to a reader
    // and spares Directus the per-request round trip.
    next: { revalidate: 60 }
  })
  if (!upstream.ok) {
    throw new Error(`Blog nicht lesbar: HTTP ${upstream.status}`)
  }
  const json = (await upstream.json()) as { data?: BlogBeitrag[] }
  return json.data ?? []
}
