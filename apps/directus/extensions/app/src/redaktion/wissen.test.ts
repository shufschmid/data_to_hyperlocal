import { describe, expect, it } from 'vitest'
import {
  buildWissenPrompt,
  parseWissen,
  wissenFelder,
  wissenFelderManuell
} from './wissen'

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

describe('wissenFelder fuer einen Tisch', () => {
  it('bindet eine Desk-Regel global an ihren Bereich, als Textregel', () => {
    const felder = wissenFelder(
      {
        dauerhaft: true,
        regel: 'Nenne die Sendung im ersten Satz.',
        geltungsbereich: 'global'
      },
      {
        datensatzId: null,
        quelleId: null,
        bereich: 'sendung',
        herkunft: 'kommentar',
        beleg: 'Immer sagen, woher es kommt.'
      }
    )

    expect(felder).toMatchObject({
      bereich: 'sendung',
      stufe: 'text',
      wirkung: 'hinweis',
      geltungsbereich: 'global',
      herkunft: 'kommentar',
      beleg: 'Immer sagen, woher es kommt.',
      datensatz: null,
      quelle: null
    })
  })

  it('macht auch aus einem "datensatz"-Urteil an einem Tisch eine globale Regel', () => {
    // Ein Tisch hat keinen Datensatz — ein Scope, der auf nichts zeigt, waere
    // eine Regel, die nie gilt.
    const felder = wissenFelder(
      { dauerhaft: true, regel: 'Kuerzer.', geltungsbereich: 'datensatz' },
      { datensatzId: null, quelleId: null, bereich: 'presseschau' }
    )
    expect(felder?.['geltungsbereich']).toBe('global')
    expect(felder?.['datensatz']).toBeNull()
  })

  it('bleibt fuer die Statistik, wie es war — Bereich und Stufe kommen dazu', () => {
    const felder = wissenFelder(
      {
        dauerhaft: true,
        regel: 'Nenne den Bezirk.',
        geltungsbereich: 'datensatz'
      },
      BEZUG
    )
    expect(felder).toMatchObject({
      bereich: 'statistik',
      stufe: 'text',
      herkunft: 'chat',
      datensatz: 'ds-1'
    })
  })
})

describe('parseWissen mit erlaubten Geltungsbereichen', () => {
  it('faellt an einem Tisch auf "global" zurueck, wenn das Modell etwas anderes sagt', () => {
    const urteil = parseWissen(
      { dauerhaft: true, regel: 'Kuerzer.', geltungsbereich: 'datensatz' },
      ['global']
    )
    expect(urteil.geltungsbereich).toBe('global')
  })
})

describe('buildWissenPrompt fuer einen Tisch', () => {
  it('sagt, dass es keinen Datensatz gibt und die Regel global gilt', () => {
    const prompt = buildWissenPrompt('Kuerzer.', 'Amtsblatt-Meldung', [
      'global'
    ])
    expect(prompt).toContain('Kontext: Amtsblatt-Meldung')
    expect(prompt).toContain('"geltungsbereich" ist immer "global"')
    expect(prompt).not.toContain('Datensatz:')
  })
})

describe('wissenFelderManuell', () => {
  it('legt eine von Hand erfasste Regel global an ihrem Tisch an', () => {
    expect(
      wissenFelderManuell({
        bereich: 'presseschau',
        stufe: 'sichtung',
        regel: '  Kirchenzettel nie vorschlagen.  ',
        wirkung: 'hinweis'
      })
    ).toEqual({
      regel: 'Kirchenzettel nie vorschlagen.',
      geltungsbereich: 'global',
      herkunft: 'manuell',
      aktiv: true,
      bereich: 'presseschau',
      stufe: 'sichtung',
      wirkung: 'hinweis',
      beleg: 'Von Hand erfasst.',
      datensatz: null,
      quelle: null
    })
  })

  it('laesst "weiterreichen" nur an einer Sichtungsregel zu', () => {
    expect(
      wissenFelderManuell({
        bereich: 'amtsblatt',
        stufe: 'text',
        regel: 'Kuerzer.',
        wirkung: 'weiterreichen'
      })['wirkung']
    ).toBe('hinweis')
    expect(
      wissenFelderManuell({
        bereich: 'amtsblatt',
        stufe: 'sichtung',
        regel: 'Planauflagen an die Chefredaktion.',
        wirkung: 'weiterreichen'
      })['wirkung']
    ).toBe('weiterreichen')
  })

  it('weist Leeres und Unbekanntes zurueck', () => {
    expect(() =>
      wissenFelderManuell({ bereich: 'amtsblatt', stufe: 'text', regel: '  ' })
    ).toThrow('leer')
    expect(() =>
      wissenFelderManuell({ bereich: 'wetter', stufe: 'text', regel: 'x' })
    ).toThrow('Bereich')
    expect(() =>
      wissenFelderManuell({ bereich: 'sport', stufe: 'irgendwas', regel: 'x' })
    ).toThrow('Stufe')
  })
})
