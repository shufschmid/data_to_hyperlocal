import { describe, expect, it } from 'vitest'
import {
  EIGENE_HINWEIS,
  ERGAENZUNG_HINWEIS,
  ERGAENZUNG_MAX_ZEICHEN,
  eigeneAlsErgaenzung,
  eigeneFelder,
  eigeneWarnungen,
  ergaenzungAus,
  ergaenzungsHinweis,
  ergaenzungsZeilen,
  herkunftFelder,
  leseBeitrag,
  OHNE_BEITRAG
} from './ergaenzung'

describe('ergaenzungsZeilen', () => {
  it('ist leer ohne Angaben', () => {
    expect(ergaenzungsZeilen(null)).toEqual([])
    expect(ergaenzungsZeilen(undefined)).toEqual([])
    expect(ergaenzungsZeilen('   ')).toEqual([])
  })

  it('kennzeichnet die Angaben als die der Redaktion, nicht der Quelle', () => {
    const zeilen = ergaenzungsZeilen(
      'Die Turnerobe ist die Jahresvorstellung des TV Reinach.'
    )
    expect(zeilen[0]).toBe('')
    expect(zeilen[1]).toContain('Ergaenzende Angaben der Redaktion')
    expect(zeilen[1]).toContain('NICHT der Quelle')
    expect(zeilen[2]).toBe(
      'Die Turnerobe ist die Jahresvorstellung des TV Reinach.'
    )
  })
})

describe('ergaenzungsHinweis', () => {
  it('haengt den Hinweis nur an, wo Angaben eingeflossen sind', () => {
    expect(ergaenzungsHinweis({})).toEqual([])
    expect(ergaenzungsHinweis({ ergaenzung: null })).toEqual([])
    expect(ergaenzungsHinweis({ ergaenzung: 'x' })).toEqual([
      ERGAENZUNG_HINWEIS
    ])
  })

  it('die beiden Hinweise tragen kein Komma — die Spalte ist CSV', () => {
    expect(ERGAENZUNG_HINWEIS).not.toContain(',')
    expect(EIGENE_HINWEIS).not.toContain(',')
  })
})

describe('ergaenzungAus', () => {
  it('liest die gespeicherten Angaben aus der Datengrundlage', () => {
    expect(
      ergaenzungAus({ quelle: 'veranstaltung', ergaenzung: 'Jahresshow' })
    ).toBe('Jahresshow')
    expect(ergaenzungAus({ quelle: 'veranstaltung' })).toBeNull()
    expect(ergaenzungAus({ ergaenzung: '  ' })).toBeNull()
    expect(ergaenzungAus(null)).toBeNull()
    expect(ergaenzungAus('x')).toBeNull()
  })
})

describe('herkunftFelder', () => {
  it('merkt sich nichts ohne Beitrag der Redaktion', () => {
    expect(herkunftFelder(OHNE_BEITRAG)).toEqual({})
  })

  it('merkt sich die Ergaenzung', () => {
    expect(herkunftFelder({ ergaenzung: 'Jahresshow', eigene: null })).toEqual({
      ergaenzung: 'Jahresshow'
    })
  })

  it('merkt sich eine eigene Meldung als ihre eigene Ergaenzung', () => {
    expect(
      herkunftFelder({
        ergaenzung: null,
        eigene: { titel: 'Turnerobe', lead: 'Lead.', text: 'Text.' }
      })
    ).toEqual({ eigene: true, ergaenzung: 'Turnerobe\n\nLead.\n\nText.' })
  })
})

describe('eigeneAlsErgaenzung', () => {
  it('laesst leere Teile weg', () => {
    expect(eigeneAlsErgaenzung({ titel: ' T ', lead: '', text: 'X' })).toBe(
      'T\n\nX'
    )
  })
})

