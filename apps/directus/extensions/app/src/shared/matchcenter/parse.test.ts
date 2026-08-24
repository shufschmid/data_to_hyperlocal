import { describe, expect, it } from 'vitest'
import {
  istInteressant,
  ordneVereinZu,
  parseVereinsseite,
  parseWhatsOn
} from './parse'

// Verbatim from the FVNWS "what's on" page, 17 August 2026 — including the
// duplicated competition/Spielnummer block the page really emits.
const SEITE = `
# Match center
#### FVNWS - what's on - Aktuelle Spiele
Mo 17.08.2026
20:00
FC Liestal (3.)
FC Polizei Basel (5.)
Stadion Gitterli, Liestal - 1
Cup - Basler Cup - Runde 2
Spielnummer 513283
Cup - Basler Cup - Runde 2
Spielnummer 513283
20:00
FC Amicitia Riehen
SV Sissach
Grendelmatte, Riehen - wird vor Ort zugeteilt
Meisterschaft - Senioren 50+/7 / Vorrunde / Gruppe 1
Spielnummer 146159
Meisterschaft - Senioren 50+/7 / Vorrunde / Gruppe 1
Spielnummer 146159
20:15
FC Allschwil
HNK Croatia Basel
G
Im Brüel, Allschwil, - 2
nicht gespielt (Gegner)
Meisterschaft - Senioren 50+/7 / Vorrunde / Gruppe 1
Spielnummer 146158
Di 18.08.2026
20:00
FC Möhlin-Riburg/ACLI
FC Pratteln
Sportzentrum Steinli, Möhlin - wird vor Ort zugeteilt
Meisterschaft - 5. Liga / Vorrunde / Gruppe 1
Spielnummer 143734
`

describe('parseWhatsOn', () => {
  const spiele = parseWhatsOn(SEITE)

  it('liest jede Begegnung genau einmal', () => {
    expect(spiele.map((s) => s.spielnummer)).toEqual([
      '513283',
      '146159',
      '146158',
      '143734'
    ])
  })

  // The venue always sits at the first-named team's ground — that is what
  // establishes playing order, and a reversed scoreline is the bug this avoids.
  it('nimmt die erstgenannte Mannschaft als Heimteam', () => {
    const liestal = spiele.find((s) => s.spielnummer === '513283')
    expect(liestal?.heim).toBe('FC Liestal (3.)')
    expect(liestal?.gast).toBe('FC Polizei Basel (5.)')
    expect(liestal?.ort).toBe('Stadion Gitterli, Liestal - 1')
  })

  it('setzt Datum und Zeit aus der Tagesueberschrift zusammen', () => {
    expect(spiele.find((s) => s.spielnummer === '143734')?.datum).toBe(
      '2026-08-18T20:00:00'
    )
  })

  it('behaelt den Tag ueber mehrere Begegnungen hinweg', () => {
    expect(spiele.find((s) => s.spielnummer === '146159')?.datum).toBe(
      '2026-08-17T20:00:00'
    )
  })

  it('erkennt einen Vermerk statt eines Resultats', () => {
    const forfait = spiele.find((s) => s.spielnummer === '146158')
    expect(forfait?.status).toBe('nicht gespielt (Gegner)')
    expect(forfait?.heim).toBe('FC Allschwil')
    expect(forfait?.gast).toBe('HNK Croatia Basel')
  })

  // Every fixture on this page is still to be played.
  it('laesst das Resultat offen, solange keines dasteht', () => {
    expect(
      spiele.every((s) => s.toreHeim === null && s.toreGast === null)
    ).toBe(true)
  })

  it('liest ein Resultat, wenn beide Zahlen dastehen', () => {
    const gespielt = parseWhatsOn(`
Sa 15.08.2026
16:00
FC Aesch
FC Therwil
Löhrenacker, Aesch - 1
3
1
Meisterschaft - 3. Liga / Vorrunde / Gruppe 2
Spielnummer 143900
`)
    expect(gespielt[0]?.toreHeim).toBe(3)
    expect(gespielt[0]?.toreGast).toBe(1)
  })

  // A lone number is a group or a table position, never a result.
  it('haelt eine einzelne Zahl nicht fuer ein Resultat', () => {
    const halb = parseWhatsOn(`
Sa 15.08.2026
16:00
FC Aesch
FC Therwil
Löhrenacker, Aesch - 1
3
Meisterschaft - 3. Liga / Vorrunde / Gruppe 2
Spielnummer 143901
`)
    expect(halb[0]?.toreHeim).toBeNull()
    expect(halb[0]?.toreGast).toBeNull()
  })

  it('ueberspringt einen Eintrag ohne zwei Mannschaften', () => {
    expect(
      parseWhatsOn(`
Sa 15.08.2026
16:00
FC Aesch
Meisterschaft - 3. Liga / Vorrunde
Spielnummer 999999
`)
    ).toEqual([])
  })

  it('vertraegt eine leere Seite', () => {
    expect(parseWhatsOn('')).toEqual([])
  })
})

