import { optionalEnv } from '../env'
import { CrawlerFehler, scrape } from './index'

// The second door.
//
// In this project a refusal is accepted: we come as ourselves, with a contact
// address in the User-Agent, and a host that turns that away is not tricked
// with a faked fingerprint. But wherever possible the same page is ALSO tried
// through we.publish's crawler — a separate product with its own rules and,
// for some sites, its own agreements with the publishers. Those agreements
// are not this project's to lean on or to break; the crawler stays a helper,
// and every page it delivered says so on the row and in the run's result.
// Decided by the newsroom on 17 September 2026, after pratteln.ch answered
// the server with timeouts for two days while the same page loaded from
// anywhere else.
//
// HTML and plain text only. The service hands a PDF back as escaped text
// (measured: "%PDF-1.7 …", capped at 50'000 characters), so documents stay
// direct — and a host that refuses those too leaves a declared gap.

export type Transport = 'direkt' | 'crawler'

/** The header the synthesised Response carries, so a reader built on fetch can tell the doors apart. */
export const TRANSPORT_HEADER = 'x-redaktion-transport'

export function crawlerKonfiguriert(): boolean {
  return (
    optionalEnv('CRAWLER_URL', '') !== '' &&
    optionalEnv('CRAWLER_KEY', '') !== ''
  )
}

/**
 * Which direct outcomes earn the second door: a dead socket or a timeout, a
 * refusal (403), a rate limit that outlasted our own brake (429), a server
 * fault (5xx). Not a 404 or 410 — the page is gone for the crawler too.
 */
export function lohntCrawler(
  ausgang: { status: number } | { fehler: unknown }
): boolean {
  if ('fehler' in ausgang) return true
  const s = ausgang.status
  return s === 403 || s === 429 || s >= 500
}

/**
 * A browser renders a text file as one <pre> in an otherwise empty document,
 * and the crawler hands exactly that back (measured on a robots.txt). Unwrap
 * it, so robots rules read through the second door are the host's own words.
 */
const TEXT_HUELLE =
  /^\s*<html>\s*<head>(?:\s*<meta[^>]*>)*\s*<\/head>\s*<body>\s*<pre[^>]*>([\s\S]*?)<\/pre>\s*<\/body>\s*<\/html>\s*$/i
/** An EMPTY text file renders as an empty document (measured on pratteln.ch's robots.txt). */
const LEERE_HUELLE =
  /^\s*<html>\s*<head>\s*<\/head>\s*<body>\s*<\/body>\s*<\/html>\s*$/i

function ohneEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

export type HtmlAbruf = (url: string) => Promise<Response>

/**
 * The page through the crawler, as a Response — so a reader built around
 * fetch needs no second code path. A text file comes back as text/plain, a
 * page as text/html; a document, an empty body or a truncated page is an
 * error, never a page. The target's own status is passed on, so a host that
 * refuses the crawler too is still a refusal.
 */
export async function holeUeberCrawler(
  url: string,
  optionen: { timeoutMs?: number; scrapeImpl?: typeof scrape } = {}
): Promise<Response> {
  const lesen = optionen.scrapeImpl ?? scrape
  const ergebnis = await lesen(url, {
    formats: ['html'],
    forcePlaywright: false,
    ...(optionen.timeoutMs === undefined
      ? {}
      : { timeoutMs: optionen.timeoutMs })
  })
  const html = ergebnis.html ?? ''
  if (html.trim() === '') {
    throw new CrawlerFehler('Crawler lieferte kein HTML.', url)
  }
  if (/^\s*%PDF-/.test(html)) {
    throw new CrawlerFehler(
      'Dokument statt Seite — Dateien gehen nicht über den Crawler.',
      url
    )
  }
  if (ergebnis.abgeschnitten) {
    throw new CrawlerFehler('Crawler hat die Seite gekürzt.', url)
  }
  const text = LEERE_HUELLE.test(html) ? [html, ''] : TEXT_HUELLE.exec(html)
  const status =
    ergebnis.statusCode !== null &&
    ergebnis.statusCode >= 200 &&
    ergebnis.statusCode < 600
      ? ergebnis.statusCode
      : 200
  return new Response(text === null ? html : ohneEntities(text[1] ?? ''), {
    status,
    headers: {
      'content-type':
        text === null
          ? 'text/html; charset=utf-8'
          : 'text/plain; charset=utf-8',
      [TRANSPORT_HEADER]: 'crawler'
    }
  })
}

