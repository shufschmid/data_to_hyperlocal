import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseZeile, parseZeilen } from './parse'

const fixture = (name: string): unknown[] =>
  JSON.parse(
    readFileSync(join(__dirname, 'fixtures', name), 'utf8')
  ) as unknown[]

const OFFEN = fixture('11990-2026-09-27-drei-gemeinden.json')
const GEZAEHLT = fixture('11990-2026-06-14-e1-alle-gemeinden.json')
const STICHFRAGE = fixture('11990-2026-03-08-k5-aesch.json')

describe('parseZeilen', () => {
  it('liest die 15 Zeilen des 27. September 2026 — drei Gemeinden, fuenf Vorlagen', () => {
    const { zeilen, verworfen } = parseZeilen(OFFEN)

    expect(zeilen).toHaveLength(15)
    expect(verworfen).toEqual([])
    expect(new Set(zeilen.map((z) => z.gemeinde))).toEqual(
      new Set(['Aesch (BL)', 'Allschwil', 'Binningen'])
    )
    expect(new Set(zeilen.map((z) => z.voteId))).toEqual(
      new Set(['20260927_E1', '20260927_E2', '20260927_K3'])
    )
  })

  it('liest "counted" als Zeichenkette, nicht als Wahrheitswert', () => {
    const { zeilen } = parseZeilen(OFFEN)
    expect(zeilen.every((z) => z.ausgezaehlt === false)).toBe(true)

    const { zeilen: fertig } = parseZeilen(GEZAEHLT)
    expect(fertig).toHaveLength(86)
    expect(fertig.every((z) => z.ausgezaehlt)).toBe(true)
  })

  it('uebersetzt die drei Arten und die beiden Ebenen', () => {
    const { zeilen } = parseZeilen(STICHFRAGE)

    expect(zeilen.map((z) => z.art).sort()).toEqual([
      'gegenvorschlag',
      'stichfrage',
      'vorlage'
    ])
    expect(new Set(zeilen.map((z) => z.ebene))).toEqual(new Set(['kanton']))

    const { zeilen: bund } = parseZeilen(GEZAEHLT)
    expect(bund[0]?.ebene).toBe('bund')
  })

  it('haelt die Zahlen einer ausgezaehlten Zeile fest', () => {
    const { zeilen } = parseZeilen(GEZAEHLT)
    const aesch = zeilen.find((z) => z.bfs === '2761')

    expect(aesch).toMatchObject({
      datum: '2026-06-14',
      gemeinde: 'Aesch (BL)',
      voteId: '20260614_E1',
      art: 'vorlage',
      antwort: 'abgelehnt',
      ja: 1709,
      nein: 2066,
      stimmberechtigte: 7002,
      leer: 18,
      ungueltig: 48
    })
    expect(aesch?.prozentJa).toBeCloseTo(45.2715, 3)
    expect(aesch?.beteiligung).toBeCloseTo(54.8558, 3)
    expect(aesch?.url).toBe(
      'https://abstimmungen.bl.ch/app/archive/de/vote/6860.html'
    )
  })

  it('liest die Antwort der Stichfrage als Seite, nicht als Ja oder Nein', () => {
    const { zeilen } = parseZeilen(STICHFRAGE)
    const stichfrage = zeilen.find((z) => z.art === 'stichfrage')

    // Gemessen am 18.09.2026: auf einer Stichfrage-Zeile nennt `answer` die
    // SIEGERIN, und `yeas` sind die Stimmen fuer die Initiative, `nays` die
    // fuer den Gegenvorschlag.
    expect(stichfrage?.antwort).toBe('gegenvorschlag')
    expect(stichfrage?.ja).toBe(1301)
    expect(stichfrage?.nein).toBe(1665)
  })

  it('verwirft eine Zeile mit unbekannter Art, statt sie zu raten', () => {
    const { zeilen, verworfen } = parseZeilen([
      ...STICHFRAGE,
      { ...(STICHFRAGE[0] as Record<string, unknown>), type: 'sonderfrage' }
    ])

    expect(zeilen).toHaveLength(3)
    expect(verworfen).toHaveLength(1)
    expect(verworfen[0]).toContain('sonderfrage')
  })

  it('verwirft eine Zeile ohne Vorlagenkennung', () => {
    const { zeilen, verworfen } = parseZeilen([
      { date: '2026-09-27', entity_id: '2761' }
    ])

    expect(zeilen).toEqual([])
    expect(verworfen).toHaveLength(1)
  })
})

describe('parseZeile', () => {
  it('schneidet einen Zeitstempel auf das reine Datum', () => {
    const zeile = parseZeile({
      date: '2026-09-27T00:00:00+00:00',
      entity_id: '2761',
      name: 'Aesch (BL)',
      vote_id: '20260927_E1',
      domain0: 'federation',
      type: 'proposal',
      title_de_ch: 'Volksinitiative',
      counted: 'False'
    })

    expect(zeile).not.toBeNull()
    expect(zeile?.datum).toBe('2026-09-27')
  })

  it('laesst leere Zahlen leer, statt sie zu null zu rechnen', () => {
    const { zeilen } = parseZeilen(OFFEN)

    expect(zeilen[0]?.ja).toBeNull()
    expect(zeilen[0]?.beteiligung).toBeNull()
    expect(zeilen[0]?.antwort).toBeNull()
  })
})
