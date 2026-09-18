import { describe, expect, it, vi } from 'vitest'
import {
  erstelleLeser,
  GemeindeseiteFehler,
  leseUebersicht,
  liesMitteilung,
  pauseFuerHost,
  retryAfterMs
} from './index'

interface Antwort {
  body?: string | Buffer
  status?: number
  headers?: Record<string, string>
  url?: string
}

/** A Response-shaped object — `Response.url` is read-only, and the redirect tests need to set it. */
function antwort({
  body = '',
  status = 200,
  headers = {},
  url = ''
}: Antwort): Response {
  const daten = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
  const kopf = new Headers({
    'content-type': 'text/html; charset=utf-8',
    ...headers
  })
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: kopf,
    arrayBuffer: async () =>
      daten.buffer.slice(daten.byteOffset, daten.byteOffset + daten.byteLength),
    text: async () => daten.toString('utf8')
  } as unknown as Response
}

interface Stub {
  fetchImpl: typeof fetch
  aufrufe: { url: string; headers: Record<string, string> }[]
}

function stubFetch(
  antworten: Record<string, Antwort | Antwort[] | ((n: number) => Antwort)>
): Stub {
  const aufrufe: Stub['aufrufe'] = []
  const zaehler = new Map<string, number>()
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = typeof input === 'string' ? input : input.toString()
    aufrufe.push({
      url,
      headers: (init?.headers as Record<string, string>) ?? {}
    })
    const n = zaehler.get(url) ?? 0
    zaehler.set(url, n + 1)
    const plan = antworten[url]
    if (plan === undefined) throw new Error(`unexpected fetch: ${url}`)
    if (typeof plan === 'function') return antwort(plan(n))
    if (Array.isArray(plan))
      return antwort(plan[Math.min(n, plan.length - 1)] ?? {})
    return antwort(plan)
  }) as typeof fetch
  return { fetchImpl, aufrufe }
}

const ROBOTS = 'https://www.example.ch/robots.txt'
const SEITE = 'https://www.example.ch/aktuelles'
const SEITE2 = 'https://www.example.ch/aktuelles/zwei.php'

function leser(
  stub: Stub,
  extra: {
    pauseMs?: number
    crawler?: ((url: string) => Promise<Response>) | null
  } = {}
) {
  const sleep = vi
    .fn<(ms: number) => Promise<void>>()
    .mockResolvedValue(undefined)
  const l = erstelleLeser({
    kontakt: 'it@bajour.ch',
    fetchImpl: stub.fetchImpl,
    sleep,
    jetzt: () => 1000,
    ...extra
  })
  return { l, sleep }
}

describe('pauseFuerHost', () => {
  it('nimmt das Laengere von eigener Pause und Crawl-delay, gedeckelt bei einer Minute', () => {
    expect(pauseFuerHost(2000, null)).toBe(2000)
    expect(pauseFuerHost(2000, 10)).toBe(10_000)
    expect(pauseFuerHost(2000, 1)).toBe(2000)
    expect(pauseFuerHost(2000, 600)).toBe(60_000)
  })
})

