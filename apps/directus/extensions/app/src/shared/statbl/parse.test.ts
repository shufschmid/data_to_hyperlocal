import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  angleicheSpalten,
  parseAuswahl,
  parseJahre,
  parseKinder,
  parseLetzteAenderung,
  parseTabelle,
  parseZahl,
  spaltenSchluessel,
  tabellenFelder,
  parseZweige,
  parseKapitelName
} from './parse'

// Fixtures are the real pages, saved once. Every assertion below is a fact
// about a table the office actually publishes — a hand-written fixture would
// only prove that the parser matches my idea of the markup.
const laden = (jahr: string): string =>
  readFileSync(join(__dirname, 'fixtures', `7_1_1_3-${jahr}.html`), 'utf8')

const seite = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', `${name}.html`), 'utf8')

describe('parseZahl', () => {
  it('liest die Tausendertrennung des Amts', () => {
    expect(parseZahl('2 777')).toBe(2777)
    expect(parseZahl("1'132")).toBe(1132)
    expect(parseZahl('847')).toBe(847)
  })

  // "-" heisst: keine Betriebe dieser Groessenklasse. Das ist keine Messung von
  // null, und als 0 im Text waere es eine Behauptung, die niemand erhoben hat.
  it('macht aus einem Strich keine Null', () => {
    expect(parseZahl('-')).toBeNull()
    expect(parseZahl('–')).toBeNull()
    expect(parseZahl('')).toBeNull()
  })

  it('laesst Text Text sein', () => {
    expect(parseZahl('Aesch')).toBeNull()
    expect(parseZahl('Bez. Arlesheim')).toBeNull()
  })

  it('versteht Dezimalkomma', () => {
    expect(parseZahl('10,5')).toBe(10.5)
  })
})

describe('spaltenSchluessel', () => {
  it('macht aus einer Beschriftung einen Feldnamen', () => {
    expect(spaltenSchluessel('Betriebe total')).toBe('betriebe_total')
    expect(spaltenSchluessel('Beschäftigte Vollzeit')).toBe(
      'beschaeftigte_vollzeit'
    )
    expect(spaltenSchluessel('0-9.9')).toBe('0_9_9')
  })
})

describe('parseJahre', () => {
  it('liest jede angebotene Periode und die gewaehlte', () => {
    const { jahre, aktuell } = parseJahre(laden('2025'))

    expect(aktuell).toBe('2025')
    expect(jahre).toContain('2013')
    expect(jahre).toHaveLength(13)
  })

  it('erkennt die Wahl auf einer aelteren Seite', () => {
    expect(parseJahre(laden('2013')).aktuell).toBe('2013')
  })
})

describe('parseTabelle', () => {
  const tabelle = parseTabelle(laden('2025'))

  it('findet Titel und Periode', () => {
    expect(tabelle?.titel).toContain('Landwirtschaftsbetriebe nach Gemeinde')
    expect(tabelle?.jahr).toBe('2025')
  })

  it('liefert genau die 86 Gemeinden', () => {
    expect(tabelle?.zeilen).toHaveLength(86)
  })

  // Der teuerste Fehler dieser Datei waere, "Ganzer Kanton" als 87. Gemeinde
  // mitzumitteln — der Kantonsschnitt waere dann still falsch.
  it('haelt Kanton und Bezirke von den Gemeinden getrennt', () => {
    const namen = tabelle?.zeilen.map((z) => z['gemeinde'])

    expect(namen).not.toContain('Ganzer Kanton')
    expect(namen?.some((n) => String(n).startsWith('Bez.'))).toBe(false)
    expect(tabelle?.aggregate).toHaveLength(6)
    expect(tabelle?.aggregate[0]?.['gemeinde']).toBe('Ganzer Kanton')
  })

  it('setzt die zweistoeckige Kopfzeile zu eindeutigen Spalten zusammen', () => {
    // "total" steht zweimal in der zweiten Kopfzeile — einmal unter Betriebe,
    // einmal unter Beschaeftigte.
    expect(tabelle?.spalten).toContain('Betriebe total')
    expect(tabelle?.spalten.filter((s) => s === 'total')).toHaveLength(0)
  })

  it('liest die Zahlen einer Gemeinde richtig', () => {
    const aesch = tabelle?.zeilen.find((z) => z['gemeinde'] === 'Aesch')

    expect(aesch?.['betriebe_total']).toBe(11)
    expect(aesch?.['beschaeftigte_total']).toBe(63)
    // Keine Betriebe zwischen 10 und 19,9 Hektaren: im Original ein Strich.
    expect(
      aesch?.['betriebe_nach_betriebsgroesse_in_hektaren_10_19_9']
    ).toBeNull()
  })

  // Beide haben keinen einzigen Betrieb. Sie zu verlieren waere die Sorte
  // Fehler, die als „84 statt 86" niemandem auffaellt.
  it('behaelt Gemeinden, deren Zeile nur aus Strichen besteht', () => {
    const birsfelden = tabelle?.zeilen.find(
      (z) => z['gemeinde'] === 'Birsfelden'
    )

    expect(birsfelden).toBeDefined()
    expect(birsfelden?.['betriebe_total']).toBeNull()
    expect(tabelle?.zeilen.map((z) => z['gemeinde'])).toContain('Diepflingen')
  })

  it('gibt jeder Zeile ihre Periode mit', () => {
    expect(tabelle?.zeilen.every((z) => z['jahr'] === '2025')).toBe(true)
  })

  it('liest eine aeltere Periode gleich', () => {
    const alt = parseTabelle(laden('2013'))
    const aesch = alt?.zeilen.find((z) => z['gemeinde'] === 'Aesch')

    expect(alt?.jahr).toBe('2013')
    expect(alt?.zeilen).toHaveLength(86)
    // Achtung: 2013 heisst die Spalte anders — genau darum gibt es
    // angleicheSpalten weiter unten.
    expect(aesch?.['anz_betriebe_total']).toBe(13)
    expect(alt?.aggregate[0]?.['anz_betriebe_total']).toBe(941)
  })

  it('gibt null, wenn die Seite keine Tabelle ist', () => {
    expect(
      parseTabelle('<html><body><p>Nichts hier</p></body></html>')
    ).toBeNull()
  })
})

