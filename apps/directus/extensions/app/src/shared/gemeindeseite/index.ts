// Reads municipal news pages — politely, and only what an editor registered.
//
// Same manners as every other connector, written down once more because the
// hosts are many and small: we identify honestly (`buildUserAgent`), we never
// overlap our own requests, we pause between requests to one host (two
// seconds, or whatever its robots.txt asks for), we read robots.txt once per
// host and run and honour it, we follow redirects only within the same site,
// and a host that is down waits for tomorrow. Nothing is cached on disk.
//
// The network half only. Parsing lives in the pure modules next door.

import { buildUserAgent } from '../agenda'
import { extrahiereText } from '../wochenblatt'
import {
  ANHAENGE_MAX,
  ANHANG_MAX_BYTES,
  type Anhang,
  type AnhangGrund
} from './auswahl'
import type { Heute } from './datum'
import { parseDetail, type DetailInhalt } from './detail'
import {
  erkennePlattform,
  type DetailFamilie,
  type Plattform
} from './erkennung'
import { parseListe, type ListenEintrag } from './liste'
import {
  crawlDelaySekunden,
  darfLesen,
  parseRobots,
  type RobotsRegeln
} from './robots'
import { ANHANG_TEXT_MAX_ZEICHEN, kappe } from './text'
import { gleicheSite, istPdfAdresse, normalisiereUrl } from './url'

export * from './auswahl'
export * from './datum'
export * from './detail'
export * from './erkennung'
export * from './liste'
export * from './robots'
export * from './text'
export * from './url'

export class GemeindeseiteFehler extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message)
    this.name = 'GemeindeseiteFehler'
  }
}

export interface AbrufOptionen {
  kontakt: string
  /** Minimum spacing between two requests to one host. robots.txt can raise it, never lower it. */
  pauseMs?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  jetzt?: () => number
}

export type Seite =
  | { art: 'html'; html: string; url: string }
  | { art: 'pdf'; daten: Buffer; url: string }

export interface GeladenesPdf {
  daten: Buffer
  url: string
  groesse: number
}

export interface Leser {
  /** A page (or the file it turns out to be). `siteVon` is the registered site the URL must belong to. */
  liesSeite(url: string, siteVon: string, maxPdfBytes?: number): Promise<Seite>
  liesPdf(url: string, siteVon: string, maxBytes: number): Promise<GeladenesPdf>
  protokoll(): {
    anfragen: number
    robotsGesperrt: string[]
    /** Hosts that answered 429/503 once — their spacing was raised for the rest of the run. */
    gebremst: string[]
  }
}

export const STANDARD_PAUSE_MS = 2000
export const HTML_MAX_BYTES = 2 * 1024 * 1024
const RETRY_PAUSE_MS = 4000
const PAUSE_DECKEL_MS = 60_000
/** What a host that answered 429 without a Retry-After gets from then on. */
const BREMSE_MIN_MS = 10_000

/**
 * A 429 (or 503) is the host asking for a breath, and the answer is spacing,
 * not persistence: the `Retry-After` it names or `mindestens`, whichever is
 * longer, becomes the pause before one more try AND the host's spacing for the
 * rest of the run.
 * Measured on binningen.ch (15.09.2026): three detail pages in a row at our
 * two-second default were refused with 429 and no Retry-After.
 */
export function retryAfterMs(
  header: string | null,
  mindestens: number
): number {
  const sekunden = header === null ? NaN : Number(header.trim())
  const gewuenscht =
    Number.isFinite(sekunden) && sekunden > 0 ? sekunden * 1000 : 0
  return Math.min(PAUSE_DECKEL_MS, Math.max(mindestens, gewuenscht))
}

/** The spacing a host gets: our default, or its own Crawl-delay when that is longer. */
export function pauseFuerHost(
  pauseMs: number,
  crawlDelaySek: number | null
): number {
  const gewuenscht = crawlDelaySek === null ? 0 : crawlDelaySek * 1000
  return Math.min(PAUSE_DECKEL_MS, Math.max(pauseMs, gewuenscht))
}

type RobotsStand = RobotsRegeln | null | 'unerreichbar'

function zeichensatz(contentType: string): string {
  return /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? 'utf-8'
}

function dekodiere(daten: Buffer, contentType: string): string {
  const cs = zeichensatz(contentType)
  try {
    return new TextDecoder(cs).decode(daten)
  } catch {
    return daten.toString('utf8')
  }
}

