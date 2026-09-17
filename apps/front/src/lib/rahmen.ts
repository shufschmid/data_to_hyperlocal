import { erlaubteUrspruenge } from './einbettung'

// Whether a request belongs to a session that lives in the editor's frame — and
// who may make such a request.
//
// Deliberately without `import 'server-only'`, like `auth.ts`: these are the
// rules, and keeping them here lets them be unit-tested instead of behind mocks
// for `next/headers`.
//
// **The decision hangs on the request, never on a module variable.** One
// process serves the framed workspace and the ordinary one at the same time; a
// global switch would make the last request decide for the next one.

/** Where the sealed session travels, in and out. */
export const MARKE_KOPFZEILE = 'x-sitzungsmarke'

/**
 * How the login form says "I am in the frame" before any marker exists.
 *
 * It cannot be read off the `Referer`: with `EDITOR_EINBETTUNG` set the
 * middleware sends `Referrer-Policy: no-referrer`, which is what keeps the
 * entry token out of the editor's logs. So the page, which knows its own
 * address, states it.
 */
export const RAHMEN_KOPFZEILE = 'x-rahmen'

export interface KopfzeilenLike {
  get(name: string): string | null
}

export function markeAus(kopfzeilen: KopfzeilenLike): string | null {
  const wert = kopfzeilen.get(MARKE_KOPFZEILE)?.trim() ?? ''
  return wert === '' ? null : wert
}

export function istRahmenSitzung(kopfzeilen: KopfzeilenLike): boolean {
  if (markeAus(kopfzeilen) !== null) return true
  return kopfzeilen.get(RAHMEN_KOPFZEILE)?.trim().toLowerCase() === 'editor'
}

/**
 * The address the browser actually asked for.
 *
 * `Host` inside a container is the compose service name, which matches no
 * `Origin` a browser ever sends; behind the reverse proxy that terminates TLS
 * the real one arrives as `X-Forwarded-Host`. Both headers may carry a
 * comma-separated chain when several proxies added to it — the first entry is
 * the one closest to the client.
 */
export function eigeneHerkunft(kopfzeilen: KopfzeilenLike): string {
  const erstes = (wert: string | null): string => (wert ?? '').split(',')[0]?.trim() ?? ''

  const host = erstes(kopfzeilen.get('x-forwarded-host')) || erstes(kopfzeilen.get('host'))
  if (host === '') return ''

  const schema = erstes(kopfzeilen.get('x-forwarded-proto')) || 'https'
  return `${schema}://${host}`
}

/**
 * The CSRF check the marker needs.
 *
 * A cookie carries its own rule against cross-site requests; `SameSite=None`
 * gives that up, and the marker replaces it with this: a writing request in the
 * frame must come from this workspace itself or from an origin that is allowed
 * to frame it. The allow-list is `EDITOR_EINBETTUNG`, read through the same
 * `erlaubteUrspruenge` that builds the `frame-ancestors` rule — one list, so
 * the two can never disagree about who is inside.
 *
 * A request without an `Origin` is refused rather than trusted. A browser sends
 * one on every `fetch` that carries a body, same-origin included; what does not
 * is the forged case.
 */
export function ursprungErlaubt(ursprung: string | null, eigen: string, editorRoh: string): boolean {
  const wert = ursprung?.trim() ?? ''
  if (wert === '') return false
  if (wert === eigen.trim()) return true
  return erlaubteUrspruenge(editorRoh).includes(wert)
}
