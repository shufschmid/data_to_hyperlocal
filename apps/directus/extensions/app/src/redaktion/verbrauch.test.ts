import { describe, expect, it } from 'vitest'
import {
  kostenAus,
  preisFuer,
  tageAus,
  verbrauchsBilanz,
  type Preis,
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
  max_tokens: 4000,
  ...ueber
})

const PREISE: Preis[] = [
  {
    modell: 'claude-sonnet-5',
    eingabe_je_mio: 2,
    ausgabe_je_mio: 10,
    cache_lesen_je_mio: 0.2,
    cache_schreiben_je_mio: 2.5,
    waehrung: 'USD'
  },
  {
    modell: 'claude-haiku-4-5',
    eingabe_je_mio: 1,
    ausgabe_je_mio: 5,
    cache_lesen_je_mio: 0.1,
    cache_schreiben_je_mio: 1.25,
    waehrung: 'USD'
  }
]

describe('verbrauchsBilanz', () => {
  it('summiert je Tisch, je Modell und je Zweck — teuerstes zuerst, mit Kosten', () => {
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
      7,
      PREISE
    )
    expect(b.tage).toBe(7)
    expect(b.waehrung).toBe('USD')
    expect(b.gesamt).toMatchObject({
      aufrufe: 4,
      eingabe_tokens: 92000,
      ausgabe_tokens: 20100,
      abgebrochen: 1,
      fehler: 1,
      ohne_preis: 1
    })
    // Sonnet: (2000 × 2 + 8100 × 10) / 1e6 = 0.085 — Opus hat keinen Preis und zaehlt nicht.
    expect(b.gesamt.kosten).toBeCloseTo(0.085, 6)
    expect(b.ohnePreis).toEqual(['claude-opus-5'])
    // Ohne Preis sortiert die Ausgabe: Opus' 12000 Tokens liegen vor Sonnets 0.085.
    expect(b.tische.map((t) => t.tisch)).toEqual([
      'veranstaltungen',
      'wochenblaetter',
      'lernen'
    ])
    const v = b.tische[0]
    expect(v).toMatchObject({
      aufrufe: 2,
      ausgabe_tokens: 8100,
      abgebrochen: 1
    })
    expect(v?.kosten).toBeCloseTo(0.085, 6)
    expect(v?.zwecke[0]).toMatchObject({
      zweck: 'veranstaltungen:sichtung',
      modell_zuletzt: 'claude-sonnet-5',
      max_tokens_zuletzt: 4000,
      ausgabe_max: 8000
    })
  })

  it('findet den Preis auch fuer eine datierte Modell-ID', () => {
    expect(preisFuer('claude-haiku-4-5-20251001', PREISE)?.modell).toBe(
      'claude-haiku-4-5'
    )
    expect(preisFuer('claude-sonnet-5', PREISE)?.modell).toBe('claude-sonnet-5')
    expect(preisFuer('claude-opus-5', PREISE)).toBeNull()
    expect(
      kostenAus(zeile({ cache_gelesen_tokens: 1_000_000 }), PREISE[0] ?? null)
    ).toBeCloseTo(0.002 + 0.001 + 0.2, 6)
    expect(kostenAus(zeile({}), null)).toBeNull()
  })

  it('ohne Preise bleibt alles bei null und die Waehrung leer', () => {
    const b = verbrauchsBilanz([zeile({})], 30)
    expect(b.waehrung).toBeNull()
    expect(b.gesamt.kosten).toBe(0)
    expect(b.gesamt.ohne_preis).toBe(1)
  })

  it('tageAus: eine Woche als Standard, nie unter einem Tag, nie ueber einem Jahr', () => {
    expect(tageAus(undefined)).toBe(7)
    expect(tageAus('30')).toBe(30)
    expect(tageAus('0')).toBe(7)
    expect(tageAus('9999')).toBe(365)
    expect(tageAus('abc')).toBe(7)
  })
})
