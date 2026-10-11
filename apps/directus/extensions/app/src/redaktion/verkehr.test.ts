import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseKontrollblatt, zusammenfassung } from '../shared/verkehr'
import {
  buildKontrollenPrompt,
  buildKontrollenRevision,
  buildRadarPrompt,
  buildRadarRevision,
  datengrundlageKontrollen,
  datengrundlageRadar,
  KONTROLLEN_SYSTEM_PROMPT,
  kontrollenAttributionsWarnung,
  kontrollenQuelleZeile,
  mitQuelle,
  ohneQuelle,
  polizeiAttributionsWarnung,
  RADAR_SYSTEM_PROMPT,
  radarQuelleZeile,
  zahlWarnungenVerkehr,
  type KontrollenFakten,
  type RadarFakten
} from './verkehr'

// The first real case: SEMI 03 in Allschwil, on the sheet of 7 October 2026.
const RADAR: RadarFakten = {
  gemeinde: 'Allschwil',
  art: 'semistationaer',
  kennung: 'SEMI 03',
  abWann: '2026-09-18',
  standort: '4123 Allschwil, Binningerstrasse',
  plz: '4123',
  ort: 'Allschwil',
  strasse: 'Binningerstrasse',
  geschwindigkeit: 50,
  oertlichkeit: 'Ein- / Ausfahrten',
  publiziertAm: '2026-10-07',
  weitereInGemeinde: [],
  seiteUrl:
    'https://www.baselland.ch/politik-und-behorden/direktionen/sicherheitsdirektion/polizei/standorte-radaranlagen'
}

describe('Radar-Meldung', () => {
  const prompt = buildRadarPrompt(RADAR)

  it('der System-Prompt nennt keine Gemeinde und verlangt Polizei, absolute Daten und keine Links', () => {
    expect(RADAR_SYSTEM_PROMPT).not.toContain('Allschwil')
    expect(RADAR_SYSTEM_PROMPT).toContain('Polizei Basel-Landschaft')
    expect(RADAR_SYSTEM_PROMPT).toContain('absolut und mit Jahr')
    expect(RADAR_SYSTEM_PROMPT).toContain('keinen Link')
    expect(RADAR_SYSTEM_PROMPT).toContain('versetzt')
  })

  it('reicht Standort, Limite, Tag und den Stand der Liste als Angaben durch', () => {
    expect(prompt).toContain('Gemeinde: Allschwil')
    // Real umlauts in what the model copies: the first live draft carried
    // «semistationaere» and «Hoechstgeschwindigkeit» out of ASCII facts.
    expect(prompt).toContain(
      'Art: semistationäre Anlage (verschiebbar), Kennung SEMI 03'
    )
    expect(prompt).toContain(
      'Standort laut Polizei: 4123 Allschwil, Binningerstrasse'
    )
    expect(prompt).toContain('Signalisierte Höchstgeschwindigkeit: 50 km/h')
    expect(prompt).toContain('Örtlichkeit: Ein- / Ausfahrten')
    expect(RADAR_SYSTEM_PROMPT).toContain('Umlaute als ä, ö, ü')
    expect(prompt).toContain('In Betrieb ab: 18. September 2026')
    expect(prompt).toContain(
      'Stand der Standortliste der Polizei: 7. Oktober 2026'
    )
    expect(prompt).toContain('keine weitere Anlage')
    const mitWeiteren = buildRadarPrompt({
      ...RADAR,
      weitereInGemeinde: [
        {
          standort: '4123 Allschwil, Baslerstrasse',
          art: 'stationaer',
          abWann: null
        }
      ]
    })
    expect(mitWeiteren).toContain(
      'Weitere Anlagen der Polizei Basel-Landschaft in Allschwil laut derselben Liste (1):'
    )
    expect(mitWeiteren).toContain(
      '- 4123 Allschwil, Baslerstrasse (stationäre Anlage (fest installiert))'
    )
  })

  it('traegt bei der Revision den bisherigen Text und die Anweisung mit', () => {
    const revision = buildRadarRevision(
      RADAR,
      { titel: 'Blitzer', lead: 'Lead.', text: 'Text.' },
      'Kuerzer.',
      ['Keine Abkuerzungen.']
    )
    expect(revision).toContain('Bisherige Meldung:')
    expect(revision).toContain('Anweisung der Redaktion:\nKuerzer.')
    expect(revision).toContain('- Keine Abkuerzungen.')
  })

  it('prueft die Attribution an die Polizei und die Ziffern gegen die Angaben', () => {
    expect(
      polizeiAttributionsWarnung('Wie die Polizei Basel-Landschaft mitteilt, …')
    ).toBeNull()
    expect(
      polizeiAttributionsWarnung('Die Kantonspolizei stellt einen Blitzer auf.')
    ).toBeNull()
    expect(
      polizeiAttributionsWarnung('An der Binningerstrasse wird gemessen.')
    ).toBe(
      'Die Meldung nennt die Polizei Basel-Landschaft nicht als Quelle der Angabe.'
    )
    expect(
      zahlWarnungenVerkehr(
        'Seit dem 18. September 2026 misst in 4123 Allschwil eine Anlage bei 50 km/h; Stand 7. Oktober 2026.',
        RADAR
      )
    ).toEqual([])
    expect(
      zahlWarnungenVerkehr('Die dritte Anlage im Kanton, 120 Bussen.', RADAR)
    ).toEqual(['Zahl "120" steht nicht in den Angaben.'])
  })

  it('baut die Quellenzeile auf die oeffentliche Seite, nie auf das PDF der Datentuer', () => {
    const zeile = radarQuelleZeile(RADAR)
    expect(zeile).toBe(
      'Quelle: Polizei Basel-Landschaft, Standorte von automatischen Kontrollanlagen (Stand 7. Oktober 2026), https://www.baselland.ch/politik-und-behorden/direktionen/sicherheitsdirektion/polizei/standorte-radaranlagen'
    )
    expect(zeile).not.toContain('bl-api')
    const text = mitQuelle('Ein Absatz.', zeile)
    expect(text).toBe(`Ein Absatz.\n\n${zeile}`)
    expect(ohneQuelle(text)).toBe('Ein Absatz.')
    expect(ohneQuelle(null)).toBeNull()
    expect(datengrundlageRadar(RADAR)).toMatchObject({
      quelle: 'radar_bl',
      quelle_name: 'Polizei Basel-Landschaft',
      url: RADAR.seiteUrl,
      ab_wann: '2026-09-18'
    })
  })
})

