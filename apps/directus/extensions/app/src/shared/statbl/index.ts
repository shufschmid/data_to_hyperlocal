import {
  angleicheSpalten,
  GEMEINDE_SPALTE,
  JAHR_SPALTE,
  parseKapitelName,
  parseKinder,
  parseLetzteAenderung,
  parseTabelle,
  parseZweige,
  type StatblTabelle,
  type StatblZeile
} from './parse'

// Fetching a table from statistik.bl.ch.
//
// The fourth outbound host, added deliberately (root CLAUDE.md, constraint 4)
// because the open-data portal does not carry everything the office publishes —
// agriculture has no dataset there at all.
//
// Unlike the agenda host, this one is not behind a bot check: plain HTTP 200,
// no challenge, no robots.txt. So there is no circumvention question here, only
// a politeness one, and the answers are the same as everywhere else: we say who
// we are, we fetch a handful of pages per run, and we never hammer.
//
// Only URLs a person pasted are ever fetched. There is no crawling of this host
// and no discovery — the editor names the table, we read that table.

export {
  parseTabelle,
  parseKinder,
  parseKapitelName,
  parseZweige,
  parseLetzteAenderung,
  angleicheSpalten,
  GEMEINDE_SPALTE,
  JAHR_SPALTE
}
export type { StatblTabelle, StatblZeile }

export const STATBL_HOST = 'statistik.bl.ch'
const BASIS = `https://${STATBL_HOST}/web_portal/`

/** How many earlier editions one run may fetch. */
export const MAX_JAHRE = 14

/**
 * Milliseconds between two requests to this host.
 *
 * The inventory walks thousands of pages, and this host owes us nothing: no
 * robots.txt, no conditional requests, no API. One request per second is the
 * self-restraint that makes walking it defensible at all — it is not a
 * performance setting and should not be tuned down because a run feels slow.
 */
export const PAUSE_MS = 1000

const warte = (ms: number): Promise<void> =>
  new Promise((fertig) => setTimeout(fertig, ms))

export class StatblFehler extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'StatblFehler'
  }
}

/**
 * The table id inside a pasted URL, e.g. "7_1_1_3".
 *
 * Rejects anything that is not a table page on this host. The id then travels
 * as `datensaetze.externe_id` and is rebuilt into a URL here — a stored URL
 * would be a stored redirect target, and this way nothing but a known shape can
 * ever be fetched.
 */
export function tabellenId(eingabe: string): string | null {
  let url: URL
  try {
    url = new URL(eingabe.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null
  if (url.hostname !== STATBL_HOST) return null

  const treffer = /^\/web_portal\/(\d+(?:_\d+)*)\/?$/.exec(url.pathname)
  return treffer === null ? null : (treffer[1] ?? null)
}

export function tabellenUrl(id: string, jahr?: string | null): string {
  const url = new URL(`${BASIS}${id}`)
  if (jahr !== undefined && jahr !== null && jahr !== '') {
    url.searchParams.set('year', jahr)
  }
  return url.toString()
}

export type Holer = (
  url: string
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

const standardHoler: Holer = (url) =>
  fetch(url, {
    headers: {
      // The same honesty as the agenda connector: a name, a purpose, a way to
      // reach us. Never a browser's User-Agent.
      'user-agent': `DieRedaktion/1.0 (Lokalredaktion Bajour; ${KONTAKT}) TabellenLeser`,
      accept: 'text/html'
    },
    redirect: 'follow'
  })

let KONTAKT = 'it@bajour.ch'

/** Set once at startup so the User-Agent names a reachable person. */
export function setzeKontakt(kontakt: string): void {
  KONTAKT = kontakt
}

/**
 * One portal page, raw.
 *
 * Everything that reads this host goes through here, so the throttle cannot be
 * bypassed by accident and the User-Agent is the same everywhere.
 */
export async function ladeSeite(
  pfad: string,
  jahr?: string | null,
  holen: Holer = standardHoler
): Promise<{ url: string; html: string; stand: string | null }> {
  const url = tabellenUrl(pfad, jahr)
  const antwort = await holen(url)

  if (!antwort.ok) {
    throw new StatblFehler(
      `Seite nicht erreichbar (HTTP ${antwort.status}).`,
      url,
      antwort.status
    )
  }

  const html = await antwort.text()

  // Only the real fetcher waits. A test injects its own `Holer`, and making the
  // suite sit through a second per page would be a throttle on us rather than
  // on the host.
  if (holen === standardHoler) await warte(PAUSE_MS)

  return { url, html, stand: parseLetzteAenderung(html) }
}

/** The pages below `pfad`, as the portal itself links them. */
export async function ladeKinder(
  pfad: string,
  holen: Holer = standardHoler
): Promise<{ kinder: string[]; stand: string | null }> {
  const { html, stand } = await ladeSeite(pfad, null, holen)
  return { kinder: parseKinder(html, pfad), stand }
}

export async function ladeTabelle(
  id: string,
  jahr?: string | null,
  holen: Holer = standardHoler
): Promise<StatblTabelle> {
  const { url, html } = await ladeSeite(id, jahr, holen)

  const tabelle = parseTabelle(html)
  if (tabelle === null) {
    throw new StatblFehler('Auf dieser Seite steht keine Gemeindetabelle.', url)
  }

  return tabelle
}

/**
 * The current edition plus every earlier one, as one flat list of records.
 *
 * Serial and bounded: fourteen small pages fetched one after another is a
 * courtesy this host is owed, and it is also the only way the caller can be
 * sure a partial failure did not silently truncate the series — a year that
 * cannot be read is reported, not dropped.
 */
export async function ladeReihe(
  id: string,
  hoechstens = MAX_JAHRE,
  holen: Holer = standardHoler
): Promise<{
  aktuell: StatblTabelle
  zeilen: StatblZeile[]
  uebersprungen: string[]
}> {
  const aktuell = await ladeTabelle(id, null, holen)

  // A wide table carries every year on the one page it already fetched. Asking
  // for `?year=` here would be a request per year for data we are holding.
  if (aktuell.form === 'breit') {
    return { aktuell, zeilen: aktuell.alleZeilen, uebersprungen: [] }
  }

  const zeilen: StatblZeile[] = [...aktuell.zeilen]
  const uebersprungen: string[] = []

  const frueher = aktuell.jahre
    .filter((jahr) => jahr !== aktuell.jahr)
    .slice(0, hoechstens - 1)

  for (const jahr of frueher) {
    try {
      const tabelle = await ladeTabelle(id, jahr, holen)
      const angeglichen = angleicheSpalten(aktuell, tabelle)

      if (angeglichen === null) {
        uebersprungen.push(`${jahr}: andere Spalten als ${aktuell.jahr}`)
        continue
      }

      zeilen.push(...angeglichen)
    } catch (error) {
      uebersprungen.push(
        `${jahr}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  return { aktuell, zeilen, uebersprungen }
}