describe('eigeneWarnungen', () => {
  it('prueft Zeitbezug und Links auch bei einem Text von Hand', () => {
    const warnungen = eigeneWarnungen({
      titel: 'Turnerobe',
      lead: 'Der TV Reinach zeigt morgen seine Show.',
      text: 'Mehr unter https://www.tvreinach.ch/show.'
    })
    expect(warnungen).toContain('Relativer Zeitbezug: "morgen"')
    expect(
      warnungen.some((w) => w.startsWith('Der Text nennt selbst eine Adresse'))
    ).toBe(true)
    expect(warnungen[warnungen.length - 1]).toBe(EIGENE_HINWEIS)
  })

  it('traegt immer den Hinweis, dass die Redaktion selbst schrieb', () => {
    expect(
      eigeneWarnungen({ titel: 'T', lead: 'L', text: 'Am 21. November 2026.' })
    ).toEqual([EIGENE_HINWEIS])
  })
})

describe('eigeneFelder', () => {
  it('baut die Quellenzeile mit dem Code des Tischs und laesst die Pruefungen stehen', () => {
    const felder = eigeneFelder(
      { titel: ' Turnerobe ', lead: 'Lead.', text: 'Text.\n' },
      (text) => `${text}\n\nQuelle: Kalender, https://example.ch/1`
    )
    expect(felder['titel']).toBe('Turnerobe')
    expect(felder['lead']).toBe('Lead.')
    expect(felder['text']).toBe(
      'Text.\n\nQuelle: Kalender, https://example.ch/1'
    )
    expect(felder['status']).toBe('entwurf')
    expect(felder['verarbeitung']).toBe('idle')
    expect(felder['zeit_warnungen']).toEqual([EIGENE_HINWEIS])
  })
})

describe('leseBeitrag', () => {
  it('ein leerer Koerper ist der gewohnte Weg', () => {
    expect(leseBeitrag(undefined)).toEqual({
      beitrag: OHNE_BEITRAG,
      grund: null
    })
    expect(leseBeitrag({})).toEqual({ beitrag: OHNE_BEITRAG, grund: null })
    expect(leseBeitrag({ gemeinde: 'g1' })).toEqual({
      beitrag: OHNE_BEITRAG,
      grund: null
    })
  })

  it('liest die Ergaenzung und schneidet Rand ab', () => {
    expect(leseBeitrag({ ergaenzung: '  Jahresshow  ' })).toEqual({
      beitrag: { ergaenzung: 'Jahresshow', eigene: null },
      grund: null
    })
    expect(leseBeitrag({ ergaenzung: '  ' })).toEqual({
      beitrag: OHNE_BEITRAG,
      grund: null
    })
  })

  it('weist eine zu lange Ergaenzung ab', () => {
    const { grund } = leseBeitrag({
      ergaenzung: 'x'.repeat(ERGAENZUNG_MAX_ZEICHEN + 1)
    })
    expect(grund).toContain('zu lang')
  })

  it('liest die eigene Meldung und verlangt alle drei Teile', () => {
    expect(
      leseBeitrag({ eigene: { titel: 'T', lead: 'L', text: 'X' } })
    ).toEqual({
      beitrag: {
        ergaenzung: null,
        eigene: { titel: 'T', lead: 'L', text: 'X' }
      },
      grund: null
    })
    expect(leseBeitrag({ eigene: { titel: 'T', text: 'X' } }).grund).toContain(
      'Titel, Lead und Text'
    )
    expect(leseBeitrag({ eigene: 'T' }).grund).not.toBeNull()
  })

  it('weist einen zu langen Titel ab — die Spalte ist 255 Zeichen breit', () => {
    expect(
      leseBeitrag({ eigene: { titel: 'x'.repeat(256), lead: 'L', text: 'X' } })
        .grund
    ).toContain('Titel ist zu lang')
  })

  it('nimmt nicht beides zugleich', () => {
    expect(
      leseBeitrag({
        ergaenzung: 'Jahresshow',
        eigene: { titel: 'T', lead: 'L', text: 'X' }
      }).grund
    ).toContain('nicht beides')
  })
})
