// Fetching the two traffic sheets. Both hosts are already doors of this house:
// the canton's page and its PDF come through the Plone data door
// (`bl-api.webcloud7.ch`, the same one `shared/kanton/` reads — the public
// site sits behind a Cloudflare challenge and is only ever linked), Reinach's
// page and PDFs from the municipality's own website, which the Gemeindeseiten
// desk reads daily anyway. One page request per source and run; a sheet only
// when its address is new.

import { createHash } from 'node:crypto'
import { buildUserAgent } from '../agenda'
import type { KantonLeser } from '../kanton'
import { extrahiereText } from '../wochenblatt'
import {
  monatAusDateiname,
  parseKontrollblatt,
  parseStandortblatt,
  type Kontrollblatt,
  type Standortblatt
} from './parse'

export * from './parse'

export class VerkehrFehler extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message)
    this.name = 'VerkehrFehler'
  }
}

export interface AbrufOptionen {
  /** The mailbox in the User-Agent. */
  kontakt: string
  /** Normally `fetchMitZweiterTuer()`; a `.pdf` address never takes the second door. */
  fetchImpl?: typeof fetch
  /** The one host a request may go to — the source row's own. */
  erlaubterHost: string
}

/** A sheet is one or two pages and about 120 KB. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024
export const PAUSE_MS = 1000

const warte = (ms: number): Promise<void> =>
  new Promise((fertig) => setTimeout(fertig, ms))

function pruefeAdresse(url: string, host: string): void {
  let ziel: URL
  try {
    ziel = new URL(url)
  } catch {
    throw new VerkehrFehler(`Keine gueltige Adresse: ${url}`, url)
  }
  if (ziel.host !== host || ziel.protocol !== 'https:') {
    throw new VerkehrFehler(
      `Es wird nur ${host} gelesen, nicht ${ziel.host}.`,
      url
    )
  }
}

async function hole(
  url: string,
  optionen: AbrufOptionen,
  accept: string
): Promise<Response> {
  pruefeAdresse(url, optionen.erlaubterHost)
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
    throw new VerkehrFehler(
      `${optionen.erlaubterHost} nicht erreichbar: ${cause instanceof Error ? cause.message : String(cause)}`,
      url
    )
  }
  if (!antwort.ok) {
    throw new VerkehrFehler(
      `${optionen.erlaubterHost} antwortete mit ${antwort.status}.`,
      url
    )
  }
  // A redirect onto another site is a "yes" we did not ask for.
  pruefeAdresse(antwort.url === '' ? url : antwort.url, optionen.erlaubterHost)
  return antwort
}

async function holePdf(
  url: string,
  optionen: AbrufOptionen
): Promise<{ text: string; pruefsumme: string }> {
  const antwort = await hole(url, optionen, 'application/pdf')
  const daten = Buffer.from(await antwort.arrayBuffer())
  if (daten.byteLength > MAX_PDF_BYTES) {
    throw new VerkehrFehler(
      `Das Blatt ist ${Math.round(daten.byteLength / 1024)} KB gross — das ist kein Statistikblatt mehr.`,
      url
    )
  }
  if (!daten.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
    throw new VerkehrFehler('Die Antwort ist kein PDF.', url)
  }
  const lage = await extrahiereText(daten)
  await warte(PAUSE_MS)
  return {
    text: lage.text,
    pruefsumme: createHash('sha256').update(lage.text, 'utf8').digest('hex')
  }
}

// ---------------------------------------------------------------------------
// The canton's radar locations
// ---------------------------------------------------------------------------

export interface Standortseite {
  /** The sheet's address as the page links it, query string included. */
  pdfUrl: string | null
  /** The day in the file name — the newest entry's, by the newsroom's reading. */
  publiziertAm: string | null
  /** The page's own `modified` stamp. */
  modified: string | null
}

