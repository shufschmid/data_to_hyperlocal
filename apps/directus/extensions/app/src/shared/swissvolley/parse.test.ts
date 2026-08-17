import { describe, expect, it } from 'vitest'
import { parseGameCenter, spielSchluessel } from './parse'

// Verbatim from the Game Center page of Sm'Aesch Pfeffingen (club 909660,
// team 98), including the navigation the page wraps around the fixture list.
const SEITE = `
Informationen für:[Teams](https://www.volleyball.ch/de/wissen/cat/fuer-teams)VolleyManager

Samstag, 10. Oktober 2026, 20:00Aarau

BTV Aarau—

Sm\`Aesch Pfeffingen

Sonntag, 18. Oktober 2026, 16:00Aesch

Sm\`Aesch Pfeffingen—

Infomaniak Genève Volley

Samstag, 31. Oktober 2026, 17:30Düdingen

Volley Düdingen—

Sm\`Aesch Pfeffingen

## Weitere Inhalte (Footer/Sidebar)

Swiss VolleyInformationen für:[Medien](https://www.volleyball.ch/de/medien)
`

describe('parseGameCenter', () => {
  const spiele = parseGameCenter(SEITE, '909660/98')

  it('liest jede Begegnung und ignoriert die Navigation', () => {
    expect(spiele).toHaveLength(3)
  })

  it('nimmt die erstgenannte Mannschaft als Heimteam', () => {
    expect(spiele[0]?.heim).toBe('BTV Aarau')
    expect(spiele[0]?.gast).toBe('Sm`Aesch Pfeffingen')
    expect(spiele[1]?.heim).toBe('Sm`Aesch Pfeffingen')
    expect(spiele[1]?.gast).toBe('Infomaniak Genève Volley')
  })

  it('setzt das Datum aus dem deutschen Monatsnamen zusammen', () => {
    expect(spiele[0]?.datum).toBe('2026-10-10T20:00:00')
    expect(spiele[2]?.datum).toBe('2026-10-31T17:30:00')
  })

  // The venue is glued to the kick-off time with no separator.
  it('trennt den Ort von der Uhrzeit', () => {
    expect(spiele[0]?.ort).toBe('Aarau')
    expect(spiele[2]?.ort).toBe('Düdingen')
  })

  // Every fixture is still to be played; the page shows an em dash.
  it('laesst das Resultat offen, solange nur ein Gedankenstrich dasteht', () => {
    expect(
      spiele.every((s) => s.toreHeim === null && s.toreGast === null)
    ).toBe(true)
  })

  it('vertraegt eine Seite ohne Begegnungen', () => {
    expect(
      parseGameCenter('nur Navigation, keine Spiele', '909660/98')
    ).toEqual([])
  })

  it('ueberspringt einen Kopf ohne zwei Mannschaften', () => {
    expect(
      parseGameCenter(
        'Samstag, 10. Oktober 2026, 20:00Aarau\n\nBTV Aarau—',
        '1/1'
      )
    ).toEqual([])
  })

  it('ueberspringt einen unbekannten Monat', () => {
    expect(
      parseGameCenter(
        'Samstag, 10. Foobar 2026, 20:00X\n\nA Team—\n\nB Team',
        '1/1'
      )
    ).toEqual([])
  })
})

describe('spielSchluessel', () => {
  // Keyed on the pairing, not the date: a postponed match keeps its teams, and
  // keying on the date would file the new date as a second phantom fixture.
  it('bleibt gleich, wenn ein Spiel verschoben wird', () => {
    const a = spielSchluessel('909660/98', 'BTV Aarau', 'Sm`Aesch Pfeffingen')
    const b = spielSchluessel('909660/98', 'BTV Aarau', 'Sm`Aesch Pfeffingen')
    expect(a).toBe(b)
  })

  it('haelt Hin- und Rueckspiel auseinander', () => {
    expect(spielSchluessel('909660/98', 'A', 'B')).not.toBe(
      spielSchluessel('909660/98', 'B', 'A')
    )
  })

  it('macht aus Akzent und Apostroph einen sauberen Schluessel', () => {
    expect(
      spielSchluessel('909660/98', 'Volley Düdingen', 'Sm`Aesch Pfeffingen')
    ).toBe('sv-909660-98-volley-dudingen-vs-sm-aesch-pfeffingen')
  })
})
