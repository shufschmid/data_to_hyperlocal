import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  abdeckungHinweis,
  buildAbdeckungPrompt,
  buildAbdeckungSystem,
  ordneSeiteEin,
  parseAbdeckung,
  type AbdeckungKatalog
} from './inventur'

const seite = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', `${name}.html`), 'utf8')

// Die echten 86 waeren im Test nur Ballast; entscheidend ist, dass die Zahl der
// Treffer aus dem Abgleich kommt und nicht aus der Zeilenzahl.
const gemeinden = [
  'Aesch',
  'Allschwil',
  'Arlesheim',
  'Biel-Benken',
  'Binningen',
  'Birsfelden',
  'Bottmingen',
  'Ettingen',
  'Münchenstein',
  'Muttenz',
  'Oberwil',
  'Pfeffingen',
  'Reinach',
  'Schönenbuch',
  'Therwil',
  'Liestal',
  'Füllinsdorf',
  'Frenkendorf',
  'Lausen',
  'Pratteln',
  'Bubendorf',
  'Sissach',
  'Gelterkinden',
  'Waldenburg'
].map((name) => ({ name }))

describe('ordneSeiteEin', () => {
  it('erkennt eine Gemeindetabelle in der langen Form', () => {
    const e = ordneSeiteEin(seite('7_1_1_3-2025'), gemeinden)

    expect(e.art).toBe('tabelle')
    expect(e.gemeindeebene).toBe(true)
    expect(e.treffer).toBe(gemeinden.length)
    expect(e.titel).toContain('Landwirtschaftsbetriebe')
  })

  it('erkennt eine Gemeindetabelle in der breiten Form', () => {
    const e = ordneSeiteEin(seite('5_1_5_3'), gemeinden)

    expect(e.art).toBe('tabelle')
    expect(e.gemeindeebene).toBe(true)
    expect(e.tabelle?.form).toBe('breit')
  })

  // Die Zweigseite zeigt sehr wohl eine Tabelle — „Freihandkaeufe nach Art des
  // Grundstuecks", aber kantonal, mit Jahren in der ersten Spalte. Sie ist der
  // Grund, weshalb die Regel auf Gemeindeebene prueft und nicht darauf, ob eine
  // Seite Zahlen enthaelt: Zahlen enthaelt hier fast jede.
  it('erkennt eine kantonale Tabelle, aber nicht als Gemeindeebene', () => {
    const e = ordneSeiteEin(seite('5_1-zweig'), gemeinden)

    expect(e.art).toBe('tabelle')
    expect(e.gemeindeebene).toBe(false)
    expect(e.treffer).toBe(0)
  })

  it('haelt eine Seite ohne Datentabelle fuer Navigation', () => {
    const e = ordneSeiteEin(
      '<html><body><table><tr><td><a href="/web_portal/5_1">Preise</a></td></tr></table></body></html>',
      gemeinden
    )

    expect(e.art).toBe('navigation')
    expect(e.tabelle).toBeNull()
  })

  it('zaehlt Treffer, nicht Zeilen', () => {
    const e = ordneSeiteEin(seite('7_1_1_3-2025'), [
      { name: 'Aesch' },
      { name: 'Liestal' }
    ])

    expect(e.treffer).toBe(2)
    // Zwei bekannte Namen sind keine Gemeindetabelle.
    expect(e.gemeindeebene).toBe(false)
  })
})

describe('buildAbdeckungSystem', () => {
  const katalog: AbdeckungKatalog = {
    datensaetze: [
      {
        externe_id: '12070',
        titel: 'Durchschnittlicher Quadratmeterpreis von Bauland'
      },
      { externe_id: '10990', titel: 'Arbeitsstätten und Beschäftigte' }
    ],
    ankuendigungen: [
      { id: 'a1', titel: 'Landwirtschaft 2025' },
      { id: 'a2', titel: 'Hotellerie 2025' }
    ]
  }

  // Der Katalog ist der gecachte Praefix ueber tausende Seiten. Eine wechselnde
  // Reihenfolge waere unsichtbar und stuende nur auf der Rechnung.
  it('ist byte-identisch, unabhaengig von der Eingabereihenfolge', () => {
    const gedreht: AbdeckungKatalog = {
      datensaetze: [...katalog.datensaetze].reverse(),
      ankuendigungen: [...katalog.ankuendigungen].reverse()
    }

    expect(buildAbdeckungSystem(gedreht)).toBe(buildAbdeckungSystem(katalog))
  })

  it('nennt beide Listen', () => {
    const text = buildAbdeckungSystem(katalog)

    expect(text).toContain(
      '12070 | Durchschnittlicher Quadratmeterpreis von Bauland'
    )
    expect(text).toContain('- Landwirtschaft 2025')
  })

  it('kommt ohne Agenda-Eintraege aus', () => {
    expect(buildAbdeckungSystem({ ...katalog, ankuendigungen: [] })).toContain(
      '(keine)'
    )
  })
})

describe('buildAbdeckungPrompt', () => {
  it('stellt nur die Tabelle in den User-Turn', () => {
    const prompt = buildAbdeckungPrompt({
      pfad: '5_1_5_3',
      titel: 'Quadratmeterpreis nach Gemeinde',
      spalten: ['gemeinde', 'Quadratmeterpreis'],
      jahre: ['2025', '2024']
    })

    expect(prompt).toContain('5_1_5_3')
    expect(prompt).toContain('Quadratmeterpreis')
    expect(prompt).not.toContain('12070')
  })
})

