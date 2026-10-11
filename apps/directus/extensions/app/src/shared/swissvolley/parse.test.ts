import { describe, expect, it } from 'vitest'
import { parseGameCenter, spielSchluessel } from './parse'

// One logo address, as the page prints them: the parentheses inside the path
// are real and are what a naive image regex trips over.
const LOGO =
  'https://www.volleyball.ch/_images-volleymanager/C4MAd5mooz5EvHy7AHu-Bw4-X2k=/300x0/filters:format(webp):quality(80)/_Resources/Persistent/1689844be562c9ce42e340ce354e315941385160'

// Verbatim from the Game Center page of Sm'Aesch Pfeffingen (club 909660,
// team 98) as the crawler rendered it on 11 October 2026, the day after the
// first match of the season — including the navigation the page wraps around
// the fixture list. The upcoming matches arrive TWICE (three plain lines
// each, then one long link each); the played match arrives only as a link,
// its set result glued to the venue. Two of the six upcoming matches are
// kept; the logo addresses are shortened to one.
const SEITE = `
Informationen für:[Teams](https://www.volleyball.ch/de/wissen/cat/fuer-teams)VolleyManager

Sonntag, 18. Oktober 2026, 16:00Aesch

Sm\`Aesch Pfeffingen—

Infomaniak Genève Volley

Samstag, 31. Oktober 2026, 17:30Düdingen

Volley Düdingen—

Sm\`Aesch Pfeffingen

## Weitere Inhalte (Footer/Sidebar)

Swiss VolleyInformationen für:[Medien](https://www.volleyball.ch/de/medien)
FR# Sm\\\`Aesch Pfeffingen
[Home](https://www.volleyball.ch/de)›[Game Center](https://www.volleyball.ch/de/game-center)›Sm\\\`Aesch PfeffingenTeam: Sm\\\`Aesch Pfeffingen (NLA, F)Ergebnisse \\& SpielplanTeam## Kommende Spiele der Saison 2026/2027
Alle kommenden Spiele anzeigen[Sonntag, 18\\. Oktober 2026, 16:00Aesch![Sm\`Aesch Pfeffingen](${LOGO}/21061_Sm%60Aesch%20Pfeffingen.png%3Fv=1695295964)Sm\\\`Aesch Pfeffingen—![Infomaniak Genève Volley](${LOGO}/19709_Gen%C3%A8ve%20Volley.png%3Fv=1655379420)Infomaniak Genève Volley](https://www.volleyball.ch/de/game-center/game/400978)[Samstag, 31\\. Oktober 2026, 17:30Düdingen![Volley Düdingen](${LOGO}/20265_Volley%20D%C3%BCdingen.png%3Fv=1655712429)Volley Düdingen—![Sm\`Aesch Pfeffingen](${LOGO}/21061_Sm%60Aesch%20Pfeffingen.png%3Fv=1695295964)Sm\\\`Aesch Pfeffingen](https://www.volleyball.ch/de/game-center/game/400987)Alle kommenden Spiele anzeigen[Alle angesetzten Spiele dieses Teams im Kalender speichern (ICS)](https://volleymanager.volleyball.ch/iCal/schedule/2229c26ca02c8a8f4c256fd2bd957b9f7a1b16f7)## Letzte Ergebnisse der Saison 2026/2027
[Samstag, 10\\. Oktober 2026, 20:00Aarau2318:2525:2010:2525:2213:15![BTV Aarau](${LOGO}/21127_BTV%20Aarau.png%3Fv=1725617399)BTV Aarau—![Sm\`Aesch Pfeffingen](${LOGO}/21061_Sm%60Aesch%20Pfeffingen.png%3Fv=1695295964)Sm\\\`Aesch Pfeffingen](https://www.volleyball.ch/de/game-center/game/400971)Premium Partner
`