describe('erstelleLeser', () => {
  it('liest robots.txt einmal je Host, identifiziert sich und wartet zwischen zwei Abrufen', async () => {
    const stub = stubFetch({
      [ROBOTS]: {
        body: 'User-agent: *\nDisallow: /intern/',
        headers: { 'content-type': 'text/plain' }
      },
      [SEITE]: { body: '<html>eins</html>' },
      [SEITE2]: { body: '<html>zwei</html>' }
    })
    const { l, sleep } = leser(stub)

    const eins = await l.liesSeite(SEITE, 'example.ch')
    const zwei = await l.liesSeite(SEITE2, 'example.ch')

    expect(eins).toEqual({
      art: 'html',
      html: '<html>eins</html>',
      url: SEITE,
      transport: 'direkt'
    })
    expect(zwei.art).toBe('html')
    expect(stub.aufrufe.map((a) => a.url)).toEqual([ROBOTS, SEITE, SEITE2])
    expect(stub.aufrufe[1]?.headers['User-Agent']).toContain('it@bajour.ch')
    expect(stub.aufrufe[1]?.headers['User-Agent']).not.toContain('Mozilla')
    // The clock stands still, so every request after the first waits the full pause.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 2000])
    expect(l.protokoll().anfragen).toBe(3)
  })

  it('haelt den Crawl-delay des Hosts ein', async () => {
    const stub = stubFetch({
      [ROBOTS]: {
        body: 'User-agent: *\ncrawl-delay: 10',
        headers: { 'content-type': 'text/plain' }
      },
      [SEITE]: { body: '<html/>' }
    })
    const { l, sleep } = leser(stub)
    await l.liesSeite(SEITE, 'example.ch')
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10_000])
  })

  it('holt einen von robots.txt gesperrten Pfad nie und sagt warum', async () => {
    const stub = stubFetch({
      [ROBOTS]: {
        body: 'User-agent: *\nDisallow: /aktuelles',
        headers: { 'content-type': 'text/plain' }
      }
    })
    const { l } = leser(stub)
    await expect(l.liesSeite(SEITE, 'example.ch')).rejects.toThrow(
      /robots\.txt von www\.example\.ch verbietet/
    )
    expect(stub.aufrufe.map((a) => a.url)).toEqual([ROBOTS])
    expect(l.protokoll().robotsGesperrt).toEqual([SEITE])
  })

  it('ohne robots.txt (404) gibt es keine Regeln; bei 5xx wird der Host uebersprungen', async () => {
    const ohne = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: { body: '<html/>' }
    })
    await expect(
      leser(ohne).l.liesSeite(SEITE, 'example.ch')
    ).resolves.toMatchObject({ art: 'html' })

    const kaputt = stubFetch({ [ROBOTS]: { status: 503 } })
    await expect(
      leser(kaputt).l.liesSeite(SEITE, 'example.ch')
    ).rejects.toThrow(/robots\.txt von www\.example\.ch nicht erreichbar/)
  })

  it('verweigert fremde Sites — vor dem Abruf und nach einer Weiterleitung', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: { body: '<html/>', url: 'https://www.fremd.ch/irgendwo' }
    })
    const { l } = leser(stub)
    await expect(
      l.liesSeite('https://www.fremd.ch/x', 'example.ch')
    ).rejects.toThrow(/Fremde Site/)
    await expect(l.liesSeite(SEITE, 'example.ch')).rejects.toThrow(
      /Weiterleitung auf fremde Site www\.fremd\.ch/
    )
    expect(stub.aufrufe.some((a) => a.url === 'https://www.fremd.ch/x')).toBe(
      false
    )
  })

  it('versucht es bei einem Serverfehler genau einmal mehr, bei 404 nicht', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: [{ status: 502 }, { body: '<html>da</html>' }],
      [SEITE2]: { status: 404 }
    })
    const { l, sleep } = leser(stub)
    await expect(l.liesSeite(SEITE, 'example.ch')).resolves.toMatchObject({
      html: '<html>da</html>'
    })
    expect(stub.aufrufe.filter((a) => a.url === SEITE)).toHaveLength(2)
    expect(sleep.mock.calls.some((c) => c[0] === 4000)).toBe(true)

    await expect(l.liesSeite(SEITE2, 'example.ch')).rejects.toThrow(
      /antwortete mit 404/
    )
    expect(stub.aufrufe.filter((a) => a.url === SEITE2)).toHaveLength(1)
  })

  it('ein 429 ist eine Bitte um Abstand: Retry-After abwarten, einmal wiederholen, den Host danach so weit auseinander halten', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: [
        { status: 429, headers: { 'retry-after': '30' } },
        { body: '<html>da</html>' }
      ],
      [SEITE2]: { body: '<html>zwei</html>' }
    })
    const { l, sleep } = leser(stub)
    await expect(l.liesSeite(SEITE, 'example.ch')).resolves.toMatchObject({
      html: '<html>da</html>'
    })
    expect(stub.aufrufe.filter((a) => a.url === SEITE)).toHaveLength(2)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 30_000])

    sleep.mockClear()
    await l.liesSeite(SEITE2, 'example.ch')
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([30_000])
    expect(l.protokoll().gebremst).toEqual(['www.example.ch'])
  })

  it('ohne Retry-After sind es zehn Sekunden, und ein zweites 429 ist ein Fehler', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: { status: 429 }
    })
    const { l, sleep } = leser(stub)
    await expect(l.liesSeite(SEITE, 'example.ch')).rejects.toThrow(
      /antwortete mit 429/
    )
    expect(stub.aufrufe.filter((a) => a.url === SEITE)).toHaveLength(2)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 10_000])
    expect(l.protokoll().gebremst).toEqual(['www.example.ch'])
  })

  it('dekodiert nach dem Zeichensatz der Antwort', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: {
        body: Buffer.from([0x5a, 0xfc, 0x72, 0x69, 0x63, 0x68]),
        headers: { 'content-type': 'text/html; charset=iso-8859-1' }
      }
    })
    const seite = await leser(stub).l.liesSeite(SEITE, 'example.ch')
    expect(seite).toMatchObject({ art: 'html', html: 'Zürich' })
  })

  it('erkennt ein PDF hinter einer Seitenadresse am Inhalt, nicht nur am Content-Type', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: {
        body: '%PDF-1.4 …',
        headers: { 'content-type': 'application/octet-stream' }
      },
      [SEITE2]: { body: 'kein HTML', headers: { 'content-type': 'text/plain' } }
    })
    const { l } = leser(stub)
    const pdf = await l.liesSeite(SEITE, 'example.ch')
    expect(pdf.art).toBe('pdf')
    await expect(l.liesSeite(SEITE2, 'example.ch')).rejects.toThrow(
      /Kein HTML \(Content-Type text\/plain\)/
    )
  })

  it('bricht ein zu grosses PDF am Content-Length ab, ohne es zu laden', async () => {
    const gross = 'https://www.example.ch/gross.pdf'
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [gross]: {
        body: '%PDF-',
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(40 * 1024 * 1024)
        }
      }
    })
    const { l } = leser(stub)
    await expect(
      l.liesPdf(gross, 'example.ch', 15 * 1024 * 1024)
    ).rejects.toThrow(/40 MB gross/)
  })

  it('liesPdf verlangt ein PDF und liefert Bytes, Adresse und Groesse', async () => {
    const pdf = 'https://www.example.ch/a.pdf'
    const html = 'https://www.example.ch/b.pdf'
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [pdf]: {
        body: '%PDF-1.7 inhalt',
        headers: { 'content-type': 'application/pdf' }
      },
      [html]: { body: '<html>Login</html>' }
    })
    const { l } = leser(stub)
    const geladen = await l.liesPdf(pdf, 'example.ch', 1024)
    expect(geladen.groesse).toBe(15)
    expect(geladen.daten.subarray(0, 5).toString()).toBe('%PDF-')
    await expect(l.liesPdf(html, 'example.ch', 1024)).rejects.toThrow(
      GemeindeseiteFehler
    )
  })
})

