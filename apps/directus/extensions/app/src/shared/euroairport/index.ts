import { createHash } from 'node:crypto'
import { buildUserAgent } from '../agenda'
import { extrahiereText } from '../wochenblatt'
import {
  EUROAIRPORT_HOST,
  EuroairportFehler,
  parseMonatsblatt,
  parseUebersicht,
  type Ausgabe,
  type Erwartet,
  type Monatsblatt
} from './parse'

// Reading the EuroAirport's ILS-33 statistics — the network half.
//
// Two requests and no more: the overview page once a day, and one PDF for a
// month that is new or whose address has changed. Everything else the newsroom
// already holds. That is the whole traffic this source ever causes, and it is
// why the daily source check can carry it without a Flow of its own.
//
// The host allows it. `robots.txt` (read 17 September 2026) bars `/admin/`,
// `/core/`, `/profiles/`, `/search/`, `/user/…` and the facet parameters —
// neither `/de/publikationen/` nor `/sites/default/files/` is among them.
// There is no bot check: HTTP 200 on the first attempt, as ourselves.
//
// **The text layer does NOT come from `shared/pdf-text.ts`, and that is
// measured rather than preferred.** That module splits every page at
// `pageWidth/2` and reads the left column before the right — the shape of the
// two-column SMD dossiers it was written for. This sheet is one landscape
// table 841.8 pt wide, so the split at 420.9 pt cuts every day line in half:
// `01/08/2026 105 35` on one side, the percentage and the time windows
// somewhere else entirely. Measured on the August 2026 sheet: 31 of 31 day
// lines lost their quota and their Uhrzeit. `extrahiereText` (the press
// review's, reused by the municipal-pages reader) takes pdfjs from the same
// single `unpdf` copy — the one thing `pdf-text.ts` exists to guarantee — and
// returns the table intact. There is a test against the real PDF.

export {
  EUROAIRPORT_BASIS,
  EUROAIRPORT_HOST,
  EuroairportFehler,
  parseMonatsblatt,
  parseUebersicht,
  tagDeutsch
} from './parse'
export type { Ausgabe, Erwartet, Monatsblatt, Tag } from './parse'

/** The German overview page. The French one carries the same table. */
export const ILS33_UEBERSICHT = `https://${EUROAIRPORT_HOST}/de/publikationen/statistiken/ils-33-nutzungsstatistik`

/**
 * Milliseconds between two requests to this host.
 *
 * A run makes one or two of them, so this is not a throttle that ever bites —
 * it is the same self-restraint every other reader here shows, written down so
 * a future change that fetches more months at once inherits it.
 */
export const PAUSE_MS = 1000

/** A month's PDF is one page and about 110 KB; a megabyte is already absurd. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024

const warte = (ms: number): Promise<void> =>
  new Promise((fertig) => setTimeout(fertig, ms))

export interface AbrufOptionen {
  /** The mailbox in the User-Agent — how the airport reaches us. */
  kontakt: string
  /**
   * Handed in by the caller, normally `fetchMitZweiterTuer()`. The door itself
   * decides correctly here without a second thought: the overview is a page
   * and may go through the crawler, a `.pdf` address never does
   * (`fuerZweiteTuer`), which is right — the crawler hands a PDF back as
   * escaped text.
   */
  fetchImpl?: typeof fetch
}

/**
 * Only ever this host.
 *
 * The address of a month comes out of the overview page rather than out of a
 * pattern, so it is data we did not write — and data we did not write is not
 * allowed to send us anywhere. A redirect off the site would do the same, so
 * `redirect: 'follow'` is paired with this check on the way in.
 */
function pruefeAdresse(url: string): void {
  let host: string
  try {
    host = new URL(url).host
  } catch {
    throw new EuroairportFehler(`Keine gueltige Adresse: ${url}`, url)
  }
  if (host !== EUROAIRPORT_HOST) {
    throw new EuroairportFehler(
      `Es wird nur ${EUROAIRPORT_HOST} gelesen, nicht ${host}.`,
      url
    )
  }
}

async function hole(
  url: string,
  optionen: AbrufOptionen,
  accept: string
): Promise<Response> {
  pruefeAdresse(url)
  const fetchImpl = optionen.fetchImpl ?? fetch

  let antwort: Response
  try {
    antwort = await fetchImpl(url, {
      headers: {
        'User-Agent': buildUserAgent(optionen.kontakt),
        Accept: accept,
        'Accept-Language': 'de-CH,de;q=0.9'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000)
    })
  } catch (cause) {
    throw new EuroairportFehler(
      `EuroAirport nicht erreichbar: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      url
    )
  }

  if (!antwort.ok) {
    throw new EuroairportFehler(
      `EuroAirport antwortete mit ${antwort.status}.`,
      url
    )
  }

  return antwort
}

/** The months the overview page currently links, newest year last. */
export async function liesUebersicht(
  url: string,
  optionen: AbrufOptionen
): Promise<Ausgabe[]> {
  const antwort = await hole(url, optionen, 'text/html')
  const ausgaben = parseUebersicht(await antwort.text())
  await warte(PAUSE_MS)
  return ausgaben
}

export interface Monatsabruf {
  blatt: Monatsblatt
  /** The text layer the reading stands on — handed back for the checksum's sake. */
  text: string
  /** sha256 of that text: what says whether a re-upload actually changed anything. */
  pruefsumme: string
}

/**
 * One month's sheet.
 *
 * `erwartet` is the year and month the overview's table cell said, and it is
 * compared against the day lines rather than trusted — the file name is no
 * contract here (see `parse.ts`).
 */
export async function liesMonatsblatt(
  url: string,
  optionen: AbrufOptionen & { erwartet?: Erwartet }
): Promise<Monatsabruf> {
  const antwort = await hole(url, optionen, 'application/pdf')
  const daten = Buffer.from(await antwort.arrayBuffer())

  if (daten.byteLength > MAX_PDF_BYTES) {
    throw new EuroairportFehler(
      `Das Monatsblatt ist ${Math.round(daten.byteLength / 1024)} KB gross — ` +
        'das ist kein einseitiges Statistikblatt mehr.',
      url
    )
  }

  const lage = await extrahiereText(daten)
  const blatt = parseMonatsblatt(lage.text, optionen.erwartet)
  await warte(PAUSE_MS)

  return {
    blatt,
    text: lage.text,
    pruefsumme: createHash('sha256').update(lage.text, 'utf8').digest('hex')
  }
}
