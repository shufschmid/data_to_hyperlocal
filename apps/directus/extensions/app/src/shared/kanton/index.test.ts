import { describe, expect, it, vi } from 'vitest'
import {
  erstelleKantonLeser,
  KantonFehler,
  liesDetail,
  liesListe
} from './index'

const BASIS = 'https://bl-api.webcloud7.ch'

interface Antwort {
  body?: string
  status?: number
  typ?: string
}

function antwort({
  body = '{}',
  status = 200,
  typ = 'application/json'
}: Antwort): Response {
  const daten = Buffer.from(body, 'utf8')
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': typ }),
    arrayBuffer: async () =>
      daten.buffer.slice(daten.byteOffset, daten.byteOffset + daten.byteLength)
  } as unknown as Response
}

function stub(plan: Record<string, Antwort[] | (() => never)>) {
  const aufrufe: { url: string; headers: Record<string, string> }[] = []
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
    const p = plan[url]
    if (p === undefined) throw new Error(`unerwartet: ${url}`)
    if (typeof p === 'function') p()
    const liste = p as Antwort[]
    return antwort(liste[Math.min(n, liste.length - 1)] ?? {})
  }) as typeof fetch
  return { fetchImpl, aufrufe }
}

function leser(s: ReturnType<typeof stub>) {
  const sleep = vi
    .fn<(ms: number) => Promise<void>>()
    .mockResolvedValue(undefined)
  return {
    l: erstelleKantonLeser({
      kontakt: 'it@bajour.ch',
      basisUrl: BASIS,
      fetchImpl: s.fetchImpl,
      sleep
    }),
    sleep
  }
}

describe('erstelleKantonLeser — die Datentuer, identifiziert und begrenzt', () => {
  it('fragt mit Absender und JSON-Accept, liest die Liste und das Detail', async () => {
    const s = stub({
      [`${BASIS}/startseite/ftw-news-newslistingblock?b_size=50`]: [
        {
          body: JSON.stringify({
            items: [{ '@type': 'News', '@id': `${BASIS}/a`, title: 'A' }],
            items_total: 1
          })
        }
      ],
      [`${BASIS}/a`]: [
        {
          body: JSON.stringify({
            title: 'A',
            news_date: '2026-09-28T10:00:00',
            slblocks: {}
          })
        }
      ]
    })
    const { l } = leser(s)
    const liste = await liesListe(
      l,
      BASIS,
      {
        kennung: 'medienmitteilung',
        pfad: '/startseite/ftw-news-newslistingblock',
        name: 'Kanton'
      },
      50
    )
    expect(liste.items.map((i) => i.titel)).toEqual(['A'])
    const detail = await liesDetail(l, `${BASIS}/a`)
    expect(detail.newsDate).toBe('2026-09-28T10:00:00')
    expect(s.aufrufe[0]?.headers['User-Agent']).toMatch(
      /DieRedaktion\/1\.0 .*it@bajour\.ch/
    )
    expect(s.aufrufe[0]?.headers['Accept']).toBe('application/json')
    expect(l.protokoll().anfragen).toBe(2)
  })

  it('verweigert jede Adresse ausserhalb der Datentuer — die oeffentliche Seite wird nie geholt', async () => {
    const s = stub({})
    const { l } = leser(s)
    await expect(
      l.liesJson('https://www.baselland.ch/startseite')
    ).rejects.toThrow(KantonFehler)
    await expect(l.liesJson(`http://${new URL(BASIS).host}/x`)).rejects.toThrow(
      /nicht auf der Datentuer/
    )
    expect(s.aufrufe).toHaveLength(0)
  })

  it('versucht es bei 503 genau einmal mehr, bei 404 nicht', async () => {
    const s = stub({
      [`${BASIS}/wackelt`]: [{ status: 503 }, { body: '{"ok":true}' }],
      [`${BASIS}/fehlt`]: [{ status: 404 }]
    })
    const { l, sleep } = leser(s)
    expect(await l.liesJson(`${BASIS}/wackelt`)).toEqual({ ok: true })
    expect(sleep).toHaveBeenCalled()
    await expect(l.liesJson(`${BASIS}/fehlt`)).rejects.toThrow(/HTTP 404/)
    expect(s.aufrufe.filter((a) => a.url.endsWith('/fehlt'))).toHaveLength(1)
  })

  it('nimmt keine HTML-Antwort fuer JSON', async () => {
    const s = stub({
      [`${BASIS}/html`]: [{ body: '<html>', typ: 'text/html' }]
    })
    const { l } = leser(s)
    await expect(l.liesJson(`${BASIS}/html`)).rejects.toThrow(/nicht mit JSON/)
  })

  it('haelt die Pause zwischen zwei Anfragen', async () => {
    const s = stub({
      [`${BASIS}/a`]: [{ body: '{}' }],
      [`${BASIS}/b`]: [{ body: '{}' }]
    })
    const { l, sleep } = leser(s)
    await l.liesJson(`${BASIS}/a`)
    await l.liesJson(`${BASIS}/b`)
    expect(sleep).toHaveBeenCalledTimes(1)
  })
})