describe('parseGameCenter', () => {
  const { begegnungen: spiele, unlesbar } = parseGameCenter(SEITE, '909660/98')
  const gespielt = spiele.find((s) => s.datum.startsWith('2026-10-10'))

  it('liest jede Begegnung einmal, obwohl die kommenden doppelt dastehen', () => {
    expect(spiele).toHaveLength(3)
    expect(unlesbar).toBe(0)
  })

  it('liest das gespielte Spiel aus «Letzte Ergebnisse» — in Saetzen', () => {
    expect(gespielt).toMatchObject({
      datum: '2026-10-10T20:00:00',
      heim: 'BTV Aarau',
      gast: "Sm'Aesch Pfeffingen",
      ort: 'Aarau',
      toreHeim: 2,
      toreGast: 3,
      saetze: ['18:25', '25:20', '10:25', '25:22', '13:15']
    })
  })

  // The row was stored while the match was upcoming, under the plain form's
  // key — the result has to land on that row, not beside it.
  it('traegt das Resultat unter dem Schluessel der gespeicherten Ansetzung', () => {
    expect(gespielt?.schluessel).toBe(
      'sv-909660-98-btv-aarau-vs-sm-aesch-pfeffingen'
    )
    expect(gespielt?.schluessel).toBe(
      spielSchluessel('909660/98', 'BTV Aarau', 'Sm`Aesch Pfeffingen')
    )
  })

  it('nimmt die erstgenannte Mannschaft als Heimteam', () => {
    expect(spiele[0]?.heim).toBe("Sm'Aesch Pfeffingen")
    expect(spiele[0]?.gast).toBe('Infomaniak Genève Volley')
    expect(spiele[1]?.heim).toBe('Volley Düdingen')
    expect(spiele[1]?.gast).toBe("Sm'Aesch Pfeffingen")
  })

  it('setzt das Datum aus dem deutschen Monatsnamen zusammen', () => {
    expect(spiele[0]?.datum).toBe('2026-10-18T16:00:00')
    expect(spiele[1]?.datum).toBe('2026-10-31T17:30:00')
  })

  // The venue is glued to the kick-off time with no separator.
  it('trennt den Ort von der Uhrzeit', () => {
    expect(spiele[0]?.ort).toBe('Aesch')
    expect(spiele[1]?.ort).toBe('Düdingen')
  })

  // An unplayed fixture shows an em dash; nothing is read into it.
  it('laesst das Resultat offen, solange nur ein Gedankenstrich dasteht', () => {
    expect(spiele[0]).toMatchObject({
      toreHeim: null,
      toreGast: null,
      saetze: []
    })
    expect(spiele[1]).toMatchObject({
      toreHeim: null,
      toreGast: null,
      saetze: []
    })
  })

  // The page prints a typewriter backtick; the club and the newsroom write an
  // apostrophe, and that is what the row and the article carry.
  it('schreibt den Apostroph des Vereins, nicht den Backtick der Seite', () => {
    expect(spiele.map((s) => `${s.heim}|${s.gast}`).join(' ')).not.toContain(
      '`'
    )
  })

  it('bevorzugt die Lesart mit Resultat, wenn ein Spiel in beiden Formen steht', () => {
    const seite = [
      'Samstag, 10. Oktober 2026, 20:00Aarau',
      '',
      'BTV Aarau—',
      '',
      'Sm`Aesch Pfeffingen',
      '',
      `[Samstag, 10\\. Oktober 2026, 20:00Aarau2318:2525:2010:2525:2213:15![a](${LOGO}/a.png)BTV Aarau—![b](${LOGO}/b.png)Sm\\\`Aesch Pfeffingen](https://www.volleyball.ch/de/game-center/game/400971)`
    ].join('\n')
    const { begegnungen } = parseGameCenter(seite, '909660/98')
    expect(begegnungen).toHaveLength(1)
    expect(begegnungen[0]).toMatchObject({ toreHeim: 2, toreGast: 3 })
  })

  // Should the plain form ever carry a result, it is read the same way.
  it('liest ein Resultat auch in der dreizeiligen Form', () => {
    const { begegnungen } = parseGameCenter(
      'Samstag, 10. Oktober 2026, 20:00Aarau2318:2525:2010:2525:2213:15\n\nBTV Aarau—\n\nSm`Aesch Pfeffingen',
      '909660/98'
    )
    expect(begegnungen[0]).toMatchObject({
      ort: 'Aarau',
      toreHeim: 2,
      toreGast: 3
    })
  })

  // A trailing digit is part of the name — «VBC Aesch 2» is a second team,
  // not a score. The old parser read it as one.
  it('liest keine Ziffer im Teamnamen als Resultat', () => {
    const { begegnungen } = parseGameCenter(
      'Samstag, 10. Oktober 2026, 20:00Aesch\n\nVBC Aesch 2—\n\nVBC Laufen 3',
      '1/1'
    )
    expect(begegnungen[0]).toMatchObject({
      heim: 'VBC Aesch 2',
      gast: 'VBC Laufen 3',
      toreHeim: null,
      toreGast: null
    })
  })

  it('vertraegt eine Seite ohne Begegnungen', () => {
    expect(
      parseGameCenter('nur Navigation, keine Spiele', '909660/98')
    ).toEqual({ begegnungen: [], unlesbar: 0 })
  })

  it('ueberspringt einen Kopf ohne zwei Mannschaften', () => {
    expect(
      parseGameCenter(
        'Samstag, 10. Oktober 2026, 20:00Aarau\n\nBTV Aarau—',
        '1/1'
      ).begegnungen
    ).toEqual([])
  })

  it('ueberspringt einen unbekannten Monat', () => {
    expect(
      parseGameCenter(
        'Samstag, 10. Foobar 2026, 20:00X\n\nA Team—\n\nB Team',
        '1/1'
      ).begegnungen
    ).toEqual([])
  })

  // A match the page links that no reading explains is counted, never
  // silently dropped: a missing result looks just like a match not played.
  it('zaehlt einen Spiel-Link, der nicht lesbar ist', () => {
    const { begegnungen, unlesbar } = parseGameCenter(
      `[Samstag, 10\\. Foobar 2026, 20:00X![a](${LOGO}/a.png)A Team—![b](${LOGO}/b.png)B Team](https://www.volleyball.ch/de/game-center/game/5)`,
      '1/1'
    )
    expect(begegnungen).toEqual([])
    expect(unlesbar).toBe(1)
  })
})

