import 'server-only'
import { NextResponse } from 'next/server'
import { directusFetch, refresh, type DirectusSessionTokens } from './directus.server'
import { clearSession, readSession, writeSession } from './session.server'

// One place where a browser request becomes a Directus request.
//
// Every route handler under src/app/api goes through here, which is what makes the
// security story short: the caller's own token is used, so Directus permissions
// decide what happens. There is no privileged fallback to leak.

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

  // Token rejected mid-flight (revoked, restart, clock skew): renew once and retry.
  if (upstream.status === 401 && rotated === null && session.refreshToken !== null) {
    const renewed = await tryRefresh(session.refreshToken)
    if (renewed === null) return expired()
    rotated = renewed
    upstream = await directusFetch(path, renewed.accessToken, request)
  }

  const response = new NextResponse(await upstream.text(), {
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
    return await refresh(refreshToken)
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
