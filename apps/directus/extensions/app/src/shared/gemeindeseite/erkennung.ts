// Which content-management system built a page — read off the HTML, never off
// the host.
//
// The registered municipal sites run seven templates — four for news pages,
// three for event pages — and the newsroom's rule is that a rule holds for a
// KIND of page, never for one municipality. So there is no host table: a page
// is fingerprinted on every read, and a page matching none of the seven is a
// loud error on its source row, not an empty read. Measured on all of them:
// the fingerprints never co-occur. Measured too, and the reason the three
// event templates exist at all: not one municipality's event page carries the
// template of its own news page, though both run on the same CMS.

export type Plattform =
  | 'weblication'
  | 'iweb_tabelle'
  | 'iweb_karten'
  | 'backslash'
  | 'weblication_termine'
  | 'iweb_termine'
  | 'backslash_termine'
  | 'drupal_termine'

export type DetailFamilie = 'weblication' | 'iweb' | 'backslash' | 'drupal'

/**
 * Vorlagen, deren Liste NICHT im HTML steht, sondern hinter einer Datentuer.
 *
 * Riehens Kalender rendert seine Agenda erst im Browser: das rohe HTML traegt
 * null Eintraege. Wer hier nach einer Liste parst, findet fuer immer nichts —
 * darum fragt der Leser fuer diese Vorlagen die Tuer, die die Seite selbst
 * benutzt (`shared/veranstaltung/drupal.ts`).
 */
const TUER_VORLAGEN: ReadonlySet<Plattform> = new Set<Plattform>([
  'drupal_termine'
])

export function ueberDatentuer(plattform: Plattform): boolean {
  return TUER_VORLAGEN.has(plattform)
}

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
  'backslash_termine',
  'drupal_termine'
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
  // Die Agenda dieser Vorlage baut sich erst im Browser; erkennbar ist sie an
  // der Komponente, die ihre eigene Datentuer ruft. Der Fingerabdruck ist die
  // Komponente, nicht der Host — kein Kalender bekommt Code fuer sich. Die
  // Agenda-Seite ruft `componentEventList`, die Kachel auf der Startseite
  // `componentEventCalendar`; beide fragen dieselbe Tuer.
  if (/component(?:EventList|EventCalendar)\s*\(/i.test(html)) {
    return 'drupal_termine'
  }
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
  if (plattform === 'drupal_termine') return 'drupal'
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