describe('Satzresultat', () => {
  // The result and the set scores are glued to the venue without a separator.
  const link = (rest: string) =>
    `[Samstag, 10\\. Oktober 2026, 20:00${rest}![a](${LOGO}/a.png)Heim Team—![b](${LOGO}/b.png)Gast Team](https://www.volleyball.ch/de/game-center/game/1)`

  const lies = (rest: string) => parseGameCenter(link(rest), '1/1')

  it('liest einen Dreisatzsieg', () => {
    const { begegnungen, unlesbar } = lies('Aesch3025:2025:1825:23')
    expect(unlesbar).toBe(0)
    expect(begegnungen[0]).toMatchObject({
      ort: 'Aesch',
      toreHeim: 3,
      toreGast: 0,
      saetze: ['25:20', '25:18', '25:23']
    })
  })

  // 25:8 — one digit on one side. Only one tokenisation tallies with 3:0.
  it('liest einen einstelligen Satzstand, weil nur eine Lesart aufgeht', () => {
    const { begegnungen, unlesbar } = lies('Aesch3025:825:2025:18')
    expect(unlesbar).toBe(0)
    expect(begegnungen[0]).toMatchObject({
      toreHeim: 3,
      toreGast: 0,
      saetze: ['25:8', '25:20', '25:18']
    })
  })

  it('haelt eine Ziffer am Ende des Spielorts vom Resultat auseinander', () => {
    const { begegnungen } = lies('Halle 23025:2025:1825:23')
    expect(begegnungen[0]).toMatchObject({
      ort: 'Halle 2',
      toreHeim: 3,
      toreGast: 0
    })
  })

  // 3:0 with two set scores does not add up — left open and counted rather
  // than guessed.
  it('laesst ein Resultat offen, das nicht aufgeht, und zaehlt es', () => {
    const { begegnungen, unlesbar } = lies('Aesch3025:2025:18')
    expect(unlesbar).toBe(1)
    expect(begegnungen[0]).toMatchObject({
      ort: 'Aesch',
      toreHeim: null,
      toreGast: null,
      saetze: []
    })
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
    // Backtick and apostrophe fold to the same key — the stored rows carry the
    // page's spelling, the new reads the club's.
    expect(
      spielSchluessel('909660/98', 'BTV Aarau', "Sm'Aesch Pfeffingen")
    ).toBe(spielSchluessel('909660/98', 'BTV Aarau', 'Sm`Aesch Pfeffingen'))
  })
})
