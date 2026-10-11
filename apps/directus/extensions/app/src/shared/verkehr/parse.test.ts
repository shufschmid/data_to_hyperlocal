import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  downloadAdresse,
  monatAusDateiname,
  ordneGemeindeZu,
  parseKontrollblatt,
  parseKontrollseite,
  parseStandortblatt,
  publikationstagAus,
  standortblattLink,
  zerlegeStandort,
  zusammenfassung
} from './index'

// The text layers of the real sheets, as `extrahiereText` hands them over —
// the canton's sheet of 7 October 2026 and Reinach's September and March
// 2026 (the March one with the stale header and the SR7 table).
const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')

const GEMEINDEN = [
  { id: 'allschwil', name: 'Allschwil', plz: '4123' },
  { id: 'binningen', name: 'Binningen', plz: '4102' },
  { id: 'reinach', name: 'Reinach', plz: '4153' },
  { id: 'aesch', name: 'Aesch', plz: '4147' }
]

describe('parseStandortblatt', () => {
  const blatt = parseStandortblatt(fixture('standortmitteilung-20261007.txt'))

  it('liest jede Anlage des Blatts, semistationaere und stationaere, ohne Hinweis', () => {
    expect(blatt.hinweise).toEqual([])
    expect(
      blatt.anlagen.map((a) => `${a.art} ${a.kennung ?? '-'} ${a.standort}`)
    ).toEqual([
      'semistationaer SEMI 01 4302 Augst, A2, FR Bern / Luzern',
      'semistationaer SEMI 02 4460 Gelterkinden, Ergolzstrasse',
      'semistationaer SEMI 03 4123 Allschwil, Binningerstrasse',
      'semistationaer SEMI 04 4302 Augst, A3',
      'stationaer - A2/A3 Augst – Fahrtrichtung Basel',
      'stationaer - 4102 Binningen, Bottmingerstrasse'
    ])
  })

  it('nimmt Datum, Limite und Oertlichkeit mit — eine umgebrochene Oertlichkeit ganz', () => {
    const allschwil = blatt.anlagen[2]
    expect(allschwil).toMatchObject({
      abWann: '2026-09-18',
      plz: '4123',
      ort: 'Allschwil',
      strasse: 'Binningerstrasse',
      geschwindigkeit: 50,
      oertlichkeit: 'Ein- / Ausfahrten',
      schluessel: 'semistationaer|4123-allschwil-binningerstrasse'
    })
    const binningen = blatt.anlagen[5]
    expect(binningen).toMatchObject({
      abWann: null,
      kennung: null,
      geschwindigkeit: 50,
      oertlichkeit:
        'Innerorts, Altersheim, Lichtsignalanlage, Fussgängerstreifen, Einmündung, Tramübergang'
    })
  })

  it('kennt einen Standort ohne Postleitzahl', () => {
    expect(zerlegeStandort('A2/A3 Augst – Fahrtrichtung Basel')).toEqual({
      plz: null,
      ort: null,
      strasse: null
    })
    expect(zerlegeStandort('4302 Augst, A2, FR Bern / Luzern')).toEqual({
      plz: '4302',
      ort: 'Augst',
      strasse: 'A2, FR Bern / Luzern'
    })
  })

  it('meldet einen Block ohne Standort und einen doppelten Standort, statt zu raten', () => {
    const doppelt = parseStandortblatt(
      [
        'Semistationäre Geschwindigkeitskontrollanlagen:',
        'SEMI 01',
        'Ab wann: 01.10.2026',
        'Geschwindigkeit: 50 km/h',
        '**********************************************************',
        'SEMI 02',
        'Standort: 4123 Allschwil, Binningerstrasse',
        '**********************************************************',
        'SEMI 03',
        'Standort: 4123 Allschwil, Binningerstrasse',
        '**********************************************************'
      ].join('\n')
    )
    expect(doppelt.anlagen).toHaveLength(1)
    expect(doppelt.hinweise).toEqual([
      'Ein Block ohne Standort wurde uebergangen (SEMI 01).',
      'Der Standort «4123 Allschwil, Binningerstrasse» steht zweimal auf dem Blatt — die erste Nennung gilt.'
    ])
  })

  it('ordnet die Gemeinde ueber die Postleitzahl zu, sonst ueber den Namen mit Wortgrenze', () => {
    const [augst, , allschwil, , autobahn, binningen] = blatt.anlagen
    expect(ordneGemeindeZu(allschwil!, GEMEINDEN)).toBe('allschwil')
    expect(ordneGemeindeZu(binningen!, GEMEINDEN)).toBe('binningen')
    expect(ordneGemeindeZu(augst!, GEMEINDEN)).toBeNull()
    expect(ordneGemeindeZu(autobahn!, GEMEINDEN)).toBeNull()
    // «Aeschenplatz» is not Aesch; the name needs a boundary.
    expect(
      ordneGemeindeZu(
        { plz: null, ort: null, standort: 'Basel, Aeschenplatz' },
        GEMEINDEN
      )
    ).toBeNull()
    expect(
      ordneGemeindeZu(
        { plz: null, ort: 'Reinach BL', standort: 'Reinach BL, Hauptstrasse' },
        GEMEINDEN
      )
    ).toBe('reinach')
    expect(
      ordneGemeindeZu(
        { plz: '4148', ort: 'Pfeffingen', standort: '4148 Pfeffingen' },
        [{ id: 'aesch', name: 'Aesch', plz: '4147, 4148' }]
      )
    ).toBe('aesch')
    // `gemeinden.plz` is a JSON list in the schema — the first live run
    // failed on exactly that (11 October 2026).
    expect(
      ordneGemeindeZu(
        { plz: '4148', ort: 'Pfeffingen', standort: '4148 Pfeffingen' },
        [{ id: 'aesch', name: 'Aesch', plz: ['4147', 4148] }]
      )
    ).toBe('aesch')
    expect(
      ordneGemeindeZu({ plz: '4147', ort: 'Aesch', standort: '4147 Aesch' }, [
        { id: 'x', name: 'Aesch', plz: null }
      ])
    ).toBe('x')
  })
})

