import { istErlaubteQuelle } from '../shared/basketplan/parse'

// What the workspace may write into the master data — municipalities and clubs.
//
// Both used to be Directus-admin work. That was defensible while the list never
// changed, and stopped being defensible the moment the newsroom wanted a club
// added on a Saturday and a municipality from another canton on a Monday.
//
// The rules live here rather than in the endpoint so they can be tested without
// a database, and so the endpoint stays what every other one in this file is: a
// door that checks who is knocking and hands the work on.

/** The five Basel-Landschaft districts. Anything else is out of canton. */
const BL_BEZIRKE = new Set([
  'Arlesheim',
  'Laufen',
  'Liestal',
  'Sissach',
  'Waldenburg'
])

/**
 * Whether the statistics feed can ever say anything about this municipality.
 *
 * Not a formality: both portals we read are cantonal, so a municipality outside
 * Basel-Landschaft simply never appears in their rows. It gets sport, waste
 * calendars and the press review like any other — and silence from the
 * statistics side. Riehen has been living that way from the start; saying so on
 * the card beats letting an editor wait for articles that cannot come.
 */
export function istBaselbiet(bezirk: string): boolean {
  return BL_BEZIRKE.has(bezirk.trim())
}

export interface GemeindeEingabe {
  name: string
  bfs_nummer: number
  bezirk: string
  /**
   * The postcodes. Optional, and the one field whose absence is silent rather
   * than loud: the gazette portal indexes half its publications by PLACE (the
   * BFS number) and the other half by ADDRESS — commercial register,
   * bankruptcies, payment orders. Without a postcode that half simply returns
   * nothing, which looks exactly like "nothing was published". The workspace
   * therefore names the municipalities that lack one.
   */
  plz: string[]
}

export type Pruefung<T> = { ok: true; wert: T } | { ok: false; grund: string }

/**
 * A municipality the newsroom adds by hand — Dornach (SO), say.
 *
 * The BFS number is the identity every join in this application uses, so it is
 * required even for a municipality whose figures we will never receive: it is
 * what keeps a later canton-crossing dataset matchable. The name is checked
 * against the existing ones because it is NOT unique in the database, while
 * `gemeindeSlug` in the frontend maps it to the blog's address — two
 * "Oberwil" would quietly share one blog.
 */
export function pruefeGemeinde(
  eingabe: Partial<GemeindeEingabe>,
  vorhandeneNamen: readonly string[]
): Pruefung<GemeindeEingabe> {
  const name = typeof eingabe.name === 'string' ? eingabe.name.trim() : ''
  if (name === '') return { ok: false, grund: 'Der Name fehlt.' }
  if (name.length > 120) {
    return { ok: false, grund: 'Der Name ist laenger als 120 Zeichen.' }
  }

  const bfs = eingabe.bfs_nummer
  if (
    typeof bfs !== 'number' ||
    !Number.isInteger(bfs) ||
    bfs < 1 ||
    bfs > 9999
  ) {
    return {
      ok: false,
      grund: 'Die BFS-Nummer muss eine ganze Zahl zwischen 1 und 9999 sein.'
    }
  }

  const bezirk = typeof eingabe.bezirk === 'string' ? eingabe.bezirk.trim() : ''
  if (bezirk === '') {
    return {
      ok: false,
      grund:
        'Der Bezirk fehlt. Bei ausserkantonalen Gemeinden mit Kuerzel, etwa "Dorneck (SO)".'
    }
  }

  const schonDa = vorhandeneNamen.some(
    (vorhanden) => vorhanden.trim().toLowerCase() === name.toLowerCase()
  )
  if (schonDa) {
    return {
      ok: false,
      grund: `"${name}" gibt es schon. Zwei Gemeinden desselben Namens teilten sich im Blog eine Adresse.`
    }
  }

  const plzRoh = Array.isArray(eingabe.plz) ? eingabe.plz : []
  const plz: string[] = []
  for (const eintrag of plzRoh) {
    const wert = typeof eintrag === 'string' ? eintrag.trim() : ''
    if (wert === '') continue
    if (!/^[1-9]\d{3}$/.test(wert)) {
      return {
        ok: false,
        grund: `"${wert}" ist keine Schweizer Postleitzahl (vier Ziffern).`
      }
    }
    if (!plz.includes(wert)) plz.push(wert)
  }

  return { ok: true, wert: { name, bfs_nummer: bfs, bezirk, plz } }
}

/** The sports a club can be filed under — mirrors the field's own choices. */
export const SPORTARTEN = [
  'Fussball',
  'Handball',
  'Volleyball',
  'Basketball',
  'Unihockey',
  'Eishockey',
  'Schwimmen',
  'Leichtathletik',
  'Turnen',
  'Schach',
  'Schwingen',
  'Anderer'
] as const

export const QUELLEN = [
  'manuell',
  'fvnws',
  'swissvolley',
  'handball',
  'basketball',
  'swissunihockey'
] as const

/** The four that actually have a reader — the rest are recorded, not fetched. */
export const QUELLEN_MIT_KONNEKTOR = new Set([
  'fvnws',
  'swissvolley',
  'handball',
  'basketball'
])

