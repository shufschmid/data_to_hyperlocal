import 'server-only'
import { NextResponse } from 'next/server'
import { directusFetch, refresh, type DirectusSessionTokens } from './directus.server'
import { istTokenProblem } from './auth'
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

// One renewal per refresh token, however many requests ask for it.
//
// The access cookie is given exactly the lifetime of the token it carries, so
// the browser drops it the moment the token dies — and the workspace, which
// fires a dozen queries in parallel, then sends a dozen renewals carrying the
// same refresh token. Directus rotates on every refresh: the first caller wins
// and every later one is told its token is invalid, which used to tear down the
// very session the winner had just renewed.
//
// Sharing the in-flight promise is not enough, and that was measured: requests
// that arrive just *after* the winner finished still carry the old cookie —
// they were sent before any `Set-Cookie` came back — and would each start a
// doomed refresh. So the result outlives the call for a short grace period, and
// everyone still holding the old token is handed the same new pair.
//
// Per process, which is what this deployment has. Several front containers
// would each keep their own map and a slim window would remain.
const ERNEUERUNG_GNADENFRIST_MS = 60_000

const laufendeErneuerung = new Map<string, Promise<DirectusSessionTokens | null>>()
const juengsteErneuerung = new Map<string, { tokens: DirectusSessionTokens | null; zeit: number }>()

function merke(refreshToken: string, tokens: DirectusSessionTokens | null): void {
  const jetzt = Date.now()
  // Aufgeraeumt wird beim Schreiben: die Karte bleibt so gross wie die Zahl der
  // Sitzungen, die in einer Minute erneuert haben.
  for (const [schluessel, eintrag] of juengsteErneuerung) {
    if (jetzt - eintrag.zeit >= ERNEUERUNG_GNADENFRIST_MS) juengsteErneuerung.delete(schluessel)
  }
  juengsteErneuerung.set(refreshToken, { tokens, zeit: jetzt })
}

function erneuere(refreshToken: string): Promise<DirectusSessionTokens | null> {
  const laufend = laufendeErneuerung.get(refreshToken)
  if (laufend !== undefined) return laufend

  const fertig = juengsteErneuerung.get(refreshToken)
  if (fertig !== undefined && Date.now() - fertig.zeit < ERNEUERUNG_GNADENFRIST_MS) {
    return Promise.resolve(fertig.tokens)
  }

  const versuch = refresh(refreshToken)
    .catch(() => null)
    .then((tokens) => {
      merke(refreshToken, tokens)
      return tokens
    })
    .finally(() => laufendeErneuerung.delete(refreshToken))

  laufendeErneuerung.set(refreshToken, versuch)
  return versuch
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
    const renewed = await erneuere(session.refreshToken)
    if (renewed === null) return expired()
    rotated = renewed
    accessToken = renewed.accessToken
  }

  let upstream = await directusFetch(path, accessToken as string, request)
  // Read once: the body is needed to tell a token problem from a permission
  // one, and a Response can only be consumed a single time.
  let koerper = await upstream.text()

  // Token rejected mid-flight — revoked, a restart, or a backend that cannot
  // verify it at all. Renew once and retry.
  if (istTokenProblem(upstream.status, koerper) && rotated === null && session.refreshToken !== null) {
    const renewed = await erneuere(session.refreshToken)
    if (renewed === null) return expired()
    rotated = renewed
    upstream = await directusFetch(path, renewed.accessToken, request)
    koerper = await upstream.text()
  }

  // Still refused with a freshly minted token: the session is dead. Saying so
  // and dropping the cookies is what lets the workspace fall back to the login
  // form — passing the refusal through would leave the browser holding a
  // credential that can only ever fail again.
  if (istTokenProblem(upstream.status, koerper)) return expired()

  const response = new NextResponse(koerper, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store'
    }
  })

  if (rotated !== null) writeSession(response, rotated)

  return response
}

function expired(): NextResponse {
  const response = problem(401, 'Sitzung abgelaufen. Bitte neu anmelden.')
  clearSession(response)
  return response
}

export function problem(status: number, message: string): NextResponse {
  return NextResponse.json({ errors: [{ message }] }, { status, headers: { 'Cache-Control': 'no-store' } })
}
