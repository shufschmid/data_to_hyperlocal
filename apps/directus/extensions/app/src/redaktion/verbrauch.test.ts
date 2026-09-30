import { describe, expect, it } from 'vitest'
import {
  tageAus,
  verbrauchsBilanz,
  ZWECKE_JE_TISCH,
  type VerbrauchsZeile
} from './verbrauch'

const zeile = (ueber: Partial<VerbrauchsZeile>): VerbrauchsZeile => ({
  tisch: 'veranstaltungen',
  zweck: 'veranstaltungen:sichtung',
  modell: 'claude-sonnet-5',
  eingabe_tokens: 1000,
  ausgabe_tokens: 100,
  cache_gelesen_tokens: 0,
  cache_geschrieben_tokens: 0,
  abgebrochen: false,
  fehler: null,
  ...ueber
})

describe('verbrauchsBilanz', () => {
  it('summiert je Tisch, je Modell und je Zweck — teuerstes zuerst', () => {
    const b = verbrauchsBilanz(
      [
        zeile({}),
        zeile({ ausgabe_tokens: 8000, abgebrochen: true }),
        zeile({
          tisch: 'wochenblaetter',
          zweck: 'wochenblaetter:inventar',
          modell: 'claude-opus-5',
          eingabe_tokens: 90000,
          ausgabe_tokens: 12000
        }),
        zeile({
          tisch: 'lernen',
          zweck: 'lernen:wissen',
          eingabe_tokens: 0,
          ausgabe_tokens: 0,
          fehler: 'overloaded'
        })
      ],
      7
    )
    expect(b.tage).toBe(7)
    expect(b.gesamt).toEqual({
      aufrufe: 4,
      eingabe_tokens: 92000,
      ausgabe_tokens: 20100,
      cache_gelesen_tokens: 0,
      cache_geschrieben_tokens: 0,
      abgebrochen: 1,
      fehler: 1
    })
    expect(b.tische.map((t) => t.tisch)).toEqual([
      'wochenblaetter',
      'veranstaltungen',
      'lernen'
    ])
    const v = b.tische[1]
    expect(v).toMatchObject({
      aufrufe: 2,
      ausgabe_tokens: 8100,
      abgebrochen: 1
    })
    expect(v?.modelle).toEqual([
      expect.objectContaining({ modell: 'claude-sonnet-5', aufrufe: 2 })
    ])
    expect(v?.zwecke[0]?.zweck).toBe('veranstaltungen:sichtung')
  })

  it('kappt die Zwecke je Tisch und sagt es durch die Konstante', () => {
    const b = verbrauchsBilanz(
      Array.from({ length: 10 }, (_, i) =>
        zeile({ zweck: `veranstaltungen:z${i}` })
      ),
      30
    )
    expect(b.tische[0]?.zwecke).toHaveLength(ZWECKE_JE_TISCH)
  })

  it('tageAus: eine Woche als Standard, nie unter einem Tag, nie ueber einem Jahr', () => {
    expect(tageAus(undefined)).toBe(7)
    expect(tageAus('30')).toBe(30)
    expect(tageAus('0')).toBe(7)
    expect(tageAus('9999')).toBe(365)
    expect(tageAus('abc')).toBe(7)
  })
})