/**
 * Sources whose address is asked for per registered unit, and what it looks
 * like.
 *
 * Volleyball and handball read one page per TEAM. Basketball reads one XML per
 * GROUP — a group carries several of our clubs, so two clubs of one group share
 * the same address. Either way: no address, no results, and the morning run
 * would say so only in a log line nobody reads.
 */
const BRAUCHT_URL: Readonly<Record<string, string>> = {
  swissvolley: 'sie wird pro Mannschaft abgefragt',
  handball: 'sie wird pro Mannschaft abgefragt',
  basketball:
    'sie wird pro Gruppe abgefragt und sieht so aus: ' +
    'https://swiss.basketball/basketplan/showLeagueSchedule.do' +
    '?lang=de&xmlView=rss&leagueId=7&seasonId=31&daysBack=30&daysFuture=120' +
    '&totalGames=500&resultType=big&leagueHoldingId=11329'
}

/**
 * Sources that need the club's id AT THE SOURCE to be usable at all.
 *
 * Basketball is read per group, and a group holds up to a dozen clubs. Without
 * `externe_id` — the team id `showLeagueSchedule.do` prints — nothing says
 * which match belongs to which of our clubs, and the run would store none of
 * them. The other connectors read one address per club and do not need it.
 */
const BRAUCHT_KENNUNG = new Set(['basketball'])

export interface VereinEingabe {
  name: string
  sportart: string
  bedeutung: string
  quelle: string
  ergebnis_url: string | null
  /** The club's (team's) id at the source. Only basketball needs one today. */
  externe_id: string | null
  liga: string | null
  spielort: string | null
  notiz: string | null
  aktiv: boolean
}

/**
 * A club the newsroom records.
 *
 * The one rule with teeth is `ergebnis_url`: volleyball and handball are read
 * one request per team, from exactly that address. Without it the scheduled run
 * skips the club with a log line nobody reads — the club looks registered and
 * stays silent for ever. Football is different: one page carries every club, so
 * the address is only needed to fetch a result the overview page has dropped.
 */
export function pruefeVerein(
  eingabe: Record<string, unknown>
): Pruefung<VereinEingabe> {
  const text = (wert: unknown): string =>
    typeof wert === 'string' ? wert.trim() : ''

  const name = text(eingabe['name'])
  if (name === '') return { ok: false, grund: 'Der Name fehlt.' }

  const sportart = text(eingabe['sportart'])
  if (!(SPORTARTEN as readonly string[]).includes(sportart)) {
    return { ok: false, grund: 'Die Sportart ist unbekannt.' }
  }

  const bedeutung = text(eingabe['bedeutung']) || 'breitensport'
  if (bedeutung !== 'aushaengeschild' && bedeutung !== 'breitensport') {
    return {
      ok: false,
      grund: 'Die Bedeutung muss aushaengeschild oder breitensport sein.'
    }
  }

  const quelle = text(eingabe['quelle']) || 'manuell'
  if (!(QUELLEN as readonly string[]).includes(quelle)) {
    return { ok: false, grund: 'Die Quelle ist unbekannt.' }
  }

  const url = text(eingabe['ergebnis_url'])
  const wozu = BRAUCHT_URL[quelle]
  if (wozu !== undefined && url === '') {
    return {
      ok: false,
      grund: `Fuer die Quelle "${quelle}" wird eine Ergebnis-Adresse gebraucht: ${wozu}.`
    }
  }
  if (url !== '' && !/^https?:\/\//i.test(url)) {
    return {
      ok: false,
      grund: 'Die Ergebnis-Adresse muss mit http:// oder https:// beginnen.'
    }
  }
  // Checked here rather than only in the connector, so a wrong address fails
  // the form instead of failing silently every morning. The original host bars
  // us by robots.txt and `findTeamById.do` carries private contact details —
  // neither is ever fetched.
  if (quelle === 'basketball' && url !== '' && !istErlaubteQuelle(url)) {
    return {
      ok: false,
      grund:
        'Fuer Basketball wird nur der Spielplan von swiss.basketball gelesen ' +
        '(…/basketplan/showLeagueSchedule.do).'
    }
  }

  const kennung = text(eingabe['externe_id'])
  if (BRAUCHT_KENNUNG.has(quelle) && kennung === '') {
    return {
      ok: false,
      grund:
        `Fuer die Quelle "${quelle}" wird die Mannschaftskennung an der Quelle ` +
        'gebraucht (teamId im Spielplan, zum Beispiel 515): eine Gruppe traegt ' +
        'mehrere Vereine.'
    }
  }
  if (kennung.length > 60) {
    return {
      ok: false,
      grund: 'Die Mannschaftskennung ist zu lang (hoechstens 60 Zeichen).'
    }
  }

  return {
    ok: true,
    wert: {
      name,
      sportart,
      bedeutung,
      quelle,
      ergebnis_url: url === '' ? null : url,
      externe_id: kennung === '' ? null : kennung,
      liga: text(eingabe['liga']) || null,
      spielort: text(eingabe['spielort']) || null,
      notiz: text(eingabe['notiz']) || null,
      aktiv: eingabe['aktiv'] === undefined ? true : eingabe['aktiv'] === true
    }
  }
}