describe('standortblattLink', () => {
  // The page's JSON carries the link inside a text block's HTML.
  const seite = {
    modified: '2026-10-07T10:46:03+00:00',
    slblocks: {
      a: {
        text: {
          data: '<p><strong><a data-file-type="pdf" href="https://bl-api.webcloud7.ch/politik-und-behorden/direktionen/sicherheitsdirektion/polizei/downloads-startseite/20261007_kontrollanlagen-standortmitteilung-1.pdf?_t=1791369921192">Standorte Radaranlagen</a></strong></p>'
        }
      }
    }
  }

  it('findet das PDF, den Tag im Dateinamen und den Stand der Seite', () => {
    expect(standortblattLink(seite)).toEqual({
      pdfUrl:
        'https://bl-api.webcloud7.ch/politik-und-behorden/direktionen/sicherheitsdirektion/polizei/downloads-startseite/20261007_kontrollanlagen-standortmitteilung-1.pdf?_t=1791369921192',
      publiziertAm: '2026-10-07',
      modified: '2026-10-07T10:46:03+00:00'
    })
    expect(standortblattLink({ title: 'leer' })).toEqual({
      pdfUrl: null,
      publiziertAm: null,
      modified: null
    })
  })

  it('leitet die Download-Adresse ohne Cache-Buster ab', () => {
    expect(
      downloadAdresse(
        'https://bl-api.webcloud7.ch/a/b/20261007_x.pdf?_t=1791369921192'
      )
    ).toBe('https://bl-api.webcloud7.ch/a/b/20261007_x.pdf/@@download/file')
    expect(publikationstagAus('https://x.ch/d/2026_x.pdf')).toBeNull()
  })
})