describe('istInteressant', () => {
  it('nimmt die Aktivligen und den Cup', () => {
    expect(
      istInteressant('Meisterschaft - 5. Liga / Vorrunde / Gruppe 1')
    ).toBe(true)
    expect(istInteressant('2. Liga interregional')).toBe(true)
    expect(istInteressant('Meisterschaft - Frauen 3. Liga / Vorrunde')).toBe(
      true
    )
    expect(istInteressant('Cup - Basler Cup - Runde 2')).toBe(true)
  })

  // One club page carried 39 matches, of which four were reportable.
  it('laesst Nachwuchs, Senioren und Testspiele weg', () => {
    expect(
      istInteressant('Meisterschaft - Junioren B 1. Stärkeklasse / Herbstrunde')
    ).toBe(false)
    expect(istInteressant('Cup - Juniorinnen FF-17 Cup - Runde 1')).toBe(false)
    expect(
      istInteressant('Meisterschaft - Senioren 40+ Meister / Vorrunde')
    ).toBe(false)
    expect(istInteressant('Cup - Senioren 30+ Cup - Runde 1')).toBe(false)
    expect(istInteressant('Trainingsspiele')).toBe(false)
    expect(istInteressant('SFFS Serie A')).toBe(false)
    expect(istInteressant('Walking Football')).toBe(false)
  })

  it('nimmt nichts, was gar keine Liga nennt', () => {
    expect(istInteressant('Meisterschaft - Grümpelturnier')).toBe(false)
  })
})

describe('ordneVereinZu', () => {
  const vereine = [
    { id: 'a', name: 'FC Pratteln' },
    { id: 'b', name: 'FC Arlesheim' },
    { id: 'c', name: "Sm'Aesch Pfeffingen" }
  ]
  const spiel = (heim: string, gast: string) => ({
    spielnummer: '1',
    datum: '2026-08-17T20:00:00',
    heim,
    gast,
    ort: null,
    wettbewerb: 'Meisterschaft - 5. Liga',
    status: null,
    toreHeim: null,
    toreGast: null
  })

  it('findet den Verein als Heim- wie als Gastmannschaft', () => {
    expect(ordneVereinZu(spiel('FC Möhlin', 'FC Pratteln'), vereine)?.id).toBe(
      'a'
    )
    expect(ordneVereinZu(spiel('FC Pratteln', 'FC Möhlin'), vereine)?.id).toBe(
      'a'
    )
  })

  // The Match Center appends team suffixes to the club name.
  it('erkennt Mannschaftszusaetze', () => {
    expect(
      ordneVereinZu(spiel('FC Arlesheim b', 'FC Zwingen'), vereine)?.id
    ).toBe('b')
    expect(
      ordneVereinZu(spiel('FC Arlesheim (Sen.30+/M)', 'FC Liestal'), vereine)
        ?.id
    ).toBe('b')
  })

  it('stolpert nicht ueber Akzent und Apostroph', () => {
    expect(
      ordneVereinZu(spiel('Sm`Aesch Pfeffingen', 'Volley Düdingen'), vereine)
        ?.id
    ).toBe('c')
  })

  // "FC Prattelnbach" is a different club and must not attach to FC Pratteln.
  it('nimmt keinen Verein, der nur zufaellig gleich anfaengt', () => {
    expect(ordneVereinZu(spiel('FC Prattelnbach', 'FC X'), vereine)).toBeNull()
  })

  it('meldet nichts, wenn keiner unserer Vereine spielt', () => {
    expect(ordneVereinZu(spiel('FC Basel', 'FC Zürich'), vereine)).toBeNull()
  })
})

// Wortwoertlich von der Vereinsseite des FC Amicitia Riehen (v=478) am 20.08.,
// einen Tag nach dem Spiel. Der Gegner fehlt im Markdown, der Score nicht.
const VEREINSSEITE = `
# Verein
Teams: 31
#### Aktuelle Spiele
Mi 19.08.2026
20:00
FC Amicitia Riehen
3
3
Meisterschaft 2. Liga (FAEW)
Spielnummer 142793
Fiechten - 1, Reinach
Spielnummer 142793
Fiechten - 1, Reinach
20:30
FC Amicitia Riehen b (Jun.B 1/S)
3
0
Trainingsspiele
Spielnummer 704101
Grendelmatte, Riehen
Sa 22.08.2026
16:00
FC Amicitia Riehen
Meisterschaft 2. Liga (FAEW)
Spielnummer 146941
Schiffacker, Rheinfelden
`

describe('parseVereinsseite', () => {
  const resultate = parseVereinsseite(VEREINSSEITE)

  it('liest den Score zu jeder Spielnummer', () => {
    expect(resultate.find((r) => r.spielnummer === '142793')).toEqual({
      spielnummer: '142793',
      toreHeim: 3,
      toreGast: 3
    })
  })

  // Die Richtung ist heim:gast — im Browser lesen dieselben Zeilen
  // "FC Aesch a – SC Binningen b 0:6" und "SV Muttenz b – FC Aesch a 0:4".
  it('liest die Zahlen in Spielrichtung, nicht aus Sicht des Vereins', () => {
    const jun = resultate.find((r) => r.spielnummer === '704101')
    expect(jun?.toreHeim).toBe(3)
    expect(jun?.toreGast).toBe(0)
  })

  // Eine noch nicht gespielte Begegnung druckt keine Zahlen.
  it('ueberspringt eine Ansetzung ohne Resultat', () => {
    expect(resultate.some((r) => r.spielnummer === '146941')).toBe(false)
  })

  it('nimmt eine einzelne Zahl nicht fuer ein Resultat', () => {
    expect(
      parseVereinsseite(
        '20:00\nFC X\n3\nMeisterschaft 2. Liga\nSpielnummer 999'
      )
    ).toEqual([])
  })

  it('vertraegt eine leere Seite', () => {
    expect(parseVereinsseite('')).toEqual([])
  })
})