describe('tabellenFelder', () => {
  it('beschreibt die Tabelle wie einen Portal-Datensatz', () => {
    const felder = tabellenFelder(parseTabelle(laden('2025'))!)
    const namen = felder.map((f) => f.name)

    // Genau diese beiden brauchen die Perioden- und die Gemeindeerkennung.
    expect(namen[0]).toBe('jahr')
    expect(namen).toContain('gemeinde')
    expect(namen).toContain('betriebe_total')
  })
})

describe('angleicheSpalten', () => {
  const jetzt = parseTabelle(laden('2025'))!
  const damals = parseTabelle(laden('2013'))!

  // Ohne das waeren „Anz. Betriebe total" (2013) und „Betriebe total" (2025)
  // zwei verschiedene Reihen, und der Vergleich ueber zehn Jahre faende
  // schlicht nichts — ohne Fehlermeldung.
  it('bringt eine aeltere Ausgabe auf die heutigen Spaltennamen', () => {
    const zeilen = angleicheSpalten(jetzt, damals)
    const aesch = zeilen?.find((z) => z['gemeinde'] === 'Aesch')

    expect(aesch?.['betriebe_total']).toBe(13)
    expect(aesch?.['jahr']).toBe('2013')
    expect(zeilen).toHaveLength(86)
  })

  it('verweigert die Angleichung, wenn die Tabelle anders gebaut ist', () => {
    const andere = { ...damals, spalten: damals.spalten.slice(0, 4) }
    expect(angleicheSpalten(jetzt, andere)).toBeNull()
  })
})

describe('parseLetzteAenderung', () => {
  // Der Auslöser der ganzen Überwachung: das Amt schreibt auf jede Portalseite,
  // wann sich der Zweig zuletzt geändert hat.
  it('liest das Datum aus dem Seitenkopf', () => {
    expect(parseLetzteAenderung(seite('5_1_5_3'))).toBe('2026-05-19')
    expect(parseLetzteAenderung(seite('5_1-zweig'))).toBe('2026-05-19')
  })

  it('gibt null, wenn die Seite keins nennt', () => {
    expect(parseLetzteAenderung('<html><body>nichts</body></html>')).toBeNull()
  })
})

describe('parseAuswahl', () => {
  // Die breite Tabelle nennt ihre Messgroesse nirgends in der Tabelle. Sie steht
  // nur in der Navigation, als gewaehlter Eintrag.
  it('nennt den gewaehlten Pfad, tiefste Ebene zuletzt', () => {
    expect(parseAuswahl(seite('5_1_5_3'))).toEqual([
      { pfad: '5_1_5', titel: 'Bauland Gemeinden' },
      { pfad: '5_1_5_3', titel: 'Quadratmeterpreis' }
    ])
  })
})

describe('parseKinder', () => {
  it('findet die Unterseiten eines Zweigs', () => {
    const kinder = parseKinder(seite('5_1-zweig'), '5_1')

    expect(kinder).toContain('5_1_5')
    expect(kinder).toContain('5_1_1_1')
    // Nichts aus einem anderen Zweig und nicht der Zweig selbst.
    expect(kinder.every((k) => k.startsWith('5_1_'))).toBe(true)
  })
})