describe('leseUebersicht', () => {
  const BACKSLASH =
    '<html><body><ul class="mod-news-lst"><li class="mod-entry"><p class="mod-entry-meta"><time datetime="2026-09-10 07:55">10. September 2026</time></p>' +
    '<h2 class="mod-entry-title"><a href="https://www.example.ch/de/news.html/106/news/1">Erster</a></h2><p class="mod-entry-desc">Anriss</p></li></ul></body></html>'
  const heute = { jahr: 2026, monat: 9, tag: 14 }

  it('erkennt die Plattform und liefert die Eintraege', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: { body: BACKSLASH }
    })
    const uebersicht = await leseUebersicht(leser(stub).l, SEITE, heute)
    expect(uebersicht.plattform).toBe('backslash')
    expect(uebersicht.eintraege).toHaveLength(1)
    expect(uebersicht.eintraege[0]).toMatchObject({
      titel: 'Erster',
      datum: '2026-09-10',
      teaser: 'Anriss'
    })
  })

  // The registration form is where a swapped address has to fail: both pages
  // sit on the same host and both are read by the same run, so an events list
  // in the news field would otherwise look like a page that simply never has
  // anything recent.
  it('weist eine Terminliste ab, wo eine Nachrichtenliste erwartet wird', async () => {
    const TERMINE =
      '<html><body><ul id="indexUL"><li class="  indexLI"><span class="listEntryDate">20.10.2026 | 18:00 Uhr</span>' +
      '<br/><a href="/de/veranstaltungen/detail.php?i=1"><b>Einwohnerratssitzung</b></a>' +
      '<a class="icalLink" href="/de/veranstaltungen/ical.php?i=1">i</a></li></ul></body></html>'
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: { body: TERMINE }
    })
    const { l } = leser(stub)
    await expect(leseUebersicht(l, SEITE, heute, 'nachricht')).rejects.toThrow(
      /Veranstaltungsuebersicht/
    )
    const uebersicht = await leseUebersicht(l, SEITE, heute, 'termin')
    expect(uebersicht.plattform).toBe('weblication_termine')
    expect(uebersicht.eintraege[0]).toMatchObject({
      titel: 'Einwohnerratssitzung',
      veranstaltungAm: '2026-10-20',
      datum: null
    })
  })

  it('weist umgekehrt eine Nachrichtenliste ab, wo Termine erwartet werden', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: { body: BACKSLASH }
    })
    await expect(
      leseUebersicht(leser(stub).l, SEITE, heute, 'termin')
    ).rejects.toThrow(/Newsuebersicht/)
  })

  it('eine unbekannte Vorlage und eine leere Liste sind laute Fehler, nie "nichts Neues"', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: { body: '<html><body><p>Willkommen</p></body></html>' },
      [SEITE2]: {
        body: '<html><head><meta name="Generator" content="Weblication® CMS"/></head><body></body></html>'
      }
    })
    const { l } = leser(stub)
    await expect(leseUebersicht(l, SEITE, heute)).rejects.toThrow(
      /Seitenaufbau nicht erkannt/
    )
    await expect(leseUebersicht(l, SEITE2, heute)).rejects.toThrow(
      /keine Eintraege gefunden/
    )
  })
})

