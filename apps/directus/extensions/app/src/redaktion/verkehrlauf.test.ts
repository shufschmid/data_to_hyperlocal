import { describe, expect, it } from 'vitest'
import type { Anlage } from '../shared/verkehr'
import {
  blattBekannt,
  standortPlan,
  zuHolenKontrollen,
  type GespeicherterStandort
} from './verkehrlauf'

const anlage = (ueber: Partial<Anlage>): Anlage => ({
  art: 'semistationaer',
  kennung: 'SEMI 03',
  abWann: '2026-09-18',
  standort: '4123 Allschwil, Binningerstrasse',
  plz: '4123',
  ort: 'Allschwil',
  strasse: 'Binningerstrasse',
  geschwindigkeit: 50,
  oertlichkeit: 'Ein- / Ausfahrten',
  schluessel: 'semistationaer|4123-allschwil-binningerstrasse',
  ...ueber
})

const GEMEINDEN = [
  { id: 'g-allschwil', name: 'Allschwil', plz: '4123' },
  { id: 'g-binningen', name: 'Binningen', plz: '4102' }
]

const PDF =
  'https://bl-api.webcloud7.ch/x/20261007_kontrollanlagen-standortmitteilung-1.pdf?_t=1'

describe('standortPlan', () => {
  const augst = anlage({
    kennung: 'SEMI 01',
    abWann: '2026-09-25',
    standort: '4302 Augst, A2, FR Bern / Luzern',
    plz: '4302',
    ort: 'Augst',
    strasse: 'A2, FR Bern / Luzern',
    geschwindigkeit: 70,
    schluessel: 'semistationaer|4302-augst-a2-fr-bern-luzern'
  })
  const binningen = anlage({
    art: 'stationaer',
    kennung: null,
    abWann: null,
    standort: '4102 Binningen, Bottmingerstrasse',
    plz: '4102',
    ort: 'Binningen',
    strasse: 'Bottmingerstrasse',
    schluessel: 'stationaer|4102-binningen-bottmingerstrasse'
  })

  // The newsroom's rule: a Meldung when an installation is recognised at a
  // NEW location in the municipality. Everything else is stored, nothing
  // proposed; a location the sheet dropped is marked, not deleted.
  it('schlaegt nur neue Standorte in bespielten Gemeinden vor, speichert alle, legt verschwundene still', () => {
    const bestand: GespeicherterStandort[] = [
      {
        id: 'alt-binningen',
        schluessel: binningen.schluessel,
        gemeinde: 'g-binningen',
        aktiv: true,
        quelle_url: 'https://bl-api.webcloud7.ch/x/20260901_alt.pdf'
      },
      {
        id: 'alt-weg',
        schluessel: 'semistationaer|4410-liestal-rheinstrasse',
        gemeinde: null,
        aktiv: true,
        quelle_url: 'https://bl-api.webcloud7.ch/x/20260901_alt.pdf'
      }
    ]
    const plan = standortPlan({
      anlagen: [augst, anlage({}), binningen],
      bestand,
      gemeinden: GEMEINDEN,
      heute: '2026-10-11',
      pdfUrl: PDF,
      publiziertAm: '2026-10-07'
    })
    expect(
      plan.neu.map((n) => [n.anlage.standort, n.gemeinde, n.vorschlag])
    ).toEqual([
      ['4302 Augst, A2, FR Bern / Luzern', null, false],
      ['4123 Allschwil, Binningerstrasse', 'g-allschwil', true]
    ])
    expect(plan.neu[1]?.begruendung).toBe(
      'Neue semistationaere Anlage in Allschwil: 4123 Allschwil, Binningerstrasse, ab 18. September 2026.'
    )
    expect(plan.aktualisieren).toEqual([
      {
        id: 'alt-binningen',
        felder: expect.objectContaining({
          aktiv: true,
          zuletzt_gesehen: '2026-10-11',
          quelle_url: PDF,
          publikation_am: '2026-10-07',
          gemeinde: 'g-binningen'
        })
      }
    ])
    expect(plan.stilllegen).toEqual(['alt-weg'])
    expect(plan.hinweise[0]).toBe(
      'Radaranlagen: 3 Standorte auf dem Blatt vom 7. Oktober 2026, 2 neu, davon 1 in bespielten Gemeinden; 1 nicht mehr aufgefuehrt.'
    )
  })

  it('erkennt ein schon gelesenes Blatt an seiner Adresse auf den Zeilen', () => {
    expect(blattBekannt([{ quelle_url: PDF }], PDF)).toBe(true)
    expect(
      blattBekannt(
        [{ quelle_url: 'https://bl-api.webcloud7.ch/x/alt.pdf' }],
        PDF
      )
    ).toBe(false)
    expect(blattBekannt([], PDF)).toBe(false)
  })
})

describe('zuHolenKontrollen', () => {
  const ausgaben = [
    {
      jahr: 2026,
      monat: 9,
      url: 'https://www.reinach-bl.ch/r/009-September-2026.pdf'
    },
    {
      jahr: 2026,
      monat: 8,
      url: 'https://www.reinach-bl.ch/r/008-August-2026.pdf'
    },
    {
      jahr: 2026,
      monat: 7,
      url: 'https://www.reinach-bl.ch/r/007-Juli-2026.pdf'
    }
  ]

  it('holt, was fehlt oder umgezogen ist, neueste zuerst, und nennt den Deckel', () => {
    const plan = zuHolenKontrollen(ausgaben, [
      { id: 'a', jahr: 2026, monat: 8, url: '' } as never,
      {
        id: 'b',
        jahr: 2026,
        monat: 7,
        quelle_url: 'https://www.reinach-bl.ch/r/007-Juli-2026.pdf'
      }
    ])
    expect(plan.holen.map((a) => a.monat)).toEqual([9, 8])
    expect(plan.hinweise).toEqual([])

    const gedeckelt = zuHolenKontrollen(ausgaben, [], 2)
    expect(gedeckelt.holen.map((a) => a.monat)).toEqual([9, 8])
    expect(gedeckelt.hinweise).toEqual([
      'Geschwindigkeitskontrollen: 2 von 3 Monatsblaettern gelesen (Deckel 2), der Rest beim naechsten Lauf.'
    ])
  })
})
