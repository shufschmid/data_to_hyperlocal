import { describe, expect, it } from 'vitest'
import { buildWissenPrompt, parseWissen, wissenFelder } from './wissen'

const BEZUG = { datensatzId: 'ds-1', quelleId: 'q-1' }

describe('buildWissenPrompt', () => {
  it('gibt Anweisung und Datensatz mit', () => {
    const prompt = buildWissenPrompt('Nenne immer den Bezirk.', 'Abfallmengen')

    expect(prompt).toContain('Nenne immer den Bezirk.')
    expect(prompt).toContain('Abfallmengen')
  })
})

describe('parseWissen', () => {
  it('nimmt eine dauerhafte Regel an', () => {
    expect(
      parseWissen({
        dauerhaft: true,
        regel: 'Nenne immer den Bezirk.',
        geltungsbereich: 'datensatz'
      })
    ).toEqual({
      dauerhaft: true,
      regel: 'Nenne immer den Bezirk.',
      geltungsbereich: 'datensatz'
    })
  })

  it('nimmt eine einmalige Korrektur nicht auf', () => {
    expect(
      parseWissen({
        dauerhaft: false,
        regel: null,
        geltungsbereich: 'datensatz'
      })
    ).toEqual({ dauerhaft: false, regel: null, geltungsbereich: 'datensatz' })
  })

  // "Durable" with nothing to store is not a verdict. Reading it as one-off
  // loses nothing a human cannot add by hand.
  it('behandelt "dauerhaft ohne Regel" als einmalig', () => {
    const urteil = parseWissen({
      dauerhaft: true,
      regel: '   ',
      geltungsbereich: 'global'
    })

    expect(urteil.dauerhaft).toBe(false)
    expect(urteil.regel).toBeNull()
  })

  // A wrongly stored rule appears in every future article and has to be found
  // and removed by hand, so an unreadable scope falls back to the narrowest.
  it('faellt bei unbekanntem Geltungsbereich auf "datensatz" zurueck', () => {
    expect(
      parseWissen({ dauerhaft: true, regel: 'x', geltungsbereich: 'alles' })
        .geltungsbereich
    ).toBe('datensatz')
    expect(
      parseWissen({ dauerhaft: true, regel: 'x', geltungsbereich: 42 })
        .geltungsbereich
    ).toBe('datensatz')
  })

  it('kuerzt eine ueberlange Regel', () => {
    expect(
      parseWissen({
        dauerhaft: true,
        regel: 'x'.repeat(800),
        geltungsbereich: 'global'
      }).regel?.length
    ).toBe(300)
  })

  it('lehnt ein fehlendes Urteil ab', () => {
    expect(() => parseWissen({ regel: 'x' })).toThrow(/dauerhaft/)
    expect(() => parseWissen('nope')).toThrow()
  })
})

describe('wissenFelder', () => {
  it('haengt eine Datensatz-Regel an den Datensatz', () => {
    const felder = wissenFelder(
      {
        dauerhaft: true,
        regel: 'Nenne den Bezirk.',
        geltungsbereich: 'datensatz'
      },
      BEZUG
    )

    expect(felder?.['datensatz']).toBe('ds-1')
    expect(felder?.['quelle']).toBeNull()
    expect(felder?.['herkunft']).toBe('chat')
  })

  it('haengt eine Quellen-Regel an die Quelle', () => {
    const felder = wissenFelder(
      {
        dauerhaft: true,
        regel: 'Immer Schweizer Schreibweise.',
        geltungsbereich: 'quelle'
      },
      BEZUG
    )

    expect(felder?.['quelle']).toBe('q-1')
    expect(felder?.['datensatz']).toBeNull()
  })

  // A global rule enters every future article of every dataset, so it must not
  // carry a dataset or source that would narrow it silently.
  it('bindet eine globale Regel an nichts', () => {
    const felder = wissenFelder(
      {
        dauerhaft: true,
        regel: 'Keine Ausrufezeichen.',
        geltungsbereich: 'global'
      },
      BEZUG
    )

    expect(felder?.['datensatz']).toBeNull()
    expect(felder?.['quelle']).toBeNull()
  })

  it('speichert nichts bei einer einmaligen Anweisung', () => {
    expect(
      wissenFelder(
        { dauerhaft: false, regel: null, geltungsbereich: 'datensatz' },
        BEZUG
      )
    ).toBeNull()
  })
})