describe('parseAbdeckung', () => {
  const katalog: AbdeckungKatalog = {
    datensaetze: [{ externe_id: '12070', titel: 'Quadratmeterpreis Bauland' }],
    ankuendigungen: [{ id: 'a1', titel: 'Landwirtschaft 2025' }]
  }

  it('erkennt eine Tabelle als durch Open Data abgedeckt', () => {
    const a = parseAbdeckung(
      {
        externe_id: '12070',
        ankuendigung: null,
        begruendung: 'Dieselben Zahlen.'
      },
      katalog,
      true
    )

    expect(a.datensatz).toBe('12070')
    expect(a.beobachten).toBe(false)
  })

  it('erkennt eine Tabelle als durch die Agenda abgedeckt', () => {
    const a = parseAbdeckung(
      {
        externe_id: null,
        ankuendigung: 'Landwirtschaft 2025',
        begruendung: 'Gleiche Statistik.'
      },
      katalog,
      true
    )

    expect(a.ankuendigung).toBe('Landwirtschaft 2025')
    expect(a.beobachten).toBe(false)
  })

  it('setzt genau dann auf beobachten, wenn beides fehlt', () => {
    const a = parseAbdeckung(
      {
        externe_id: null,
        ankuendigung: null,
        begruendung: 'Gibt es nur hier.'
      },
      katalog,
      true
    )

    expect(a.beobachten).toBe(true)
  })

  it('beobachtet nie etwas ohne Gemeindegliederung', () => {
    const a = parseAbdeckung(
      { externe_id: null, ankuendigung: null, begruendung: 'Nur kantonal.' },
      katalog,
      false
    )

    expect(a.beobachten).toBe(false)
  })

  // Der stille Fehler: eine erfundene ID wuerde die Tabelle fuer immer als
  // abgedeckt markieren, und niemand hoerte je wieder von dieser Statistik.
  it('verwirft eine ID, die nicht im Katalog stand', () => {
    const a = parseAbdeckung(
      {
        externe_id: '99999',
        ankuendigung: 'Gibt es nicht',
        begruendung: 'Passt.'
      },
      katalog,
      true
    )

    expect(a.datensatz).toBeNull()
    expect(a.ankuendigung).toBeNull()
    expect(a.beobachten).toBe(true)
  })

  it('wirft bei einer Antwort, die kein Objekt ist', () => {
    expect(() => parseAbdeckung('12070', katalog, true)).toThrow()
  })
})

describe('abdeckungHinweis', () => {
  it('sagt bei fehlender Gemeindegliederung, wie viele Gemeinden getroffen wurden', () => {
    expect(
      abdeckungHinweis({ gemeindeebene: false, treffer: 3 }, null)
    ).toContain('3 von 86')
  })

  it('nennt den abdeckenden Datensatz', () => {
    const hinweis = abdeckungHinweis(
      { gemeindeebene: true, treffer: 86 },
      {
        datensatz: '12070',
        ankuendigung: null,
        begruendung: 'Dieselben Zahlen.',
        beobachten: false
      }
    )

    expect(hinweis).toContain('Datensatz 12070')
  })

  it('sagt es, wenn es die Tabelle nur hier gibt', () => {
    const hinweis = abdeckungHinweis(
      { gemeindeebene: true, treffer: 86 },
      {
        datensatz: null,
        ankuendigung: null,
        begruendung: 'Kein Datensatz dazu.',
        beobachten: true
      }
    )

    expect(hinweis).toContain('Nur hier')
  })
})

describe('Vorschau-Seiten', () => {
  // Das Portal zeigt auf `1_4` die Tabelle von `1_4_5_1`. Als eigene Tabelle
  // gelesen, stand dieselbe Statistik unter drei Pfaden in der Inventur — und
  // die Abdeckungsfrage wurde dreimal bezahlt.
  it('erkennt, dass eine Zweigseite die Tabelle eines Kindes zeigt', () => {
    const e = ordneSeiteEin(seite('5_1-zweig'), gemeinden, '5_1')

    expect(e.art).toBe('navigation')
    expect(e.zeigtTabelleVon).toBe('5_1_1_1')
  })

  it('laesst die Seite gelten, der die Tabelle gehoert', () => {
    const e = ordneSeiteEin(seite('5_1_5_3'), gemeinden, '5_1_5_3')

    expect(e.art).toBe('tabelle')
    expect(e.zeigtTabelleVon).toBeNull()
  })

  // Ohne Navigation im Ausschnitt gibt es nichts, woran man es festmachen
  // koennte — dann gilt die Seite als ihre eigene.
  it('haelt eine Seite ohne Navigation fuer ihre eigene', () => {
    const e = ordneSeiteEin(seite('7_1_1_3-2025'), gemeinden, '7_1_1_3')

    expect(e.art).toBe('tabelle')
    expect(e.zeigtTabelleVon).toBeNull()
  })

  it('nennt im Hinweis, wem die Tabelle gehoert', () => {
    expect(
      abdeckungHinweis(
        { gemeindeebene: false, treffer: 0, zeigtTabelleVon: '1_4_5_1' },
        null
      )
    ).toContain('1_4_5_1')
  })
})
