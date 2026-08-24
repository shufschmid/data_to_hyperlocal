import { describe, expect, it } from 'vitest'
import { parseHandball, spielSchluessel } from './parse'

// Verbatim from the Match Center page of TV Pratteln NS (team 41131),
// including the repeated date line the first row emits.
const SEITE = `
Datum | Gruppe/Cup | Heim | Resultat | Gast | Halle | |||

Sa 29.08.26 18:002026-08-29T18:00:00.000Z |
Sa 29.08.26 18:002026-08-29T18:00:00.000Z
TV Pratteln NS 1 (M1)
GC Amicitia Zürich (M1)
0
-
0
(0
-
0)
|
|

So 06.09.26 13:002026-09-06T13:00:00.000Z

CS Chênois Genève Handball

TV Pratteln NS 1

0
-
0

(0
-
0)
`

describe('parseHandball', () => {
  const vorher = new Date('2026-08-01T00:00:00Z')
  const spiele = parseHandball(SEITE, '41131', vorher)

  it('liest jede Begegnung einmal, trotz doppelter Datumszeile', () => {
    expect(spiele).toHaveLength(2)
  })

  it('nimmt den ISO-Zeitpunkt der Seite', () => {
    expect(spiele[0]?.datum).toBe('2026-08-29T18:00:00Z')
    expect(spiele[1]?.datum).toBe('2026-09-06T13:00:00Z')
  })

  it('nimmt die erstgenannte Mannschaft als Heimteam', () => {
    expect(spiele[0]?.heim).toBe('TV Pratteln NS 1 (M1)')
    expect(spiele[0]?.gast).toBe('GC Amicitia Zürich (M1)')
    expect(spiele[1]?.heim).toBe('CS Chênois Genève Handball')
    expect(spiele[1]?.gast).toBe('TV Pratteln NS 1')
  })

  // The page prints 0 - 0 for a fixture that has not happened. Reading that as
  // a draw would invent a result.
  it('haelt das 0:0 einer kommenden Begegnung nicht fuer ein Resultat', () => {
    expect(
      spiele.every((s) => s.toreHeim === null && s.toreGast === null)
    ).toBe(true)
  })

  it('liest das Resultat, sobald die Begegnung vorbei ist', () => {
    const gespielt = parseHandball(
      `Sa 29.08.26 18:002026-08-29T18:00:00.000Z
TV Pratteln NS 1
GC Amicitia Zürich
28
-
25
(14
-
12)`,
      '41131',
      new Date('2026-08-30T00:00:00Z')
    )
    expect(gespielt[0]?.toreHeim).toBe(28)
    expect(gespielt[0]?.toreGast).toBe(25)
  })

  it('vertraegt eine Seite ohne Begegnungen', () => {
    expect(parseHandball('nur Navigation', '41131', vorher)).toEqual([])
  })

  it('ueberspringt eine Zeile ohne zwei Mannschaften', () => {
    expect(
      parseHandball(
        'Sa 29.08.26 18:002026-08-29T18:00:00.000Z\nNur ein Team',
        '41131',
        vorher
      )
    ).toEqual([])
  })
})

describe('spielSchluessel', () => {
  it('haelt Hin- und Rueckspiel auseinander', () => {
    expect(spielSchluessel('41131', 'A', 'B')).not.toBe(
      spielSchluessel('41131', 'B', 'A')
    )
  })

  it('macht aus Akzenten einen sauberen Schluessel', () => {
    expect(
      spielSchluessel('41131', 'CS Chênois Genève Handball', 'TV Pratteln NS 1')
    ).toBe('hb-41131-cs-chenois-geneve-handball-vs-tv-pratteln-ns-1')
  })
})
