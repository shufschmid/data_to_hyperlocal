// Which content-management system built a page — read off the HTML, never off
// the host.
//
// The nine registered municipal sites run four templates, and the newsroom's
// rule is that a rule holds for a KIND of page, never for one municipality.
// So there is no host table: a page is fingerprinted on every read, and a
// page matching none of the four is a loud error on its source row, not an
// empty read. Measured on all nine: the fingerprints never co-occur.

export type Plattform =
  | 'weblication'
  | 'iweb_tabelle'
  | 'iweb_karten'
  | 'backslash'
  | 'weblication_termine'
  | 'iweb_termine'
  | 'backslash_termine'

export type DetailFamilie = 'weblication' | 'iweb' | 'backslash'

/**
 * What a list is ABOUT — and the one thing that really separates the two.
 *
 * A news item is past, an event lies ahead, so the window that keeps the
 * archive out runs the other way. Everything else about the two pages is the
 * same: same host, same manners, same detail pages, same desk.
 */
export type Seitenart = 'nachricht' | 'termin'

const TERMIN_VORLAGEN: ReadonlySet<Plattform> = new Set<Plattform>([
  'weblication_termine',
  'iweb_termine',
  'backslash_termine'
])

export function listenArt(plattform: Plattform): Seitenart {
  return TERMIN_VORLAGEN.has(plattform) ? 'termin' : 'nachricht'
}

/**
 * The events list of the same three CMS families, measured on 18.09.2026 over
 * the ten registered municipalities. Not one events page carries the template
 * of its own news page: the four Weblication sites answer with the same
 * Generator tag but a completely different list (the CMS's `formWork` event
 * index, `#indexUL` with an iCal link per row), and the i-web and Backslash
 * sites are not recognised by the news fingerprints at all. So the events
 * fingerprints are checked FIRST — the Weblication Generator tag would
 * otherwise swallow four of them.
 */
function erkenneTerminliste(html: string): Plattform | null {
  if (
    /\bid=['"]indexUL['"]/i.test(html) &&
    /\bclass=['"][^'"]*\bicalLink\b/i.test(html)
  ) {
    return 'weblication_termine'
  }
  if (
    /\bid="anlassList"/i.test(html) &&
    /data-entity-type="anlass"/i.test(html)
  ) {
    return 'iweb_termine'
  }
  if (/\bclass="[^"]*\bevent-lst\b/i.test(html)) return 'backslash_termine'
  return null
}

export function erkennePlattform(html: string): Plattform | null {
  const termine = erkenneTerminliste(html)
  if (termine !== null) return termine
  if (
    /<table\b[^>]*\bid="informationList"/i.test(html) &&
    /data-webpack-module="datatables"/i.test(html)
  ) {
    return 'iweb_tabelle'
  }
  if (/\bid="newsCardlist"/i.test(html)) return 'iweb_karten'
  if (/\bclass="[^"]*\bmod-news-lst\b/i.test(html)) return 'backslash'
  if (/<meta\s+name="Generator"\s+content="Weblication/i.test(html))
    return 'weblication'
  return null
}

/**
 * The list layouts of one house share its detail-page template — measured on
 * all six events pages: every event links a detail page of the same CMS as the
 * news items, on the same host.
 */
export function detailFamilie(plattform: Plattform): DetailFamilie {
  if (
    plattform === 'iweb_tabelle' ||
    plattform === 'iweb_karten' ||
    plattform === 'iweb_termine'
  ) {
    return 'iweb'
  }
  if (plattform === 'weblication_termine') return 'weblication'
  if (plattform === 'backslash_termine') return 'backslash'
  return plattform
}

/** The family a detail page belongs to, when it has to be told from the page alone. */
export function erkenneDetailFamilie(html: string): DetailFamilie | null {
  if (
    /\bclass="[^"]*\bicms-wysiwyg\b/i.test(html) ||
    /\bclass="[^"]*\bicms-block-container\b/i.test(html)
  ) {
    return 'iweb'
  }
  if (
    /\bclass="[^"]*\bnews-content\b/i.test(html) &&
    /\bclass="[^"]*\bmain__title\b/i.test(html)
  ) {
    return 'backslash'
  }
  if (/<meta\s+name="Generator"\s+content="Weblication/i.test(html))
    return 'weblication'
  return null
}
