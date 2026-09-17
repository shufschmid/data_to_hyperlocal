import { MARKE_KOPFZEILE, RAHMEN_KOPFZEILE } from './rahmen'

// The browser's half of the session marker.
//
// **Where it lives: in the page's memory, and nowhere else.** Not in
// `localStorage` (which survives the tab and is readable by any script on this
// origin), not in a cookie (that is the whole problem this replaces), not in
// the address after the entry. A reload inside the frame therefore loses the
// session, and the editor hands out a fresh token — 240 minutes' worth. That is
// the deal, written down rather than discovered.
//
// The marker is opaque: sealed with a key that never leaves the server. What
// the page can do with it is send it back, and that is all.

let marke: string | null = null
let fehler: string | null = null

export function holeMarke(): string | null {
  return marke
}

export function setzeMarke(neu: string): void {
  marke = neu
}

export function loescheMarke(): void {
  marke = null
  fehler = null
}

/** What the entry route refused with, for the screen. */
export function rahmenFehler(): string | null {
  return fehler
}

/** True when this page was opened as the editor's External App. */
export function imRahmen(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('rahmen') === 'editor'
}

/**
 * Reads the fragment the entry route left, once, and wipes it from the address.
 *
 * A FRAGMENT, not a query: it never reaches a server, never lands in an access
 * log and never travels in a `Referer`. `history.replaceState` then takes it
 * out of the address bar and the session history as well, so a screenshot or a
 * shared link carries nothing.
 */
export function uebernehmeFragment(): void {
  if (typeof window === 'undefined') return

  const roh = window.location.hash.replace(/^#/, '')
  if (roh === '') return

  const teile = new URLSearchParams(roh)
  const gefunden = teile.get('m')
  const abgelehnt = teile.get('fehler')

  if (gefunden !== null && gefunden !== '') marke = gefunden
  if (abgelehnt !== null && abgelehnt !== '') fehler = abgelehnt

  if (gefunden !== null || abgelehnt !== null) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }
}

/**
 * Every call the signed-in workspace makes, marker in and marker out.
 *
 * Outside the frame it adds nothing and is a plain `fetch` — the cookies do
 * their job and this must not change how they do it. Inside, it carries the
 * marker, picks up a renewed one (the proxy rotates the tokens behind it), and
 * drops it on a 401, which is what sends the workspace back to the login form
 * or to the editor.
 */
export async function sitzungsFetch(
  eingabe: RequestInfo | URL,
  init: RequestInit = {},
  roh: typeof fetch = fetch
): Promise<Response> {
  const kopf = new Headers(init.headers)

  if (marke !== null) {
    kopf.set(MARKE_KOPFZEILE, marke)
  } else if (imRahmen()) {
    // No marker yet: the login in the frame has to be answered with one, and
    // this is what says so. Reading it off the `Referer` is impossible —
    // `Referrer-Policy: no-referrer` is set for exactly this embedding.
    kopf.set(RAHMEN_KOPFZEILE, 'editor')
  }

  const antwort = await roh(eingabe, { ...init, headers: kopf })

  const erneuert = antwort.headers.get(MARKE_KOPFZEILE)
  if (erneuert !== null && erneuert !== '') marke = erneuert
  if (antwort.status === 401) marke = null

  return antwort
}
