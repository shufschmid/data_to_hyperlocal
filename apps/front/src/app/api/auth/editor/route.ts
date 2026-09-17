import { NextResponse, type NextRequest } from 'next/server'
import { directusUrl, type DirectusSessionTokens } from '@/lib/directus.server'
import { markeMoeglich, versiegle } from '@/lib/marke.server'

// GET /api/auth/editor?token=<jwt> — the way in from the We.Publish editor.
//
// The editor opens the External App at `https://<front>/?token=<jwt>`; that
// address lands here, this route trades the token for a Directus session at
// `POST /redaktion/editor-zugang`, seals it into a marker and sends the browser
// on to `/?rahmen=editor#m=<marke>`.
//
// **A fragment, not a query.** `#…` is never sent to a server, never appears in
// an access log and never travels in a `Referer`. The page reads it once, puts
// it in memory and wipes it from the address with `history.replaceState`.
//
// The `token=` of the INCOMING request is a different matter: it is a query,
// so the reverse proxy in front of this app does log it. It is worth 240
// minutes and buys nothing without this instance's own configuration, but the
// deployment should redact it all the same — that is a note for whoever runs
// Traefik, not something this app can do.

const ZEITGRENZE_MS = 8000

function weiter(request: NextRequest, fragment: string): NextResponse {
  const ziel = new URL('/', request.nextUrl)
  ziel.searchParams.set('rahmen', 'editor')
  ziel.hash = fragment
  return NextResponse.redirect(ziel, {
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
  })
}

function abgelehnt(request: NextRequest, meldung: string): NextResponse {
  return weiter(request, `fehler=${encodeURIComponent(meldung)}`)
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (token === null || token.trim() === '') {
    return abgelehnt(request, 'Es kam kein Token aus dem Editor an.')
  }

  if (!markeMoeglich()) {
    return abgelehnt(
      request,
      'Der Editor-Zugang ist auf dieser Instanz nicht eingerichtet (SITZUNGSMARKE_SCHLUESSEL fehlt).'
    )
  }

  let antwort: Response
  try {
    antwort = await fetch(`${directusUrl()}/redaktion/editor-zugang`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.trim() }),
      cache: 'no-store',
      signal: AbortSignal.timeout(ZEITGRENZE_MS)
    })
  } catch {
    return abgelehnt(request, 'Die Redaktion war nicht erreichbar. Bitte noch einmal versuchen.')
  }

  const inhalt = (await antwort.json().catch(() => null)) as {
    errors?: { message?: string }[]
    data?: { access_token?: string; refresh_token?: string; expires?: number }
  } | null

  if (!antwort.ok) {
    // The backend's German message, passed through unchanged: it is the only
    // place that knows WHICH of the refusals this was.
    return abgelehnt(
      request,
      inhalt?.errors?.[0]?.message ?? 'Die Anmeldung über den Editor hat nicht geklappt.'
    )
  }

  const { access_token: accessToken, refresh_token: refreshToken, expires } = inhalt?.data ?? {}
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    return abgelehnt(request, 'Die Anmeldung über den Editor hat nicht geklappt.')
  }

  const tokens: DirectusSessionTokens = {
    accessToken,
    refreshToken,
    expires: typeof expires === 'number' ? expires : 15 * 60 * 1000
  }

  const marke = await versiegle(tokens, Date.now())
  if (marke === null) {
    return abgelehnt(request, 'Die Sitzung konnte nicht versiegelt werden.')
  }

  return weiter(request, `m=${marke}`)
}
