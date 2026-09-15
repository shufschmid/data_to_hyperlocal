// Running this workspace inside the We.Publish editor.
//
// The editor embeds the newsroom's tools as an iframe. Two things in this app
// say no to that today, and both are correct until somebody deliberately turns
// the embedding on:
//
//   - `X-Frame-Options: SAMEORIGIN` forbids the frame outright.
//   - the session cookies are `SameSite=Lax`, so in a foreign frame the browser
//     does not send them at all and the workspace looks logged out.
//
// `EDITOR_EINBETTUNG` is what turns it on: a list of allowed origins, EMPTY BY
// DEFAULT. Empty means exactly today's behaviour, which is why this can ship
// before anyone has decided on a domain — the `CRAWLER_KEY` bargain.
//
// **The price is real and belongs in the open.** `SameSite=None` gives up the
// CSRF protection the cookie itself provides. What stays: the tokens remain
// httpOnly, so no script can read them, and every call to Directus still goes
// through this app's own same-origin `/api/*` routes. What goes: the browser
// will attach the session cookie to a cross-site request, so a request forged
// from another page is no longer stopped by the cookie's own rule. That is the
// cost of living in someone else's frame, and it is paid ONLY when the variable
// is set.

/** An origin is scheme + host + optional port, and nothing else. */
const URSPRUNG = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i

/**
 * The origins from the environment variable, the unusable ones dropped.
 *
 * An allow-list, never a pass-through: anything that is not a plain `https://`
 * origin is thrown away rather than written into a CSP. `http://` would make the
 * frame-ancestors rule meaningless, a path or a `*` is not an origin at all, and
 * a bare host name silently matches nothing.
 */
export function erlaubteUrspruenge(roh: string): string[] {
  return roh
    .split(/[\s,]+/)
    .map((teil) => teil.trim())
    .filter((teil) => teil !== '' && URSPRUNG.test(teil))
}

export interface Kopfzeile {
  key: string
  value: string
}

/**
 * The frame headers for `next.config.ts`.
 *
 * Either the old header or the CSP, never both: they contradict each other,
 * modern browsers follow the CSP and the old one only confuses the picture. With
 * nothing usable configured the app keeps exactly the behaviour it has today.
 */
export function rahmenKopfzeilen(roh: string): Kopfzeile[] {
  const urspruenge = erlaubteUrspruenge(roh)
  if (urspruenge.length === 0) {
    return [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }]
  }

  return [
    {
      key: 'Content-Security-Policy',
      value: `frame-ancestors 'self' ${urspruenge.join(' ')}`
    }
  ]
}

export interface CookieOptionen {
  sameSite: 'lax' | 'none'
  secure: boolean
}

/**
 * How the session cookies are written.
 *
 * `None` forces `Secure`, whatever the environment says: a browser simply drops
 * a `SameSite=None` cookie that is not secure. Better a cookie that does not
 * arrive over plain http locally than one that is never set at all — and the
 * failure is then loud rather than mysterious.
 */
export function cookieOptionen(roh: string, produktion: boolean): CookieOptionen {
  if (erlaubteUrspruenge(roh).length === 0) {
    return { sameSite: 'lax', secure: produktion }
  }
  return { sameSite: 'none', secure: true }
}