describe('parseTabelle — breite Form', () => {
  const tabelle = parseTabelle(seite('5_1_5_3'))!

  it('erkennt Jahre als Spalten und dreht sie in die Langform', () => {
    expect(tabelle.form).toBe('breit')
    expect(tabelle.jahr).toBe('2025')
    expect(tabelle.jahre).toHaveLength(10)
    expect(tabelle.spalten).toEqual(['gemeinde', 'Quadratmeterpreis'])
  })

  it('liefert alle 86 Gemeinden je Jahrgang', () => {
    expect(tabelle.zeilen).toHaveLength(86)
    expect(tabelle.alleZeilen).toHaveLength(860)
  })

  it('liest die Werte einer Gemeinde ueber die Jahre', () => {
    const aesch = (jahr: string) =>
      tabelle.alleZeilen.find(
        (z) => z['gemeinde'] === 'Aesch' && z['jahr'] === jahr
      )

    expect(aesch('2025')?.['quadratmeterpreis']).toBe(1563)
    expect(aesch('2016')?.['quadratmeterpreis']).toBe(1266)
  })

  // "()" heisst: die Zahl existiert, wird aber nicht ausgewiesen. Sie als Zahl
  // zu lesen waere falsch — die Zeile deswegen wegzuwerfen war schlimmer: es
  // kostete 78 von 86 Gemeinden, ohne eine einzige Fehlermeldung.
  it('macht aus einer zurueckgehaltenen Zahl null, nicht eine fehlende Zeile', () => {
    const allschwil = tabelle.alleZeilen.find(
      (z) => z['gemeinde'] === 'Allschwil' && z['jahr'] === '2023'
    )

    expect(allschwil).toBeDefined()
    expect(allschwil?.['quadratmeterpreis']).toBeNull()
  })

  it('haelt Kanton und Bezirke auch hier heraus', () => {
    const namen = new Set(tabelle.zeilen.map((z) => String(z['gemeinde'])))

    expect(namen.has('Ganzer Kanton')).toBe(false)
    // "Bezirk Arlesheim" — ohne Punkt, anders als in der langen Form.
    expect(namen.has('Bezirk Arlesheim')).toBe(false)
    expect(tabelle.aggregate).toHaveLength(60)
  })

  // Der Titel geht so in die Abdeckungsfrage ans Modell. „Personenwagen nach
  // Gemeinde nach Gemeinde" war kein Schoenheitsfehler, sondern schlechtere
  // Eingabe fuer eine Entscheidung.
  it('setzt den Titel aus der Navigation zusammen, ohne Dopplung', () => {
    expect(tabelle.titel).toBe('Bauland Gemeinden — Quadratmeterpreis')
  })
})

describe('parseZahl — zurueckgehaltene Werte', () => {
  it('kennt die Schreibweisen des Amts fuer "kein Wert"', () => {
    expect(parseZahl('()')).toBeNull()
    expect(parseZahl('( )')).toBeNull()
    expect(parseZahl('...')).toBeNull()
  })
})

describe('der Stand einer Tabelle', () => {
  // „Letzte Änderung: 19.05.2026" auf der Seite ist die Aussage des Amts. Unsere
  // Lesezeit ist keine: mit ihr stand eine Tabelle vom November 2025 zuoberst in
  // der Zeitleiste, als waere sie heute erschienen.
  // Als blosses Tagesdatum in einer timestamptz-Spalte wurde daraus Mitternacht
  // Ortszeit und damit `2026-05-18 22:00+00` — ein Tag zu frueh in der Liste.
  it('kommt aus der Seite und nennt seine Zeitzone', () => {
    expect(parseTabelle(seite('5_1_5_3'))?.stand).toBe(
      '2026-05-19T00:00:00.000Z'
    )
  })

  it('ist null, wenn die Seite keinen nennt', () => {
    expect(parseTabelle(laden('2025'))?.stand).toBeNull()
  })
})

describe('Zweignamen', () => {
  // „Zweig 3_5" sagt niemandem etwas. Das Portal nennt ihn in der oberen
  // Navigation beim Namen — und die erste Fassung warf die Beschriftung weg,
  // weil sie nur Pfade zurueckgab.
  it('liest die Namen der Zweige eines Kapitels', () => {
    expect(parseZweige(seite('5_1-zweig'), '5')).toEqual([
      { pfad: '5_1', titel: 'Grundbesitzwechsel' },
      { pfad: '5_2', titel: 'Mietpreise' }
    ])
  })

  it('nimmt nur die zweite Ebene des gefragten Kapitels', () => {
    const zweige = parseZweige(seite('5_1-zweig'), '5')
    expect(zweige.every((z) => z.pfad.split('_').length === 2)).toBe(true)
    expect(parseZweige(seite('5_1-zweig'), '7')).toEqual([])
  })

  it('nennt das Kapitel ohne seine Nummer', () => {
    expect(parseKapitelName(seite('5_1-zweig'), '5')).toBe('Preise')
    expect(parseKapitelName(seite('5_1-zweig'), '3')).toBe('Arbeit und Erwerb')
  })

  it('gibt null, wenn das Kapitel nicht verlinkt ist', () => {
    expect(parseKapitelName('<html></html>', '5')).toBeNull()
  })
})