describe('liesMitteilung', () => {
  const heute = { jahr: 2026, monat: 9, tag: 14 }
  const DETAIL = 'https://www.example.ch/de/news.html/106/news/1'
  const seite = (dokumente: string): string =>
    `<html><head><link rel="canonical" href="${DETAIL}"></head><body><main><h1 class="main__title">Titel</h1>` +
    `<p class="mod-entry-meta"><time datetime="2026-09-10 07:55">10. September 2026</time></p><h3 class="lead">Lead.</h3>` +
    `<div class="news-content"><p>Text der Mitteilung.</p>${dokumente}</div></main></body></html>`
  const eintrag = {
    url: DETAIL,
    titel: 'Titel',
    teaser: null,
    datum: '2026-09-10',
    datumQuelle: 'liste' as const,
    kategorie: null,
    direktPdf: false,
    veranstaltungAm: null
  }
  const pdfText = async (daten: Buffer) => ({
    text: `Inhalt von ${daten.toString('utf8').replace('%PDF-', '')}`,
    seiten: 1
  })

  it('liest die Detailseite und die eigenen PDFs, listet Fremdes und Nicht-PDFs mit Grund, deckelt', async () => {
    const dokumente =
      '<p><a href="/docs/a.pdf">A</a></p><p><a href="https://www.bl.ch/mm.pdf">Kanton</a></p><p><a href="/docs/b.docx">Word</a></p>' +
      '<p><a href="/docs/c.pdf">C</a></p><p><a href="/docs/d.pdf">D</a></p>'
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [DETAIL]: { body: seite(dokumente) },
      'https://www.example.ch/docs/a.pdf': {
        body: '%PDF-A',
        headers: { 'content-type': 'application/pdf' }
      },
      'https://www.example.ch/docs/c.pdf': { status: 503 }
    })
    const gelesen = await liesMitteilung(
      leser(stub).l,
      eintrag,
      'backslash',
      'example.ch',
      heute,
      { anhaengeMax: 2, pdfText }
    )
    expect(gelesen.pdf).toBeNull()
    expect(gelesen.detail?.titel).toBe('Titel')
    expect(gelesen.detail?.text).toBe(
      'Text der Mitteilung.\n\nA\n\nKanton\n\nWord\n\nC\n\nD'
    )
    expect(gelesen.anhaenge).toEqual([
      {
        bezeichnung: 'A',
        url: 'https://www.example.ch/docs/a.pdf',
        typ: 'pdf',
        gelesen: true,
        groesse: 6,
        seiten: 1,
        text: 'Inhalt von A',
        abgeschnitten: false
      },
      {
        bezeichnung: 'Kanton',
        url: 'https://www.bl.ch/mm.pdf',
        typ: 'link',
        gelesen: false,
        grund: 'fremde_site'
      },
      {
        bezeichnung: 'Word',
        url: 'https://www.example.ch/docs/b.docx',
        typ: 'link',
        gelesen: false,
        grund: 'kein_pdf'
      },
      {
        bezeichnung: 'C',
        url: 'https://www.example.ch/docs/c.pdf',
        typ: 'link',
        gelesen: false,
        grund: 'nicht_erreichbar'
      },
      {
        bezeichnung: 'D',
        url: 'https://www.example.ch/docs/d.pdf',
        typ: 'link',
        gelesen: false,
        grund: 'deckel'
      }
    ])
    // The foreign host was never asked.
    expect(stub.aufrufe.some((a) => a.url.includes('bl.ch'))).toBe(false)
  })

  it('ein direkt verlinktes PDF ist die Mitteilung selbst', async () => {
    const pdfUrl = 'https://www.example.ch/docs/mm.pdf'
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [pdfUrl]: {
        body: '%PDF-Medienmitteilung',
        headers: { 'content-type': 'application/pdf' }
      }
    })
    const gelesen = await liesMitteilung(
      leser(stub).l,
      { ...eintrag, url: pdfUrl, direktPdf: true },
      'weblication',
      'example.ch',
      heute,
      { pdfText }
    )
    expect(gelesen).toEqual({
      detail: null,
      pdf: { text: 'Inhalt von Medienmitteilung', seiten: 1 },
      anhaenge: [],
      transport: 'direkt'
    })
  })

  it('nimmt die Landeadresse als kanonisch, wenn die Seite keine nennt', async () => {
    const start = 'https://www.example.ch/_rte/information/1'
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [start]: {
        body: '<html><body><main><div class="news-content"><p>Text.</p></div><h1 class="main__title">T</h1></main></body></html>',
        url: 'https://www.example.ch/aktuellesinformationen/1'
      }
    })
    const gelesen = await liesMitteilung(
      leser(stub).l,
      { ...eintrag, url: start },
      'backslash',
      'example.ch',
      heute,
      { pdfText }
    )
    expect(gelesen.detail?.kanonisch).toBe(
      'https://www.example.ch/aktuellesinformationen/1'
    )
  })
})