describe('parseKontrollblatt', () => {
  const september = parseKontrollblatt(fixture('reinach-2026-09.txt'))
  const maerz = parseKontrollblatt(fixture('reinach-2026-03.txt'))

  it('liest jede Kontrollzeile des Septembers mit Zeit, Ort, Limite und Zahlen', () => {
    expect(september.hinweise).toEqual([])
    expect(september.jahr).toBe(2026)
    expect(september.monat).toBe(9)
    expect(september.stand).toBe('2026-09-29')
    expect(september.kontrollen).toHaveLength(9)
    expect(september.kontrollen[0]).toEqual({
      datum: '2026-09-01',
      von: '07:26',
      bis: '09:00',
      messort: 'Aumattstrasse',
      signalisiert: 30,
      gemessen: 67,
      uebertretungen: 5,
      vmax: 38
    })
    expect(september.kontrollen[8]).toMatchObject({
      datum: '2026-09-23',
      messort: 'Binningerstrasse',
      gemessen: 107,
      uebertretungen: 17,
      vmax: 47
    })
    expect(september.messungen).toEqual([])
  })

  // The March sheet is headed «Januar 2026» over March rows: the rows decide,
  // the header is a finding. It also carries the SR7 table.
  it('nimmt den Monat aus den Zeilen, meldet den falschen Kopf und liest die SR7-Messung', () => {
    expect(maerz.jahr).toBe(2026)
    expect(maerz.monat).toBe(3)
    expect(maerz.kontrollen).toHaveLength(11)
    expect(maerz.hinweise).toEqual([
      'Der Kopf des Blatts nennt Januar 2026, die Zeilen sind März 2026 — die Zeilen gelten.'
    ])
    // The stale header's «Datum: 31.01.2026» is the stale month's date: dropped.
    expect(maerz.stand).toBeNull()
    expect(maerz.messungen).toEqual([
      {
        von: '2026-02-27',
        bis: '2026-03-26',
        messort: 'Jupiterstrasse',
        signalisiert: 30,
        gemessen: 27895,
        v85: 25.5
      }
    ])
  })

  it('meldet eine Datumszeile, die nicht aufgeht, statt sie zu verlieren', () => {
    const kaputt = parseKontrollblatt(
      '03.09.2026 07:00 - 08:00 Uhr Hauptstrasse 30 km/h 12 x 40 km/h'
    )
    expect(kaputt.kontrollen).toEqual([])
    expect(kaputt.hinweise).toEqual([
      'Zeile nicht gelesen: «03.09.2026 07:00 - 08:00 Uhr Hauptstrasse 30 km/h 12 x 40 km/h»'
    ])
  })

  // The May 2026 sheet prints the SR7 limit without its unit — measured on
  // the first live run, where the line was reported as not read.
  it('liest eine Limite auch ohne Einheit', () => {
    const mai = parseKontrollblatt(
      [
        '05.05.2026 07:10 - 08:30 Uhr Hauptstrasse 30 40 3 38 km/h',
        '28.04. bis 28.05.2026 Dornacherweg 30 36258 33 km/h'
      ].join('\n')
    )
    expect(mai.hinweise).toEqual([])
    expect(mai.kontrollen[0]).toMatchObject({
      messort: 'Hauptstrasse',
      signalisiert: 30,
      gemessen: 40,
      uebertretungen: 3,
      vmax: 38
    })
    expect(mai.messungen).toEqual([
      {
        von: '2026-04-28',
        bis: '2026-05-28',
        messort: 'Dornacherweg',
        signalisiert: 30,
        gemessen: 36258,
        v85: 33
      }
    ])
  })

  it('rechnet die Bilanz des Monats ueber alle Zeilen: Summen, Strasse mit den meisten Uebertretungen, Schnellster', () => {
    const bilanz = zusammenfassung(september.kontrollen)
    expect(bilanz).toMatchObject({
      kontrollen: 9,
      gemessen: 738,
      uebertretungen: 157,
      quote: 21.3
    })
    expect(bilanz.meiste).toEqual({
      messort: 'Hinterkirchweg',
      kontrollen: 1,
      gemessen: 99,
      uebertretungen: 35,
      quote: 35.4
    })
    // Hollenweg: 19 of 41 is 46,3 percent, but 41 vehicles are under the floor.
    expect(bilanz.hoechsteQuote?.messort).toBe('Hinterkirchweg')
    expect(bilanz.schnellster).toEqual({
      vmax: 48,
      signalisiert: 30,
      messort: 'Hinterlindenweg',
      datum: '2026-09-08',
      von: '07:12',
      bis: '08:48'
    })
    expect(bilanz.strassen.map((s) => s.messort)).toEqual([
      'Hinterkirchweg',
      'Schönenbachstrasse',
      'Hollenweg',
      'Binningerstrasse',
      'Brunngasse',
      'Industriestrasse',
      'Angensteinerstrasse',
      'Hinterlindenweg',
      'Aumattstrasse'
    ])
    expect(zusammenfassung([])).toMatchObject({
      kontrollen: 0,
      quote: null,
      meiste: null,
      schnellster: null
    })
  })
})

describe('parseKontrollseite', () => {
  const html = `
    <div><a href="/wAssets/docs/08-Schutz-und-Sicherheit/Radarkontrollen/003-Maerz-2026.pdf" class="pdf" aria-label="März"><span>März</span></a></div>
    <div><a href="/wAssets/docs/08-Schutz-und-Sicherheit/Radarkontrollen/009-September-2026.pdf" class="pdf"><span>September</span></a></div>
    <div><a href="/wAssets/docs/08-Schutz-und-Sicherheit/Standorte-AED-Reinach.pdf" class="pdf"><span>AED</span></a></div>
    <div><a href="/wAssets/docs/08-Schutz-und-Sicherheit/Radarkontrollen/009-September-2026.pdf">nochmals</a></div>
  `
  const basis =
    'https://www.reinach-bl.ch/de/aktuell/news/meldungen-projekte/mobilitaet/Geschwindigkeitskontrollen.php'

  it('liest die Monatsblaetter aus den Dateinamen, neueste zuerst, andere PDFs nicht', () => {
    expect(parseKontrollseite(html, basis)).toEqual([
      {
        jahr: 2026,
        monat: 9,
        url: 'https://www.reinach-bl.ch/wAssets/docs/08-Schutz-und-Sicherheit/Radarkontrollen/009-September-2026.pdf'
      },
      {
        jahr: 2026,
        monat: 3,
        url: 'https://www.reinach-bl.ch/wAssets/docs/08-Schutz-und-Sicherheit/Radarkontrollen/003-Maerz-2026.pdf'
      }
    ])
    expect(
      monatAusDateiname('https://x.ch/Standorte-AED-Reinach.pdf')
    ).toBeNull()
    expect(monatAusDateiname('https://x.ch/r/012-Dezember-2026.pdf')).toEqual({
      jahr: 2026,
      monat: 12
    })
  })
})
