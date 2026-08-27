import 'server-only'
import { NextResponse } from 'next/server'
import { directusFetch, refresh, type DirectusSessionTokens } from './directus.server'
import { createRefreshCache, isTokenRejected } from './sessionRefresh'
import { clearSession, readSession, writeSession } from './session.server'

// One place where a browser request becomes a Directus request.
//
// Every route handler under src/app/api goes through here, which is what makes the
// security story short: the caller's own token is used, so Directus permissions
// decide what happens. There is no privileged fallback to leak.

// Shared by every request this process handles, on purpose — see sessionRefresh.ts.
const refreshes = createRefreshCache()

export interface ProxyRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** A string, not a stream — the request may be replayed after a token refresh. */
  body?: string
}

export async function proxyToDirectus(path: string, request: ProxyRequest): Promise<NextResponse> {
  const session = await readSession()

  if (session.accessToken === null && session.refreshToken === null) {
    return problem(401, 'Nicht angemeldet.')
  }

  let rotated: DirectusSessionTokens | null = null
  let accessToken = session.accessToken

  // The access cookie expires long before the refresh cookie does. Renew first
  // rather than sending a request we know will fail.
  if (accessToken === null && session.refreshToken !== null) {
    const renewed = await tryRefresh(session.refreshToken)
    if (renewed === null) return expired()
    rotated = renewed
    accessToken = renewed.accessToken
  }

  let upstream = await directusFetch(path, accessToken as string, request)
  let payload = await upstream.text()

  // Token rejected mid-flight (revoked, restart, clock skew, or rotated away by a
  // sibling request): renew once and retry. Directus says 401 for an expired token
  // but 403 INVALID_TOKEN for a session that no longer exists, and a 403 that only
  // *looks* like a permission error is how the second one used to reach the
  // browser instead of being replayed.
  if (rotated === null && session.refreshToken !== null && isTokenRejected(upstream.status, payload)) {
    const renewed = await tryRefresh(session.refreshToken)
    if (renewed === null) return expired()
    rotated = renewed
    upstream = await directusFetch(path, renewed.accessToken, request)
    payload = await upstream.text()
  }

  const response = new NextResponse(payload, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store'
    }
  })

  if (rotated !== null) writeSession(response, rotated)

  return response
}

async function tryRefresh(refreshToken: string): Promise<DirectusSessionTokens | null> {
  try {
    return await refreshes.renew(refreshToken, refresh)
  } catch {
    return null
  }
}

function expired(): NextResponse {
  const response = problem(401, 'Sitzung abgelaufen. Bitte neu anmelden.')
  clearSession(response)
  return response
}

export function problem(status: number, message: string): NextResponse {
  return NextResponse.json({ errors: [{ message }] }, { status, headers: { 'Cache-Control': 'no-store' } })
}