const HREF_PDF = /href="([^"]+\.pdf(?:\?[^"]*)?)"/gi

function sammleStrings(wert: unknown, ziel: string[], tiefe = 0): void {
  if (tiefe > 12 || wert === null) return
  if (typeof wert === 'string') {
    ziel.push(wert)
    return
  }
  if (Array.isArray(wert)) {
    for (const w of wert) sammleStrings(w, ziel, tiefe + 1)
    return
  }
  if (typeof wert === 'object') {
    for (const w of Object.values(wert as Record<string, unknown>))
      sammleStrings(w, ziel, tiefe + 1)
  }
}

/**
 * The PDF the page links, read out of the page's JSON — the link sits in a
 * text block's HTML, which is why the strings are searched rather than a
 * field read. The first `.pdf` wins; the page carries exactly one (measured
 * 11 October 2026).
 */
export function standortblattLink(seite: unknown): Standortseite {
  const texte: string[] = []
  sammleStrings(seite, texte)
  let pdfUrl: string | null = null
  for (const text of texte) {
    const treffer = HREF_PDF.exec(text)
    HREF_PDF.lastIndex = 0
    if (treffer?.[1] !== undefined) {
      pdfUrl = treffer[1].replace(/&amp;/g, '&')
      break
    }
  }
  const modified =
    typeof seite === 'object' &&
    seite !== null &&
    typeof (seite as { modified?: unknown }).modified === 'string'
      ? (seite as { modified: string }).modified
      : null
  return {
    pdfUrl,
    publiziertAm: pdfUrl === null ? null : publikationstagAus(pdfUrl),
    modified
  }
}

/**
 * «…/20261007_kontrollanlagen-standortmitteilung-1.pdf» → «2026-10-07», and
 * «…/18102026_kontrollanlagenstandortmitteilung.pdf» → «2026-10-18».
 *
 * The police write the day into the file name, but not always the same way
 * round: the sheet of 7 October 2026 was named year-first, the one of 18
 * October day-first — and read year-first that one became «1810-20-26»,
 * which Directus refused, so the run failed on every morning after the
 * upload (measured 19 October 2026). Both orders are tried, and only a
 * figure that is a real calendar day counts; anything else is null, and a
 * row without a publication day is better than no row.
 */
export function publikationstagAus(url: string): string | null {
  const treffer = /\/(\d{8})_[^/]*\.pdf/i.exec(url)
  if (treffer?.[1] === undefined) return null
  const ziffern = treffer[1]
  const jahrZuerst = kalendertag(
    ziffern.slice(0, 4),
    ziffern.slice(4, 6),
    ziffern.slice(6, 8)
  )
  if (jahrZuerst !== null) return jahrZuerst
  return kalendertag(
    ziffern.slice(4, 8),
    ziffern.slice(2, 4),
    ziffern.slice(0, 2)
  )
}

/** `YYYY-MM-DD` when the three parts name a real day of this century, else null. */
function kalendertag(jahr: string, monat: string, tag: string): string | null {
  const j = Number(jahr)
  const m = Number(monat)
  const t = Number(tag)
  if (j < 2000 || j > 2099 || m < 1 || m > 12 || t < 1 || t > 31) return null
  const datum = new Date(Date.UTC(j, m - 1, t))
  if (datum.getUTCMonth() !== m - 1 || datum.getUTCDate() !== t) return null
  return `${jahr}-${monat}-${tag}`
}

/** The address a Plone file answers its bytes under, without the cache-buster. */
export function downloadAdresse(pdfUrl: string): string {
  const ohneAbfrage = pdfUrl.split('?')[0] ?? pdfUrl
  return ohneAbfrage.endsWith('/@@download/file')
    ? ohneAbfrage
    : `${ohneAbfrage}/@@download/file`
}

export async function liesStandortseite(
  leser: KantonLeser,
  url: string
): Promise<Standortseite> {
  return standortblattLink(await leser.liesJson(url))
}

export interface Standortabruf {
  blatt: Standortblatt
  text: string
  pruefsumme: string
}

export async function liesStandortblatt(
  pdfUrl: string,
  optionen: AbrufOptionen
): Promise<Standortabruf> {
  const { text, pruefsumme } = await holePdf(downloadAdresse(pdfUrl), optionen)
  return { blatt: parseStandortblatt(text), text, pruefsumme }
}

// ---------------------------------------------------------------------------
// Reinach's monthly sheets
// ---------------------------------------------------------------------------

export interface Ausgabe {
  jahr: number
  monat: number
  url: string
}

/**
 * The monthly sheets a page links, newest first. Only files whose name
 * carries a month and a year count («009-September-2026.pdf»); the page
 * links other PDFs too (the AED locations), and those are not months.
 */
export function parseKontrollseite(html: string, basisUrl: string): Ausgabe[] {
  const gefunden = new Map<string, Ausgabe>()
  for (const treffer of html.matchAll(HREF_PDF)) {
    const roh = (treffer[1] ?? '').replace(/&amp;/g, '&')
    let url: string
    try {
      url = new URL(roh, basisUrl).toString()
    } catch {
      continue
    }
    const monat = monatAusDateiname(url)
    if (monat === null) continue
    const schluessel = `${monat.jahr}-${monat.monat}`
    if (!gefunden.has(schluessel)) gefunden.set(schluessel, { ...monat, url })
  }
  return [...gefunden.values()].sort(
    (a, b) => b.jahr - a.jahr || b.monat - a.monat
  )
}

export async function liesKontrollseite(
  url: string,
  optionen: AbrufOptionen
): Promise<Ausgabe[]> {
  const antwort = await hole(url, optionen, 'text/html')
  const ausgaben = parseKontrollseite(await antwort.text(), url)
  await warte(PAUSE_MS)
  return ausgaben
}

export interface Kontrollabruf {
  blatt: Kontrollblatt
  text: string
  pruefsumme: string
}

export async function liesKontrollblatt(
  url: string,
  optionen: AbrufOptionen
): Promise<Kontrollabruf> {
  const { text, pruefsumme } = await holePdf(url, optionen)
  return { blatt: parseKontrollblatt(text), text, pruefsumme }
}
