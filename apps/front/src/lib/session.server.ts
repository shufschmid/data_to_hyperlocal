import 'server-only'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import type { DirectusSessionTokens } from './directus.server'

// The session is two httpOnly cookies. `httpOnly` is the whole point: no script in
// the browser can read the tokens, so an XSS bug cannot walk off with them.

export const ACCESS_COOKIE = 'session_access_token'
export const REFRESH_COOKIE = 'session_refresh_token'

const REFRESH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60 // matches REFRESH_TOKEN_TTL in the backend

export interface Session {
  accessToken: string | null
  refreshToken: string | null
}

export async function readSession(): Promise<Session> {
  const store = await cookies()

  return {
    accessToken: store.get(ACCESS_COOKIE)?.value ?? null,
    refreshToken: store.get(REFRESH_COOKIE)?.value ?? null
  }
}

export function writeSession(response: NextResponse, tokens: DirectusSessionTokens): void {
  const secure = process.env.NODE_ENV === 'production'

  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: Math.floor(tokens.expires / 1000)
  })

  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: REFRESH_MAX_AGE_SECONDS
  })
}

export function clearSession(response: NextResponse): void {
  response.cookies.delete(ACCESS_COOKIE)
  response.cookies.delete(REFRESH_COOKIE)
}