describe('retryAfterMs', () => {
  it('nimmt das Laengere von Wunsch des Hosts und Mindestpause, gedeckelt bei einer Minute', () => {
    expect(retryAfterMs('7', 10_000)).toBe(10_000)
    expect(retryAfterMs('30', 10_000)).toBe(30_000)
    expect(retryAfterMs('600', 10_000)).toBe(60_000)
    expect(retryAfterMs(null, 10_000)).toBe(10_000)
    expect(retryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT', 10_000)).toBe(10_000)
  })
})

describe('die zweite Tuer', () => {
  const PDF = 'https://www.example.ch/dok.pdf'
  const crawlerSeite = (html: string, status = 200) =>
    new Response(html, {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-redaktion-transport': 'crawler'
      }
    })

  it('nach einem Timeout kommt dieselbe Seite ueber den Crawler — gekennzeichnet und protokolliert', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: () => {
        throw new Error('The operation was aborted due to timeout')
      }
    })
    const crawler = vi.fn(async () =>
      crawlerSeite('<html>ueber die zweite Tuer</html>')
    )
    const { l } = leser(stub, { crawler })
    await expect(l.liesSeite(SEITE, 'example.ch')).resolves.toMatchObject({
      art: 'html',
      html: '<html>ueber die zweite Tuer</html>',
      transport: 'crawler'
    })
    expect(stub.aufrufe.filter((a) => a.url === SEITE)).toHaveLength(2)
    expect(crawler).toHaveBeenCalledWith(SEITE)
    expect(l.protokoll().ueberCrawler).toEqual(['www.example.ch'])
  })

  it('403 geht durch die zweite Tuer, 404 nicht', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: { status: 403 },
      [SEITE2]: { status: 404 }
    })
    const crawler = vi.fn(async () => crawlerSeite('<html>da</html>'))
    const { l } = leser(stub, { crawler })
    await expect(l.liesSeite(SEITE, 'example.ch')).resolves.toMatchObject({
      transport: 'crawler'
    })
    await expect(l.liesSeite(SEITE2, 'example.ch')).rejects.toThrow(
      /antwortete mit 404\./
    )
    expect(crawler).toHaveBeenCalledTimes(1)
  })

  it('ein Dokument geht nie ueber den Crawler', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [PDF]: { status: 403 }
    })
    const crawler = vi.fn(async () => crawlerSeite('<html>nein</html>'))
    const { l } = leser(stub, { crawler })
    await expect(l.liesPdf(PDF, 'example.ch', 1_000_000)).rejects.toThrow(
      /antwortete mit 403/
    )
    expect(crawler).not.toHaveBeenCalled()
  })

  it('scheitern beide Tueren, nennt der Fehler beide; weist auch der Crawler ab, bleibt es eine Abweisung', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: { status: 503 },
      [SEITE2]: { status: 403 }
    })
    const crawler = vi
      .fn<(url: string) => Promise<Response>>()
      .mockRejectedValueOnce(new Error('Crawler antwortete mit HTTP 502.'))
      .mockResolvedValueOnce(crawlerSeite('<html>weg</html>', 403))
    const { l } = leser(stub, { crawler })
    await expect(l.liesSeite(SEITE, 'example.ch')).rejects.toThrow(
      /Direkt: Seite antwortete mit 503; über den Crawler: Crawler antwortete mit HTTP 502/
    )
    await expect(l.liesSeite(SEITE2, 'example.ch')).rejects.toThrow(
      /antwortete mit 403 — direkt und über den Crawler/
    )
  })

  it('auch die robots.txt kommt notfalls ueber den Crawler — und gilt dann', async () => {
    const stub = stubFetch({
      [ROBOTS]: () => {
        throw new Error('ECONNRESET')
      },
      [SEITE]: { body: '<html>da</html>' }
    })
    const crawler = vi.fn(
      async () =>
        new Response('User-agent: *\nDisallow: /aktuelles\n', {
          status: 200,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'x-redaktion-transport': 'crawler'
          }
        })
    )
    const { l } = leser(stub, { crawler })
    await expect(l.liesSeite(SEITE, 'example.ch')).rejects.toThrow(
      /robots.txt von www.example.ch verbietet/
    )
    expect(crawler).toHaveBeenCalledWith(ROBOTS)
  })

  it('ohne Crawler bleibt es beim direkten Weg', async () => {
    const stub = stubFetch({
      [ROBOTS]: { status: 404 },
      [SEITE]: { status: 403 }
    })
    const { l } = leser(stub)
    await expect(l.liesSeite(SEITE, 'example.ch')).rejects.toThrow(
      /antwortete mit 403\./
    )
  })
})
