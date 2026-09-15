// Addresses: what counts as the same item, the same site, a document.
//
// The identity of a news item is its normalized list link — known before any
// detail page is fetched, so dedupe never depends on the network. Normalizing
// is deliberately light: scheme and host case, fragment, tracking parameters,
// a trailing slash. Everything else stays byte-identical, because one
// registered page filters its list through a query string (`categories[]=…`)
// and re-encoding it would silently change the address.

function site(hostOderUrl: string): string {
  let host = hostOderUrl.trim().toLowerCase()
  if (/^https?:\/\//.test(host)) {
    try {
      host = new URL(host).hostname
    } catch {
      return host
    }
  }
  return host.replace(/^www\./, '')
}

/** Same site: hosts equal once a leading `www.` is ignored. */
export function gleicheSite(a: string, b: string): boolean {
  const sa = site(a)
  const sb = site(b)
  return sa !== '' && sa === sb
}

const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i

function ohneTracking(search: string): string {
  if (
    search === '' ||
    !/[?&](utm_|fbclid=|gclid=|mc_cid=|mc_eid=)/i.test(search)
  )
    return search
  const teile = search
    .slice(1)
    .split('&')
    .filter((teil) => !TRACKING.test(teil.split('=')[0] ?? ''))
  return teile.length === 0 ? '' : `?${teile.join('&')}`
}

/**
 * An absolute, comparable address — or null for anything that is not a web
 * link (`mailto:`, `javascript:`, a broken href).
 */
export function normalisiereUrl(href: string, basis: string): string | null {
  let url: URL
  try {
    url = new URL(href.trim(), basis)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname.toLowerCase()
  const port =
    url.port === '' || url.port === '80' || url.port === '443'
      ? ''
      : `:${url.port}`
  let pfad = url.pathname
  if (pfad.length > 1 && pfad.endsWith('/')) pfad = pfad.slice(0, -1)

  return `https://${host}${port}${pfad}${ohneTracking(url.search)}`
}

/** Ends in `.pdf`, query string or fragment notwithstanding. */
export function istPdfAdresse(url: string): boolean {
  return /\.pdf(?:[?#]|$)/i.test(url)
}

/** A file worth listing as an attachment: PDF and office formats, or i-web's `/_doc/<id>` door. */
export function istDokumentAdresse(url: string): boolean {
  return (
    /\.(?:pdf|docx?|xlsx?|pptx?)(?:[?#]|$)/i.test(url) ||
    /\/_doc\/\d+/.test(url)
  )
}

/**
 * A link back onto the page itself — print views, anchors, `?page=` variants.
 * Its path starts with the page's own path, so it is never an attachment.
 */
export function istEigeneSeite(link: string, seite: string): boolean {
  try {
    const l = new URL(link)
    const s = new URL(seite)
    if (!gleicheSite(l.hostname, s.hostname)) return false
    const seitenPfad = s.pathname.replace(/\/+$/, '')
    return (
      seitenPfad !== '' && l.pathname.replace(/\/+$/, '').startsWith(seitenPfad)
    )
  } catch {
    return false
  }
}

/** The origin (`https://www.riehen.ch`) a robots.txt is read from. */
export function originVon(url: string): string {
  return new URL(url).origin
}
