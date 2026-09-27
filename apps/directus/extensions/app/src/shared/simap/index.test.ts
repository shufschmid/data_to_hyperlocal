import { describe, expect, it, vi } from 'vitest'
import {
  fetchErfuellungsort,
  fetchVergabestellen,
  SimapFehler,
  vergabestellenIds
} from './index'

// The network half, with a stubbed fetch — the pagination and the manners are
// the parts worth pinning; the shapes are covered by parse.test.ts against real
// fixtures.

const abruf = (fetchImpl: typeof fetch) => ({
  kontakt: 'test@example.ch',
  fetchImpl
})

function antwort(projekte: unknown[], lastItem: string | null): Response {
  return new Response(
    JSON.stringify({
      projects: projekte,
      pagination: { lastItem, itemsPerPage: 20 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

function projekt(n: number): Record<string, unknown> {
  return {
    id: `p${n}`,
    publicationId: `pub${n}`,
    title: { de: `Projekt ${n}` },
    publicationDate: '2026-09-01',
    projectNumber: String(1000 + n)
  }
}

describe('fetchVergabestellen', () => {
  it('fragt nichts, wenn eine Gemeinde keine Vergabestelle hinterlegt hat', async () => {
    const gefragt = vi.fn()
    const ergebnis = await fetchVergabestellen(
      [],
      '2026-09-01',
      abruf(gefragt as never)
    )

    expect(ergebnis.projekte).toEqual([])
    expect(ergebnis.abgeschnitten).toBe(false)
    expect(gefragt).not.toHaveBeenCalled()
  })

  it('identifiziert sich und filtert nach Vergabestelle und Datum', async () => {
    const urls: string[] = []
    const kopfzeilen: Record<string, string>[] = []
    const stub = (async (url: string, init?: RequestInit) => {
      urls.push(url)
      kopfzeilen.push(init?.headers as Record<string, string>)
      return antwort([projekt(1)], null)
    }) as unknown as typeof fetch

    const { projekte } = await fetchVergabestellen(
      [
        'aaaaaaaa-0000-4000-8000-00000000000a',
        'bbbbbbbb-0000-4000-8000-00000000000b'
      ],
      '2026-08-30',
      abruf(stub)
    )

    expect(projekte).toHaveLength(1)
    expect(urls[0]).toContain(
      'issuedByOrganizations=aaaaaaaa-0000-4000-8000-00000000000a%2Cbbbbbbbb-0000-4000-8000-00000000000b'
    )
    expect(urls[0]).toContain('newestPublicationFrom=2026-08-30')
    // Wir sagen, wer wir sind — dieselbe Manier wie bei den anderen Quellen.
    expect(kopfzeilen[0]!['User-Agent']).toContain('test@example.ch')
  })

  it('folgt der rollenden Paginierung und meldet den Deckel, statt still abzuschneiden', async () => {
    // Jede Seite liefert neue Zeilen UND einen Cursor — also gibt es immer mehr.
    let n = 0
    const stub = (async () => {
      n += 1
      return antwort([projekt(n)], `2026-09-01|${1000 + n}`)
    }) as unknown as typeof fetch

    const { projekte, abgeschnitten } = await fetchVergabestellen(
      ['aaaaaaaa-0000-4000-8000-00000000000a'],
      '2026-01-01',
      abruf(stub)
    )

    // Fuenf Seiten, dann Schluss — und die Zeilen bleiben erhalten.
    expect(projekte).toHaveLength(5)
    expect(abgeschnitten).toBe(true)
  })

  it('hoert auf, wenn eine Seite nur schon Gesehenes bringt', async () => {
    // Der Cursor zeigt auf die letzte Zeile, die darum erneut kommt: ohne die
    // Dedup-Bremse liefe das ewig.
    const stub = (async () =>
      antwort([projekt(1)], '2026-09-01|1001')) as unknown as typeof fetch

    const { projekte, abgeschnitten } = await fetchVergabestellen(
      ['aaaaaaaa-0000-4000-8000-00000000000a'],
      '2026-01-01',
      abruf(stub)
    )

    expect(projekte).toHaveLength(1)
    expect(abgeschnitten).toBe(false)
  })
})

describe('fetchErfuellungsort', () => {
  it('schickt die Untertypen als Quick-Filter mit — ohne den weist simap ab', async () => {
    const urls: string[] = []
    const stub = (async (url: string) => {
      urls.push(url)
      return antwort([], null)
    }) as unknown as typeof fetch

    await fetchErfuellungsort(['BL', 'BS'], '2026-08-30', abruf(stub))

    expect(urls[0]).toContain('projectSubTypes=construction')
    expect(urls[0]).toContain('projectSubTypes=service')
    expect(urls[0]).toContain('orderAddressCantons=BL%2CBS')
  })

  it('fragt nichts ohne Kanton', async () => {
    const gefragt = vi.fn()
    const { projekte } = await fetchErfuellungsort(
      [],
      '2026-08-30',
      abruf(gefragt as never)
    )
    expect(projekte).toEqual([])
    expect(gefragt).not.toHaveBeenCalled()
  })
})

describe('hole', () => {
  it('wiederholt einen 4xx nicht — das ist eine Antwort, kein Schluckauf', async () => {
    let versuche = 0
    const stub = (async () => {
      versuche += 1
      return new Response('nope', { status: 400 })
    }) as unknown as typeof fetch

    await expect(
      fetchVergabestellen(
        ['aaaaaaaa-0000-4000-8000-00000000000a'],
        '2026-09-01',
        abruf(stub)
      )
    ).rejects.toThrow(SimapFehler)
    expect(versuche).toBe(1)
  })
})

// Gemessen am 27.09.2026: eine Migration schrieb Allschwils und Reinachs
// Vergabestellen als blosse uuids. Daraus wurde ein LEERER Filter, und simap
// antwortet auf einen leeren Filter mit der ganzen Schweiz.
describe('vergabestellenIds', () => {
  const A = '1c10de22-1d6a-4088-a86f-bdeb81b729b3'
  const B = '460483e1-0f3f-4db6-9c87-f0ee170dabbb'

  it('liest die Objektform und die blosse Kennung gleich', () => {
    expect(
      vergabestellenIds([
        { id: A, name: 'Einwohnergemeinde Allschwil', typ: 'communal' },
        B
      ])
    ).toEqual({
      ids: [A, B],
      unlesbar: 0
    })
  })

  it('zaehlt, was keine Kennung ist, statt es zu schicken', () => {
    expect(
      vergabestellenIds([{ name: 'ohne id' }, '', 'Gemeinde Reinach', null])
    ).toEqual({ ids: [], unlesbar: 4 })
    expect(vergabestellenIds(null)).toEqual({ ids: [], unlesbar: 0 })
  })
})

describe('fetchVergabestellen', () => {
  it('schickt nie einen Filter ohne gueltige Kennung', async () => {
    const fetchImpl = vi.fn()
    await expect(
      fetchVergabestellen([''], '2026-09-25', {
        fetchImpl
      } as unknown as Parameters<typeof fetchVergabestellen>[2])
    ).rejects.toThrow('ohne gueltige Kennung')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
