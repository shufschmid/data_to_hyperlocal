import { describe, expect, it } from 'vitest'
import { parseStufenSichtung, STUFEN_SCHEMA } from './sichtung'

const zeilen = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('parseStufenSichtung', () => {
  it('ordnet die Urteile den nummerierten Zeilen zu und uebergeht Unbrauchbares', () => {
    const urteile = parseStufenSichtung(
      {
        urteile: [
          {
            nummer: 1,
            stufe: 4,
            begruendung: ' Dorffest. ',
            empfehlung: null,
            empfehlung_regel: null
          },
          {
            nummer: 2,
            stufe: 7,
            begruendung: 'kaputt',
            empfehlung: null,
            empfehlung_regel: null
          },
          {
            nummer: 3,
            stufe: 2,
            begruendung: 'Klein.',
            empfehlung: 'weiterreichen',
            empfehlung_regel: 'R2'
          },
          {
            nummer: 3,
            stufe: 1,
            begruendung: 'doppelt',
            empfehlung: null,
            empfehlung_regel: null
          },
          {
            nummer: 9,
            stufe: 1,
            begruendung: 'ohne Zeile',
            empfehlung: null,
            empfehlung_regel: null
          },
          'kein Objekt'
        ]
      },
      zeilen
    )
    expect(urteile).toEqual([
      {
        id: 'a',
        stufe: 4,
        begruendung: 'Dorffest.',
        empfehlung: null,
        empfehlung_regel: null
      },
      {
        id: 'c',
        stufe: 2,
        begruendung: 'Klein.',
        empfehlung: 'weiterreichen',
        empfehlung_regel: 'R2'
      }
    ])
  })

  it('wirft ohne Liste, damit die Gemeinde als unbeurteilt gilt', () => {
    expect(() => parseStufenSichtung({ urteile: 'kaputt' }, zeilen)).toThrow(
      /urteile/
    )
    expect(() => parseStufenSichtung(null, zeilen)).toThrow(/urteile/)
  })

  it('das Schema verlangt eine Stufe von 1 bis 4', () => {
    expect(STUFEN_SCHEMA.properties.urteile.items.properties.stufe).toEqual({
      type: 'integer',
      enum: [1, 2, 3, 4]
    })
    expect(STUFEN_SCHEMA.properties.urteile.items.required).toContain('stufe')
  })
})
