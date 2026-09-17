import { describe, expect, it, vi } from 'vitest'
import {
  fetchMitZweiterTuer,
  fuerZweiteTuer,
  holeUeberCrawler,
  lohntCrawler,
  TRANSPORT_HEADER,
  vergissZweiteTuer,
  zweiteTuerSeit
} from './fallback'
import type { ScrapeErgebnis } from './index'

const ergebnis = (
  html: string,
  ueber: Partial<ScrapeErgebnis> = {}
): ScrapeErgebnis => ({
  markdown: '',
  html,
  links: [],
  renderer: 'httpx',
  statusCode: 200,
  abgeschnitten: false,
  ...ueber
})

describe('lohntCrawler', () => {
  it('zweite Tuer bei totem Socket, 403, 429 und 5xx — nicht bei 404 oder 200', () => {
    expect(lohntCrawler({ fehler: new Error('timeout') })).toBe(true)
    expect(lohntCrawler({ status: 403 })).toBe(true)
    expect(lohntCrawler({ status: 429 })).toBe(true)
    expect(lohntCrawler({ status: 502 })).toBe(true)
    expect(lohntCrawler({ status: 404 })).toBe(false)
    expect(lohntCrawler({ status: 200 })).toBe(false)
  })
})

describe('holeUeberCrawler', () => {
  it('liefert HTML als Response mit Transport-Kennzeichen, ohne Playwright zu erzwingen', async () => {
    const scrapeImpl = vi
      .fn()
      .mockResolvedValue(ergebnis('<html><body><h1>Da</h1></body></html>'))
    const antwort = await holeUeberCrawler('https://www.example.ch/a', {
      scrapeImpl
    })
    expect(antwort.status).toBe(200)
    expect(antwort.headers.get('content-type')).toMatch(/text\/html/)
    expect(antwort.headers.get(TRANSPORT_HEADER)).toBe('crawler')
    expect(await antwort.text()).toContain('<h1>Da</h1>')
    expect(scrapeImpl).toHaveBeenCalledWith(
      'https://www.example.ch/a',
      expect.objectContaining({ formats: ['html'], forcePlaywright: false })
    )
  })

  it('packt eine Textdatei aus der Browser-Huelle aus und gibt sie als text/plain', async () => {
    const huelle =
      '<html><head><meta name="color-scheme" content="light dark"></head><body><pre style="word-wrap: break-word; white-space: pre-wrap;">User-agent: *\ncrawl-delay: 10\n</pre></body></html>'
    const antwort = await holeUeberCrawler(
      'https://www.example.ch/robots.txt',
      {
        scrapeImpl: vi.fn().mockResolvedValue(ergebnis(huelle))
      }
    )
    expect(antwort.headers.get('content-type')).toMatch(/text\/plain/)
    expect(await antwort.text()).toBe('User-agent: *\ncrawl-delay: 10\n')

    // An empty robots.txt is a real answer — no rules — not a failed page.
    const leer = await holeUeberCrawler('https://www.example.ch/robots.txt', {
      scrapeImpl: vi
        .fn()
        .mockResolvedValue(ergebnis('<html><head></head><body></body></html>'))
    })
    expect(leer.headers.get('content-type')).toMatch(/text\/plain/)
    expect(await leer.text()).toBe('')
  })

  it('ein Dokument, eine leere oder eine gekuerzte Seite ist ein Fehler, nie eine Seite', async () => {
    await expect(
      holeUeberCrawler('u', {
        scrapeImpl: vi.fn().mockResolvedValue(ergebnis('%PDF-1.7 …'))
      })
    ).rejects.toThrow(/Dokument/)
    await expect(
      holeUeberCrawler('u', {
        scrapeImpl: vi.fn().mockResolvedValue(ergebnis('  '))
      })
    ).rejects.toThrow(/kein HTML/)
    await expect(
      holeUeberCrawler('u', {
        scrapeImpl: vi
          .fn()
          .mockResolvedValue(ergebnis('<html/>', { abgeschnitten: true }))
      })
    ).rejects.toThrow(/gekürzt/)
  })

  it('reicht den Status der Zielseite weiter — eine Abweisung bleibt eine', async () => {
    const antwort = await holeUeberCrawler('u', {
      scrapeImpl: vi
        .fn()
        .mockResolvedValue(ergebnis('<html>weg</html>', { statusCode: 403 }))
    })
    expect(antwort.status).toBe(403)
  })
})