// ---------------------------------------------------------------------------
// The door for readers built on fetch
// ---------------------------------------------------------------------------

/** The process-wide record of the second door: which host, when. Read per run by its window. */
const NUTZUNG_MAX = 500
const nutzung: { host: string; um: number }[] = []

export function merkeZweiteTuer(host: string, um = Date.now()): void {
  nutzung.push({ host, um })
  if (nutzung.length > NUTZUNG_MAX)
    nutzung.splice(0, nutzung.length - NUTZUNG_MAX)
}

/**
 * Hosts the second door delivered since `seit` (ms since epoch) — a run notes
 * its start and reads this at its end, so its result declares them. Two runs
 * overlapping may both name a host; that is a harmless surplus, not a gap.
 */
export function zweiteTuerSeit(seit: number): string[] {
  return [...new Set(nutzung.filter((n) => n.um >= seit).map((n) => n.host))]
}

/** For tests: forget the record. */
export function vergissZweiteTuer(): void {
  nutzung.length = 0
}

/** Documents, images and data files by their address — the crawler renders pages, nothing else. */
const DOKUMENT_PFAD =
  /\.(pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|gif|webp|svg|mp3|mp4|xml|json|csv)$/i
/** Data and binaries by what the caller asked for. */
const NICHT_SEITE =
  /^(application\/(json|xml|pdf|octet-stream)|text\/xml|image\/|audio\/|video\/)/

function kopfzeile(init: RequestInit | undefined, name: string): string {
  const h = init?.headers
  if (h === undefined) return ''
  if (h instanceof Headers) return h.get(name) ?? ''
  if (Array.isArray(h))
    return h.find(([k]) => k.toLowerCase() === name)?.[1] ?? ''
  return Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1] ?? ''
}

/**
 * Whether a request is one the second door is for: a GET for a page or a text
 * file. A document address, a data API, an image — the crawler would hand
 * back escaped bytes or wrapped JSON, so those stay direct and fail honestly.
 */
export function fuerZweiteTuer(url: string, init?: RequestInit): boolean {
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return false
  let pfad: string
  try {
    pfad = new URL(url).pathname
  } catch {
    return false
  }
  if (DOKUMENT_PFAD.test(pfad)) return false
  const erster =
    kopfzeile(init, 'accept').split(',')[0]?.trim().toLowerCase() ?? ''
  return !NICHT_SEITE.test(erster)
}

/**
 * A fetch with the second door built in, for every reader that takes a
 * `fetchImpl`: the agenda, statistik.bl, the Wochenblatt archives, the
 * Amtsblatt's plan pages, telebasel. Direct first, as ourselves; where the
 * host turns it away (`lohntCrawler`) and the request is for a page
 * (`fuerZweiteTuer`), the same address through the crawler. The Response
 * says which door (`TRANSPORT_HEADER`) and the delivery is recorded
 * (`zweiteTuerSeit`). When the crawler fails too, the direct outcome stands:
 * the caller sees the status it would have seen, or the direct error with
 * the crawler's reason appended — so a refusal is still a refusal, named.
 */
export function fetchMitZweiterTuer(
  optionen: { direkt?: typeof fetch; crawler?: HtmlAbruf | null } = {}
): typeof fetch {
  const direkt = optionen.direkt ?? fetch
  const crawler =
    optionen.crawler === undefined
      ? crawlerKonfiguriert()
        ? holeUeberCrawler
        : null
      : optionen.crawler
  const tuer = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    let antwort: Response | null = null
    let direkterFehler: unknown = null
    try {
      antwort = await direkt(input, init)
    } catch (error) {
      direkterFehler = error
    }
    const abgewiesen =
      antwort === null ? true : lohntCrawler({ status: antwort.status })
    if (crawler === null || !abgewiesen || !fuerZweiteTuer(url, init)) {
      if (antwort !== null) return antwort
      throw direkterFehler
    }
    try {
      const ueber = await crawler(url)
      merkeZweiteTuer(new URL(url).host)
      return ueber
    } catch (crawlerFehler) {
      if (antwort !== null) return antwort
      const direktText =
        direkterFehler instanceof Error
          ? direkterFehler.message
          : String(direkterFehler)
      const crawlerText =
        crawlerFehler instanceof Error
          ? crawlerFehler.message
          : String(crawlerFehler)
      throw new Error(
        `${direktText} — auch über den Crawler nicht: ${crawlerText}`
      )
    }
  }
  return tuer as typeof fetch
}
