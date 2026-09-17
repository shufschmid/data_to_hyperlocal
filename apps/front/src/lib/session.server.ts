import 'server-only'
import { cookies, headers } from 'next/headers'
import type { NextResponse } from 'next/server'
import type { DirectusSessionTokens } from './directus.server'
import { cookieOptionen } from './einbettung'
import { oeffne, versiegle } from './marke.server'
import { istRahmenSitzung, MARKE_KOPFZEILE, markeAus } from './rahmen'

// The session is two httpOnly cookies — outside the editor's frame. `httpOnly`
// is the whole point there: no script in the browser can read the tokens, so an
// XSS bug cannot walk off with them.
//
// INSIDE the frame there is no cookie at all. Safari blocks third-party cookies
// outright and Firefox partitions them, so a `SameSite=None` cookie simply does
// not arrive and the workspace looks logged out with no error anywhere. There
// the same token pair travels sealed, in the `X-Sitzungsmarke` header — see
// `marke.server.ts` for what that is and what it costs.

export const ACCESS_COOKIE = 'session_access_token'
export const REFRESH_COOKIE = 'session_refresh_token'

const REFRESH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60 // matches REFRESH_TOKEN_TTL in the backend

export interface Session {
  accessToken: string | null
  refreshToken: string | null
  /** True when this request's session travels as a marker, not as cookies. */
  imRahmen: boolean
}

/**
 * The marker first, the cookies second.
 *
 * Never both: a browser that sends a marker is in the frame, and a stale cookie
 * from an earlier same-site visit must not quietly win over the session the
 * editor just handed over. A marker that cannot be opened — expired, tampered
 * with, wrong key — is treated as no marker and the cookies decide, exactly as
 * if nothing had been sent.
 */
export async function readSession(): Promise<Session> {
  const kopfzeilen = await headers()
  const marke = markeAus(kopfzeilen)

  if (marke !== null) {
    const tokens = await oeffne(marke, Date.now())
    if (tokens !== null) {
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        imRahmen: true
      }
    }
  }

  const store = await cookies()

  return {
    accessToken: store.get(ACCESS_COOKIE)?.value ?? null,
    refreshToken: store.get(REFRESH_COOKIE)?.value ?? null,
    imRahmen: istRahmenSitzung(kopfzeilen)
  }
}

/**
 * Writes the renewed session back — as a header in the frame, as cookies
 * everywhere else.
 *
 * `imRahmen` is a decision taken per request (`istRahmenSitzung`), never a
 * module variable: one process serves both kinds of visitor at the same time.
 */
export async function writeSession(
  response: NextResponse,
  tokens: DirectusSessionTokens,
  imRahmen = false
): Promise<void> {
  if (imRahmen) {
    const marke = await versiegle(tokens, Date.now())
    // No key configured means no frame session at all; the caller's 401 then
    // sends the workspace back to the editor, which is the honest outcome.
    if (marke !== null) response.headers.set(MARKE_KOPFZEILE, marke)
    return
  }

  // `lax` unless the workspace is embedded in the editor. In a foreign frame a
  // lax cookie is not sent at all, so the workspace would look logged out; the
  // price of `none` is spelled out in einbettung.ts. httpOnly is untouched
  // either way — that is the part that stops a script reading the tokens.
  const { sameSite, secure } = cookieOptionen(
    process.env.EDITOR_EINBETTUNG ?? '',
    process.env.NODE_ENV === 'production'
  )

  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite,
    secure,
    path: '/',
    maxAge: Math.floor(tokens.expires / 1000)
  })

  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite,
    secure,
    path: '/',
    maxAge: REFRESH_MAX_AGE_SECONDS
  })
}

export function clearSession(response: NextResponse): void {
  response.cookies.delete(ACCESS_COOKIE)
  response.cookies.delete(REFRESH_COOKIE)
  // A frame session has no cookie to delete: the browser holds the marker in
  // the page's memory, and the 401 this accompanies is what makes it drop it.
}