describe('Kontrollen-Meldung', () => {
  const blatt = parseKontrollblatt(
    readFileSync(
      join(
        __dirname,
        '..',
        'shared',
        'verkehr',
        'fixtures',
        'reinach-2026-09.txt'
      ),
      'utf8'
    )
  )
  const august = parseKontrollblatt(
    readFileSync(
      join(
        __dirname,
        '..',
        'shared',
        'verkehr',
        'fixtures',
        'reinach-2026-03.txt'
      ),
      'utf8'
    )
  )
  const FAKTEN: KontrollenFakten = {
    gemeinde: 'Reinach',
    polizei: 'Gemeindepolizei Reinach',
    jahr: 2026,
    monat: 9,
    stand: '2026-09-29',
    bilanz: zusammenfassung(blatt.kontrollen),
    messungen: august.messungen,
    vormonat: {
      jahr: 2026,
      monat: 3,
      bilanz: zusammenfassung(august.kontrollen)
    },
    hinweise: august.hinweise,
    quelleUrl:
      'https://www.reinach-bl.ch/wAssets/docs/08-Schutz-und-Sicherheit/Radarkontrollen/009-September-2026.pdf'
  }
  const prompt = buildKontrollenPrompt(FAKTEN)

  it('der System-Prompt verbietet eigenes Rechnen und verlangt die Gemeindepolizei als Quelle', () => {
    expect(KONTROLLEN_SYSTEM_PROMPT).toContain('Rechne nichts selbst aus')
    expect(KONTROLLEN_SYSTEM_PROMPT).toContain('laut Gemeindepolizei Reinach')
    expect(KONTROLLEN_SYSTEM_PROMPT).toContain('absolut und mit Jahr')
    expect(KONTROLLEN_SYSTEM_PROMPT).not.toContain('Aesch')
  })

  it('reicht die vom Code gerechnete Bilanz vollstaendig durch — Summen, meiste Uebertretungen, Schnellster, jeder Messort', () => {
    expect(prompt).toContain('Monat: September 2026')
    expect(prompt).toContain('Datum des Blatts: 29. September 2026')
    expect(prompt).toContain('Kontrollen im Monat: 9')
    expect(prompt).toContain('Gemessene Fahrzeuge insgesamt: 738')
    expect(prompt).toContain(
      'Uebertretungen insgesamt: 157 (21,3 Prozent der gemessenen Fahrzeuge)'
    )
    expect(prompt).toContain(
      'Messort mit den meisten Uebertretungen: Hinterkirchweg — 35 von 99 gemessenen Fahrzeugen (35,4 Prozent), 1 Kontrolle'
    )
    expect(prompt).toContain(
      'Schnellstes gemessenes Fahrzeug: 48 km/h bei signalisierten 30 km/h, Hinterlindenweg, am 8. September 2026, Zeitfenster 07.12 bis 08.48 Uhr'
    )
    expect(prompt).toContain(
      '- Aumattstrasse: 5 von 67 (7,5 Prozent), 1 Kontrolle'
    )
    expect(prompt).toContain('Messungen des Verkehrsstatistikgeraets SR7')
    expect(prompt).toContain(
      '- Jupiterstrasse, 27. Februar 2026 bis 26. März 2026: 27895 Fahrzeuge gemessen, signalisiert 30 km/h, V85 25,5 km/h'
    )
    expect(prompt).toContain('Vormonat März 2026 (nur zum Vergleich):')
    expect(prompt).toContain('Befunde der Redaktion zum Blatt')
    expect(prompt).toContain('nennt Januar 2026')
  })

  it('prueft Attribution und Ziffern', () => {
    expect(
      kontrollenAttributionsWarnung(
        'Laut Gemeindepolizei Reinach wurden 738 Fahrzeuge gemessen.',
        FAKTEN
      )
    ).toBeNull()
    expect(
      kontrollenAttributionsWarnung('Die Gemeinde Reinach meldet …', FAKTEN)
    ).toBeNull()
    expect(
      kontrollenAttributionsWarnung('738 Fahrzeuge wurden gemessen.', FAKTEN)
    ).toBe(
      'Die Meldung nennt die Gemeindepolizei Reinach nicht als Quelle der Zahlen.'
    )
    expect(
      zahlWarnungenVerkehr(
        'Im September 2026 kontrollierte die Gemeindepolizei Reinach an 9 Tagen 738 Fahrzeuge; 157 waren zu schnell, 21,3 Prozent. Am 8. September 2026 wurde am Hinterlindenweg zwischen 7.12 und 8.48 Uhr ein Auto mit 48 km/h gemessen, erlaubt sind 30.',
        FAKTEN
      )
    ).toEqual([])
    expect(zahlWarnungenVerkehr('Das sind 999 Franken Busse.', FAKTEN)).toEqual(
      ['Zahl "999" steht nicht in den Angaben.']
    )
  })

  it('baut Quellenzeile und Datengrundlage mit dem Monats-PDF', () => {
    expect(kontrollenQuelleZeile(FAKTEN)).toBe(
      'Quelle: Gemeindepolizei Reinach, Geschwindigkeitskontrollen September 2026 (PDF), https://www.reinach-bl.ch/wAssets/docs/08-Schutz-und-Sicherheit/Radarkontrollen/009-September-2026.pdf'
    )
    expect(datengrundlageKontrollen(FAKTEN)).toMatchObject({
      quelle: 'geschwindigkeitskontrollen',
      quelle_name: 'Gemeinde Reinach',
      url: FAKTEN.quelleUrl,
      jahr: 2026,
      monat: 9
    })
    expect(
      buildKontrollenRevision(
        FAKTEN,
        { titel: 'T', lead: 'L', text: 'X' },
        'Kuerzer.'
      )
    ).toContain('Anweisung der Redaktion:\nKuerzer.')
  })
})
