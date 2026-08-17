import { optionalEnv, requireEnv } from '../env'

// The FaaS crawler — the fourth outbound host, and the only one we do not own
// the other end of.
//
// It exists because the Match Center refuses a plain request: `curl` gets 403,
// and the fixture tables are rendered client-side anyway. The crawler runs a
// real browser and hands back Markdown. Swiss Volley's Game Center is the same
// story — its fixtures arrive over React Server Components, so the raw HTML
// contains the club name and nothing else.
//
// This is a rendering service, not a way around a block: we identify ourselves,
// we fetch only pages an editor has registered against a club, and we fetch
// each of them once a day. See the note on politeness in the root CLAUDE.md.

export interface ScrapeErgebnis {
  markdown: string
  /** `httpx` or `playwright` — which path the service took. Useful in logs. */
  renderer: string | null
  statusCode: number | null
}

export class CrawlerFehler extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message)
    this.name = 'CrawlerFehler'
  }
}

interface CrawlerAntwort {
  success?: boolean
  data?: {
    markdown?: string
    metadata?: { renderer?: string; statusCode?: number; status_code?: number }
  }
  error?: string
}

/**
 * Fetches one page as Markdown.
 *
 * `forcePlaywright` is on by default for this project: every page we read is a
 * JavaScript-rendered fixture table, and the cheap path returns navigation
 * without the data — which looks like an empty week rather than a failure.
 */
export async function scrape(
  url: string,
  optionen: {
    forcePlaywright?: boolean
    timeoutMs?: number
    fetchImpl?: typeof fetch
  } = {}
): Promise<ScrapeErgebnis> {
  const basis = requireEnv('CRAWLER_URL').replace(/\/+$/, '')
  const key = requireEnv('CRAWLER_KEY')
  const timeoutMs =
    optionen.timeoutMs ??
    Number.parseInt(optionalEnv('CRAWLER_TIMEOUT_MS', '90000'), 10)
  const holen = optionen.fetchImpl ?? fetch

  const abbruch = new AbortController()
  const wecker = setTimeout(() => abbruch.abort(), timeoutMs)

  try {
    const antwort = await holen(`${basis}/v1/scrape`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        force_playwright: optionen.forcePlaywright ?? true
      }),
      signal: abbruch.signal
    })

    if (!antwort.ok) {
      throw new CrawlerFehler(
        `Crawler antwortete mit HTTP ${antwort.status}.`,
        url
      )
    }

    const körper = (await antwort.json()) as CrawlerAntwort
    const markdown = körper.data?.markdown ?? ''

    // An empty body is a failure wearing a success: swimrankings.net answers
    // this way, and treating it as "no matches this week" would quietly stop
    // the feed instead of reporting a broken source.
    if (markdown.trim() === '') {
      throw new CrawlerFehler('Crawler lieferte eine leere Seite.', url)
    }

    const metadaten = körper.data?.metadata
    return {
      markdown,
      renderer: metadaten?.renderer ?? null,
      statusCode: metadaten?.statusCode ?? metadaten?.status_code ?? null
    }
  } catch (fehler) {
    if (fehler instanceof CrawlerFehler) throw fehler
    if (fehler instanceof Error && fehler.name === 'AbortError') {
      throw new CrawlerFehler(
        `Crawler antwortete nicht innert ${timeoutMs} ms.`,
        url
      )
    }
    throw new CrawlerFehler(
      `Crawler nicht erreichbar: ${fehler instanceof Error ? fehler.message : String(fehler)}`,
      url
    )
  } finally {
    clearTimeout(wecker)
  }
}

/** The page every football club's fixtures come from — one request, all clubs. */
export const WHATS_ON_URL =
  'https://www.fvnws.ch/fussballverband-nordwestschweiz/spielbetrieb-fvnws/meisterschaft-fvnws.aspx'
