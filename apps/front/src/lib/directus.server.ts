import 'server-only'

// Server-side Directus access.
//
// The browser never talks to Directus directly and never holds a privileged
// credential. It talks to the route handlers under src/app/api, which forward the
// request with the *user's* access token from an httpOnly cookie.
//
// There is deliberately no service/admin token here. Anything that needs to act
// with system privileges belongs in a Directus extension endpoint
// (apps/directus/extensions/app), not in this app.

export function directusUrl(): string {
  const url = process.env['DIRECTUS_URL']
  if (!url) throw new Error('DIRECTUS_URL is not set (see apps/front/.env.local.example)')
  return url.replace(/\/+$/, '')
}

export interface DirectusSessionTokens {
  accessToken: string
  refreshToken: string
  /** Lifetime of the access token in milliseconds, as reported by Directus. */
  expires: number
}

interface LoginResponse {
  data?: { access_token?: string; refresh_token?: string; expires?: number }
}

/** Exchanges email + password for tokens. Throws on bad credentials. */
export async function login(email: string, password: string): Promise<DirectusSessionTokens> {
  const response = await fetch(`${directusUrl()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, mode: 'json' }),
    cache: 'no-store'
  })

  if (!response.ok) throw new Error(`Directus login failed with ${response.status}`)

  return readTokens((await response.json()) as LoginResponse)
}

/** Trades a refresh token for a fresh pair. Directus rotates both. */
export async function refresh(refreshToken: string): Promise<DirectusSessionTokens> {
  const response = await fetch(`${directusUrl()}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken, mode: 'json' }),
    cache: 'no-store'
  })

  if (!response.ok) throw new Error(`Directus refresh failed with ${response.status}`)

  return readTokens((await response.json()) as LoginResponse)
}

export async function logout(refreshToken: string): Promise<void> {
  await fetch(`${directusUrl()}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken, mode: 'json' }),
    cache: 'no-store'
  }).catch(() => undefined) // A failed logout must still clear our cookies.
}

function readTokens(payload: LoginResponse): DirectusSessionTokens {
  const { access_token: accessToken, refresh_token: refreshToken, expires } = payload.data ?? {}

  if (!accessToken || !refreshToken) throw new Error('Directus returned no tokens')

  return { accessToken, refreshToken, expires: expires ?? 15 * 60 * 1000 }
}

/** Raw pass-through to Directus with the caller's token. */
export function directusFetch(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${directusUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
      Authorization: `Bearer ${accessToken}`
    },
    cache: 'no-store'
  })
}