describe('fuerZweiteTuer', () => {
  it('Seiten und Textdateien ja — Dokumente, Bilder, Daten-APIs und alles ausser GET nein', () => {
    expect(fuerZweiteTuer('https://www.example.ch/aktuelles')).toBe(true)
    expect(
      fuerZweiteTuer('https://www.example.ch/robots.txt', {
        headers: { Accept: 'text/plain' }
      })
    ).toBe(true)
    expect(fuerZweiteTuer('https://www.example.ch/a.pdf')).toBe(false)
    expect(fuerZweiteTuer('https://www.example.ch/plan.jpg')).toBe(false)
    expect(
      fuerZweiteTuer('https://www.example.ch/api', {
        headers: { Accept: 'application/json' }
      })
    ).toBe(false)
    expect(
      fuerZweiteTuer('https://www.example.ch/pdf', {
        headers: { accept: 'application/pdf,text/html;q=0.5' }
      })
    ).toBe(false)
    expect(fuerZweiteTuer('https://www.example.ch/x', { method: 'POST' })).toBe(
      false
    )
    expect(fuerZweiteTuer('kein url')).toBe(false)
  })
})

describe('fetchMitZweiterTuer', () => {
  const seite = (status: number, body = '') => new Response(body, { status })
  const crawlerSeite = () =>
    new Response('<html>zweite Tuer</html>', {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        [TRANSPORT_HEADER]: 'crawler'
      }
    })

  it('geht direkt, solange der Host antwortet — auch bei 404', async () => {
    vergissZweiteTuer()
    const crawler = vi.fn(async () => crawlerSeite())
    const direkt = vi.fn(async () => seite(404)) as unknown as typeof fetch
    const tuer = fetchMitZweiterTuer({ direkt, crawler })
    const antwort = await tuer('https://www.example.ch/weg')
    expect(antwort.status).toBe(404)
    expect(crawler).not.toHaveBeenCalled()
  })

  it('nach 403 oder einem toten Socket kommt die Seite ueber den Crawler, und der Lauf kann es nachlesen', async () => {
    vergissZweiteTuer()
    const vorher = Date.now()
    const crawler = vi.fn(async () => crawlerSeite())
    const direkt = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(seite(403))
      .mockRejectedValueOnce(
        new Error('The operation was aborted due to timeout')
      )
    const tuer = fetchMitZweiterTuer({ direkt, crawler })
    const a = await tuer('https://www.example.ch/a', {
      headers: { Accept: 'text/html' }
    })
    const b = await tuer('https://www.example.ch/b')
    expect(await a.text()).toBe('<html>zweite Tuer</html>')
    expect(b.headers.get(TRANSPORT_HEADER)).toBe('crawler')
    expect(crawler).toHaveBeenCalledTimes(2)
    expect(zweiteTuerSeit(vorher)).toEqual(['www.example.ch'])
    expect(zweiteTuerSeit(Date.now() + 1000)).toEqual([])
  })

  it('ein Dokument bleibt direkt, auch wenn der Host abweist', async () => {
    const crawler = vi.fn(async () => crawlerSeite())
    const direkt = vi.fn(async () => seite(403)) as unknown as typeof fetch
    const tuer = fetchMitZweiterTuer({ direkt, crawler })
    expect((await tuer('https://www.example.ch/ausgabe.pdf')).status).toBe(403)
    expect(crawler).not.toHaveBeenCalled()
  })

  it('scheitert auch der Crawler, steht der direkte Ausgang — Status oder Fehler mit beiden Gruenden', async () => {
    const crawler = vi.fn(async () => {
      throw new Error('Crawler antwortete mit HTTP 502.')
    })
    const direkt = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(seite(503))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
    const tuer = fetchMitZweiterTuer({ direkt, crawler })
    expect((await tuer('https://www.example.ch/a')).status).toBe(503)
    await expect(tuer('https://www.example.ch/b')).rejects.toThrow(
      /ECONNRESET — auch über den Crawler nicht: Crawler antwortete mit HTTP 502/
    )
  })

  it('ohne Crawler ist es ein gewoehnlicher fetch', async () => {
    const direkt = vi.fn(async () => {
      throw new Error('ENOTFOUND')
    }) as unknown as typeof fetch
    const tuer = fetchMitZweiterTuer({ direkt, crawler: null })
    await expect(tuer('https://www.example.ch/a')).rejects.toThrow(
      /^ENOTFOUND$/
    )
  })
})
