import 'server-only'
import { NextResponse } from 'next/server'
import { directusUrl } from './directus.server'

// The one path into Directus that carries no session.
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
