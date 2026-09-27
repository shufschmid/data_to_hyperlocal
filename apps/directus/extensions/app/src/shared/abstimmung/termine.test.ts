import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  liesTermine,
  parseTermine,
  termineAbgleich,
  termineUrl
} from './termine'

const csv = readFileSync(
  new URL('./fixtures/lindas-termine-2026-09-27.csv', import.meta.url),
  'utf8'
)

describe('parseTermine — die Abstimmungstage des Bundes', () => {
  const { termine, unbekannt } = parseTermine(csv)

  it('liest jede Zeile der echten Antwort', () => {
    expect(unbekannt).toBe(0)
    expect(termine.length).toBe(281)
  })

  it('kennt die vier Arten, mit der Zahl der Vorlagen wo festgelegt', () => {
    const nach = new Map(termine.map((t) => [t.datum, t]))
    expect(nach.get('2026-09-27')).toEqual({
      datum: '2026-09-27',
      art: 'festgelegt',
      vorlagen: 2
    })
    expect(nach.get('2026-11-29')).toEqual({
      datum: '2026-11-29',
      art: 'festgelegt',
      vorlagen: 4
    })
    expect(nach.get('2027-02-28')).toEqual({
      datum: '2027-02-28',
      art: 'blanko',
      vorlagen: null
    })
    expect(nach.get('2027-10-24')?.art).toBe('nationalratswahlen')
    expect(nach.get('2026-03-08')?.art).toBe('genutzt')
  })

  it('zaehlt eine unbekannte Art, statt sie zu raten', () => {
    const r = parseTermine(
      'date,typ,vorlagen\n2027-01-01,https://x/typ/verschoben,-\n2027-02-28,https://x/typ/blanko,-'
    )
    expect(r.unbekannt).toBe(1)
    expect(r.termine).toHaveLength(1)
  })

  it('verweigert eine Antwort ohne ihre Spalten', () => {
    expect(() => parseTermine('<html>')).toThrow(/Spalten/)
  })
})

describe('liesTermine', () => {
  it('fragt ab dem Tag und wirft bei einer Absage', async () => {
    expect(
      decodeURIComponent(
        termineUrl('https://lindas.admin.ch/query', '2026-09-27')
      )
    ).toContain('"2026-09-27"^^')
    const kaputt = async () => new Response('', { status: 503 })
    await expect(
      liesTermine('https://x', '2026-09-27', kaputt)
    ).rejects.toThrow(/503/)
  })
})

describe('termineAbgleich — das Fenster wird zur Quelle', () => {
  const frisch = [
    { datum: '2026-11-29', art: 'festgelegt' as const, vorlagen: 4 },
    { datum: '2027-02-28', art: 'blanko' as const, vorlagen: null },
    { datum: '2031-03-16', art: 'blanko' as const, vorlagen: null }
  ]

  it('legt neue an, aendert geaenderte und laesst Tage ausserhalb liegen', () => {
    const r = termineAbgleich(
      [
        { id: 'a', datum: '2026-11-29', art: 'blanko', vorlagen: null },
        { id: 'b', datum: '2027-06-06', art: 'blanko', vorlagen: null },
        { id: 'c', datum: '2026-06-14', art: 'genutzt', vorlagen: 2 }
      ],
      frisch,
      '2026-09-27',
      '2027-10-31'
    )
    expect(r.neu.map((t) => t.datum)).toEqual(['2027-02-28'])
    expect(r.geaendert).toEqual([
      { id: 'a', datum: '2026-11-29', art: 'festgelegt', vorlagen: 4 }
    ])
    // Ein verschobener Blanko-Termin verschwindet; ein vergangener Tag nie.
    expect(r.weg).toEqual(['b'])
  })
})