function fehlerText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function erstelleLeser(options: AbrufOptionen): Leser {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const jetzt = options.jetzt ?? (() => Date.now())
  const pauseMs = options.pauseMs ?? STANDARD_PAUSE_MS
  const userAgent = buildUserAgent(options.kontakt)

  const robots = new Map<string, Promise<RobotsStand>>()
  const letzterAbruf = new Map<string, number>()
  /** Per host: the spacing a 429/503 imposed, on top of pause and Crawl-delay. */
  const bremse = new Map<string, number>()
  let anfragen = 0
  const robotsGesperrt: string[] = []

  async function warte(url: URL, regeln: RobotsStand): Promise<void> {
    const delay = Math.max(
      pauseFuerHost(
        pauseMs,
        regeln === null || regeln === 'unerreichbar'
          ? null
          : crawlDelaySekunden(regeln)
      ),
      bremse.get(url.host) ?? 0
    )
    const letzter = letzterAbruf.get(url.host)
    if (letzter !== undefined) {
      const seit = jetzt() - letzter
      if (seit < delay) await sleep(delay - seit)
    }
  }

  async function anfrage(
    url: URL,
    accept: string,
    timeoutMs: number
  ): Promise<Response> {
    const init: RequestInit = {
      headers: {
        'User-Agent': userAgent,
        Accept: accept,
        'Accept-Language': 'de-CH,de;q=0.9'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    }
    for (let versuch = 1; ; versuch += 1) {
      anfragen += 1
      letzterAbruf.set(url.host, jetzt())
      try {
        const antwort = await fetchImpl(url.toString(), init)
        if (antwort.status === 429 || antwort.status === 503) {
          const pause = retryAfterMs(
            antwort.headers.get('retry-after'),
            Math.max(BREMSE_MIN_MS, 2 * (bremse.get(url.host) ?? 0))
          )
          bremse.set(url.host, pause)
          if (versuch >= 2) return antwort
          await sleep(pause)
          continue
        }
        // Any other 4xx is an answer; only a server fault or a dead socket earns one more try.
        if (antwort.status < 500 || versuch >= 2) return antwort
      } catch (error) {
        if (versuch >= 2)
          throw new GemeindeseiteFehler(
            `Nicht erreichbar: ${fehlerText(error)}`,
            url.toString()
          )
      }
      await sleep(RETRY_PAUSE_MS)
    }
  }

  function robotsFuer(url: URL): Promise<RobotsStand> {
    const origin = url.origin
    const bekannt = robots.get(origin)
    if (bekannt !== undefined) return bekannt
    const laden = (async (): Promise<RobotsStand> => {
      try {
        const antwort = await anfrage(
          new URL('/robots.txt', origin),
          'text/plain',
          20_000
        )
        if (antwort.ok) return parseRobots(await antwort.text())
        if (antwort.status >= 500) return 'unerreichbar'
        return null
      } catch {
        return 'unerreichbar'
      }
    })()
    robots.set(origin, laden)
    return laden
  }

  async function pruefeZugang(url: URL, siteVon: string): Promise<RobotsStand> {
    if (!gleicheSite(url.hostname, siteVon)) {
      throw new GemeindeseiteFehler(
        `Fremde Site — nur ${siteVon} wird gelesen.`,
        url.toString()
      )
    }
    const regeln = await robotsFuer(url)
    if (regeln === 'unerreichbar') {
      throw new GemeindeseiteFehler(
        `robots.txt von ${url.host} nicht erreichbar — Host in diesem Lauf übersprungen.`,
        url.toString()
      )
    }
    if (regeln !== null && !darfLesen(regeln, `${url.pathname}${url.search}`)) {
      robotsGesperrt.push(url.toString())
      throw new GemeindeseiteFehler(
        `robots.txt von ${url.host} verbietet ${url.pathname}.`,
        url.toString()
      )
    }
    return regeln
  }

  async function geladen(
    url: URL,
    siteVon: string,
    accept: string,
    timeoutMs: number
  ): Promise<Response> {
    const regeln = await pruefeZugang(url, siteVon)
    await warte(url, regeln)
    const antwort = await anfrage(url, accept, timeoutMs)
    const gelandet = new URL(antwort.url || url.toString())
    if (!gleicheSite(gelandet.hostname, siteVon)) {
      throw new GemeindeseiteFehler(
        `Weiterleitung auf fremde Site ${gelandet.host}.`,
        url.toString()
      )
    }
    if (gelandet.pathname !== url.pathname)
      await pruefeZugang(gelandet, siteVon)
    if (!antwort.ok) {
      throw new GemeindeseiteFehler(
        `Seite antwortete mit ${antwort.status}.`,
        url.toString()
      )
    }
    return antwort
  }

  function zuGross(antwort: Response, grenze: number, url: string): void {
    const laenge = Number(antwort.headers.get('content-length') ?? '')
    if (Number.isFinite(laenge) && laenge > grenze) {
      throw new GemeindeseiteFehler(
        `${Math.round(laenge / 1024 / 1024)} MB gross — mehr als die ${Math.round(grenze / 1024 / 1024)}-MB-Grenze.`,
        url
      )
    }
  }

  return {
    async liesSeite(adresse, siteVon, maxPdfBytes = 15 * 1024 * 1024) {
      const url = new URL(adresse)
      const antwort = await geladen(
        url,
        siteVon,
        'text/html,application/xhtml+xml,application/pdf;q=0.8',
        20_000
      )
      const typ = antwort.headers.get('content-type') ?? ''
      const endgueltig = antwort.url || adresse

      if (typ.includes('application/pdf')) {
        zuGross(antwort, maxPdfBytes, adresse)
        const daten = Buffer.from(await antwort.arrayBuffer())
        if (daten.length > maxPdfBytes) {
          throw new GemeindeseiteFehler(
            `PDF ist ${Math.round(daten.length / 1024 / 1024)} MB gross.`,
            adresse
          )
        }
        return { art: 'pdf', daten, url: endgueltig }
      }

      zuGross(antwort, HTML_MAX_BYTES, adresse)
      const daten = Buffer.from(await antwort.arrayBuffer())
      if (daten.subarray(0, 5).toString() === '%PDF-') {
        if (daten.length > maxPdfBytes)
          throw new GemeindeseiteFehler(
            `PDF ist ${Math.round(daten.length / 1024 / 1024)} MB gross.`,
            adresse
          )
        return { art: 'pdf', daten, url: endgueltig }
      }
      if (!/text\/html|application\/xhtml/i.test(typ)) {
        throw new GemeindeseiteFehler(
          `Kein HTML (Content-Type ${typ || 'unbekannt'}).`,
          adresse
        )
      }
      if (daten.length > HTML_MAX_BYTES) {
        throw new GemeindeseiteFehler(
          `Seite ist ${Math.round(daten.length / 1024)} kB gross — mehr als die Grenze.`,
          adresse
        )
      }
      return { art: 'html', html: dekodiere(daten, typ), url: endgueltig }
    },

    async liesPdf(adresse, siteVon, maxBytes) {
      const url = new URL(adresse)
      const antwort = await geladen(
        url,
        siteVon,
        'application/pdf,*/*;q=0.5',
        60_000
      )
      zuGross(antwort, maxBytes, adresse)
      const daten = Buffer.from(await antwort.arrayBuffer())
      const typ = antwort.headers.get('content-type') ?? ''
      const istPdf =
        typ.includes('application/pdf') ||
        daten.subarray(0, 5).toString() === '%PDF-'
      if (!istPdf)
        throw new GemeindeseiteFehler(
          `Kein PDF (Content-Type ${typ || 'unbekannt'}).`,
          adresse
        )
      if (daten.length > maxBytes) {
        throw new GemeindeseiteFehler(
          `PDF ist ${Math.round(daten.length / 1024 / 1024)} MB gross — mehr als die ${Math.round(maxBytes / 1024 / 1024)}-MB-Grenze.`,
          adresse
        )
      }
      return { daten, url: antwort.url || adresse, groesse: daten.length }
    },

    protokoll() {
      return {
        anfragen,
        robotsGesperrt: [...robotsGesperrt],
        gebremst: [...bremse.keys()]
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The two reads the run and the registration form share
// ---------------------------------------------------------------------------

export type PdfText = (
  daten: Buffer
) => Promise<{ text: string; seiten: number }>

/** The text layer of a PDF — unpdf, pure JS, the same call the press review uses. */
export const pdfText: PdfText = async (daten) => {
  const lage = await extrahiereText(daten)
  return { text: lage.text, seiten: lage.seiten }
}

export interface Uebersicht {
  plattform: Plattform
  eintraege: ListenEintrag[]
  /** Where the page actually was after redirects. */
  url: string
}

/**
 * Reads ONE overview page and names its entries. An unrecognised layout or an
 * empty list is a loud error, never "nothing new" — that is the rule the
 * press-review reader set, and the reason a mistyped address fails the
 * registration form instead of becoming a row that errors every day.
 */
export async function leseUebersicht(
  leser: Leser,
  adresse: string,
  heute: Heute
): Promise<Uebersicht> {
  const site = new URL(adresse).hostname
  const seite = await leser.liesSeite(adresse, site)
  if (seite.art !== 'html')
    throw new GemeindeseiteFehler(
      'Die Uebersichtsseite ist kein HTML, sondern ein Dokument.',
      adresse
    )
  const plattform = erkennePlattform(seite.html)
  if (plattform === null) {
    throw new GemeindeseiteFehler(
      'Seitenaufbau nicht erkannt (keine der bekannten Plattformen) — ist das die Newsuebersicht?',
      adresse
    )
  }
  const eintraege = parseListe(seite.html, plattform, seite.url, heute)
  if (eintraege.length === 0) {
    throw new GemeindeseiteFehler(
      'Liste erkannt, aber keine Eintraege gefunden — hat sich der Seitenaufbau geaendert?',
      adresse
    )
  }
  return { plattform, eintraege, url: seite.url }
}

export interface GeleseneMitteilung {
  /** The parsed detail page, or null when the item was a file. */
  detail: DetailInhalt | null
  /** The text layer of a directly linked PDF, or null. */
  pdf: { text: string; seiten: number } | null
  anhaenge: Anhang[]
}

function anhangGrund(error: unknown): AnhangGrund {
  const text = error instanceof Error ? error.message : String(error)
  if (/kein pdf/i.test(text)) return 'kein_pdf'
  if (/gross/i.test(text)) return 'zu_gross'
  if (/robots/i.test(text)) return 'robots'
  return 'nicht_erreichbar'
}

/**
 * Opens ONE item: the detail page (or the file the list linked directly),
 * then the documents the page links — same-site PDFs read up to a cap,
 * everything else listed with the reason it was not read. Every request goes
 * through the same polite reader as the overview.
 */
export async function liesMitteilung(
  leser: Leser,
  eintrag: ListenEintrag,
  familie: DetailFamilie,
  siteVon: string,
  heute: Heute,
  optionen: {
    anhaengeMax?: number
    anhangMaxBytes?: number
    pdfText?: PdfText
  } = {}
): Promise<GeleseneMitteilung> {
  const anhaengeMax = optionen.anhaengeMax ?? ANHAENGE_MAX
  const anhangMaxBytes = optionen.anhangMaxBytes ?? ANHANG_MAX_BYTES
  const liesText = optionen.pdfText ?? pdfText

  const seite = await leser.liesSeite(eintrag.url, siteVon, anhangMaxBytes)
  if (seite.art === 'pdf') {
    return { detail: null, pdf: await liesText(seite.daten), anhaenge: [] }
  }

  const detail = parseDetail(seite.html, familie, seite.url, heute)
  // Where the page named no canonical address but the request landed
  // elsewhere, the landing address is the one a reader opens.
  const gelandet = normalisiereUrl(seite.url, seite.url)
  if (
    detail.kanonisch === null &&
    gelandet !== null &&
    gelandet !== eintrag.url
  )
    detail.kanonisch = gelandet

  const anhaenge: Anhang[] = []
  let versuche = 0
  for (const dokument of detail.dokumente) {
    const basis = { bezeichnung: dokument.bezeichnung, url: dokument.url }
    if (!gleicheSite(dokument.url, siteVon)) {
      anhaenge.push({
        ...basis,
        typ: 'link',
        gelesen: false,
        grund: 'fremde_site'
      })
      continue
    }
    if (!istPdfAdresse(dokument.url) && !/\/_doc\/\d+/.test(dokument.url)) {
      anhaenge.push({
        ...basis,
        typ: 'link',
        gelesen: false,
        grund: 'kein_pdf'
      })
      continue
    }
    if (versuche >= anhaengeMax) {
      anhaenge.push({ ...basis, typ: 'link', gelesen: false, grund: 'deckel' })
      continue
    }
    versuche += 1
    try {
      const geladen = await leser.liesPdf(dokument.url, siteVon, anhangMaxBytes)
      const inhalt = await liesText(geladen.daten)
      const gekappt = kappe(inhalt.text.trim(), ANHANG_TEXT_MAX_ZEICHEN)
      if (gekappt.text === '') {
        anhaenge.push({
          ...basis,
          typ: 'pdf',
          gelesen: false,
          grund: 'kein_text',
          groesse: geladen.groesse,
          seiten: inhalt.seiten
        })
      } else {
        anhaenge.push({
          ...basis,
          typ: 'pdf',
          gelesen: true,
          groesse: geladen.groesse,
          seiten: inhalt.seiten,
          text: gekappt.text,
          abgeschnitten: gekappt.abgeschnitten
        })
      }
    } catch (error) {
      anhaenge.push({
        ...basis,
        typ: 'link',
        gelesen: false,
        grund: anhangGrund(error)
      })
    }
  }

  return { detail, pdf: null, anhaenge }
}
