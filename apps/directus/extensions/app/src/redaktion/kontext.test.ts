import { describe, expect, it } from 'vitest'
import {
  beschreibeEinordnung,
  beschreibeKanton,
  beschreibeKantonZeitreihe,
  datengrundlage,
  duenneAus,
  findeDimensionen,
  formatZahl,
  kennzahlen,
  verdichteZeilen,
  zeitreihen
} from './kontext'

// Rows exactly as dataset 12060 returns them — including the detail that broke
// the first version: the same `wert` column holds tonnes *and* kilograms per
// inhabitant, across several categories.
function zeile(
  bfs: string,
  gemeinde: string,
  kategorie: string,
  einheit: string,
  wert: number
) {
  return {
    jahr: '2025',
    bfs_gemeindenummer: bfs,
    gemeinde,
    kategorie,
    einheit,
    wert
  }
}

const AESCH = [
  zeile('2761', 'Aesch (BL)', 'Glas', 'kg pro Einw.', 21.26),
  zeile('2761', 'Aesch (BL)', 'Glas', 'Tonnen', 242),
  zeile('2761', 'Aesch (BL)', 'Hauskehricht', 'kg pro Einw.', 156)
]

const KANTON = [
  ...AESCH,
  zeile('2829', 'Liestal', 'Glas', 'kg pro Einw.', 16.91),
  zeile('2829', 'Liestal', 'Glas', 'Tonnen', 235),
  zeile('2829', 'Liestal', 'Hauskehricht', 'kg pro Einw.', 144)
]

describe('findeDimensionen', () => {
  it('erkennt die Spalten, die vergleichbare Gruppen bilden', () => {
    expect(findeDimensionen(KANTON)).toEqual(['einheit', 'kategorie'])
  })

  // A column with one value carries no information once the slice is filtered.
  it('ignoriert eine konstante Spalte', () => {
    expect(findeDimensionen(KANTON)).not.toContain('jahr')
  })

  it('ignoriert die Identitaetsspalten', () => {
    expect(findeDimensionen(KANTON)).not.toContain('gemeinde')
    expect(findeDimensionen(KANTON)).not.toContain('bfs_gemeindenummer')
  })

  // A column with a distinct value per row is an identifier; grouping by it
  // would give every average a sample size of one.
  it('ignoriert eine Spalte mit zu vielen Auspraegungen', () => {
    const viele = Array.from({ length: 40 }, (_, i) => ({
      vorlage_id: `v${i}`,
      wert: i
    }))
    expect(findeDimensionen(viele)).not.toContain('vorlage_id')
  })
})

describe('kennzahlen — rechnet nur innerhalb vergleichbarer Gruppen', () => {
  // THE bug this module was rewritten for. The first version averaged the whole
  // `wert` column and produced 79.72 — tonnes of household waste mixed with
  // kilograms of glass per head. A model handed that number turned it into
  // "46 percent above the cantonal average" in an article that went on to be
  // read as fact.
  it('mittelt niemals ueber verschiedene Einheiten hinweg', () => {
    const alle = kennzahlen(KANTON)

    for (const k of alle) {
      // Every figure belongs to exactly one unit and one category.
      expect(k.gruppe).toMatch(/kg pro Einw\.|Tonnen/)
      expect(k.gruppe).toMatch(/Glas|Hauskehricht/)
    }
  })

  it('rechnet den Glas-Schnitt in kg pro Einwohner korrekt', () => {
    const glasProKopf = kennzahlen(KANTON).find(
      (k) => k.gruppe.includes('Glas') && k.gruppe.includes('kg pro Einw.')
    )

    // (21.26 + 16.91) / 2 — und nichts sonst fliesst ein.
    expect(glasProKopf?.schnitt).toBeCloseTo(19.085, 3)
    expect(glasProKopf?.anzahl).toBe(2)
  })

  it('haelt Tonnen und Kilogramm derselben Kategorie auseinander', () => {
    const alle = kennzahlen(KANTON)
    const proKopf = alle.find(
      (k) => k.gruppe.includes('Glas') && k.gruppe.includes('kg pro Einw.')
    )
    const tonnen = alle.find(
      (k) => k.gruppe.includes('Glas') && k.gruppe.includes('Tonnen')
    )

    expect(proKopf?.schnitt).toBeCloseTo(19.085, 3)
    expect(tonnen?.schnitt).toBeCloseTo(238.5, 3)
  })

  it('haelt Textspalten aus den Zahlen heraus', () => {
    expect([...new Set(kennzahlen(KANTON).map((k) => k.feld))]).toEqual([
      'wert'
    ])
  })
})

describe('beschreibeKanton', () => {
  // A figure without its unit is how a wrong number gets into print.
  it('nennt zu jeder Zahl ihre Gruppe', () => {
    for (const zeileText of beschreibeKanton(KANTON).split('\n')) {
      expect(zeileText).toMatch(/kg pro Einw\.|Tonnen/)
      expect(zeileText).toContain('Schnitt')
    }
  })

  it('sagt es, wenn nichts zu rechnen ist', () => {
    expect(beschreibeKanton([{ gemeinde: 'Aesch' }])).toContain(
      'keine numerischen Werte'
    )
  })
})

describe('beschreibeEinordnung — vergleicht Gleiches mit Gleichem', () => {
  it('stellt Glas pro Kopf dem Glas pro Kopf im Kanton gegenueber', () => {
    const text = beschreibeEinordnung(AESCH, KANTON)
    const glaszeile = text
      .split('\n')
      .find((z) => z.includes('Glas') && z.includes('kg pro Einw.'))

    expect(glaszeile).toBeDefined()
    // 21.26 gegen 19.09 — knapp darueber, nicht "46 Prozent ueber allem".
    expect(glaszeile).toContain('ueber dem Kantonsschnitt')
  })

  it('vergleicht keine Gruppe mit einer anderen', () => {
    for (const z of beschreibeEinordnung(AESCH, KANTON).split('\n')) {
      const gruppe = z.split(':')[0] ?? ''
      // Beide Seiten des Vergleichs tragen dieselbe Gruppenbezeichnung.
      expect(z.startsWith(gruppe)).toBe(true)
    }
  })

  it('erkennt einen Wert unter dem Schnitt', () => {
    const tief = [zeile('2829', 'Liestal', 'Glas', 'kg pro Einw.', 10)]
    const alle = [
      ...tief,
      zeile('2761', 'Aesch (BL)', 'Glas', 'kg pro Einw.', 30)
    ]
    expect(beschreibeEinordnung(tief, alle)).toContain(
      'unter dem Kantonsschnitt'
    )
  })

  it('nennt einen Wert auf dem Schnitt nicht faelschlich als Abweichung', () => {
    const gleich = [zeile('2761', 'Aesch (BL)', 'Glas', 'kg pro Einw.', 20)]
    const alle = [
      ...gleich,
      zeile('2829', 'Liestal', 'Glas', 'kg pro Einw.', 20)
    ]
    expect(beschreibeEinordnung(gleich, alle)).toContain(
      'auf dem Kantonsschnitt'
    )
  })

  it('bricht nicht an einem Kantonsschnitt von null', () => {
    const null_ = [zeile('2761', 'A', 'Kunststoffe', 'Tonnen', 0)]
    expect(() => beschreibeEinordnung(null_, null_)).not.toThrow()
  })

  it('meldet, wenn kein Vergleich moeglich ist', () => {
    expect(beschreibeEinordnung([{ gemeinde: 'Aesch' }], KANTON)).toBe(
      '(kein Vergleich moeglich)'
    )
  })
})

describe('verdichteZeilen', () => {
  it('laesst die Identitaetsspalten weg', () => {
    const text = verdichteZeilen(AESCH)

    expect(text).not.toContain('2761')
    expect(text).not.toContain('Aesch (BL)')
    expect(text).toContain('kategorie: Glas')
  })

  // Kategorie und Einheit muessen mit, sonst steht die Zahl nackt da.
  it('behaelt Kategorie und Einheit bei jeder Zahl', () => {
    const erste = verdichteZeilen(AESCH).split('\n')[0] ?? ''

    expect(erste).toContain('kategorie:')
    expect(erste).toContain('einheit:')
    expect(erste).toContain('wert:')
  })

  it('deckelt die Zeilenzahl und sagt es dazu', () => {
    const viele = Array.from({ length: 100 }, (_, i) => ({
      kategorie: `k${i}`,
      wert: i
    }))
    const text = verdichteZeilen(viele, 10)

    expect(text.split('\n')).toHaveLength(11)
    expect(text).toContain('90 weitere Zeilen nicht gezeigt')
  })

  it('meldet es, wenn nichts Verwertbares da ist', () => {
    expect(verdichteZeilen([{ gemeinde: 'Aesch' }])).toBe(
      '(keine verwertbaren Werte)'
    )
    expect(verdichteZeilen([])).toBe('(keine verwertbaren Werte)')
  })
})

describe('formatZahl', () => {
  it('rundet grosse Zahlen und behaelt Nachkommastellen bei kleinen', () => {
    expect(formatZahl(21.2625)).toBe('21.26')
    expect(formatZahl(280.4)).toBe('280')
  })

  it('setzt den Schweizer Tausendertrenner', () => {
    expect(formatZahl(305663)).toMatch(/305.663/)
  })
})

describe('datengrundlage', () => {
  it('haelt die Zeilen fest, aus denen geschrieben wurde', () => {
    const grundlage = datengrundlage(AESCH, '2025')

    expect(grundlage['periode']).toBe('2025')
    expect(grundlage['zeilen_gesamt']).toBe(3)
  })

  it('deckelt, statt einen Datensatz-Dump zu speichern', () => {
    const viele = Array.from({ length: 500 }, (_, i) => ({ wert: i }))
    const grundlage = datengrundlage(viele, '2025', 60)

    expect(grundlage['zeilen_gesamt']).toBe(500)
    expect(grundlage['zeilen']).toHaveLength(60)
  })
})

describe('zeitreihen', () => {
  const arbeitsstaetten = [
    {
      jahr: '2011',
      wirtschaftssektor: '1',
      arbeitsstatten: 21,
      beschaftigte: 60
    },
    {
      jahr: '2017',
      wirtschaftssektor: '1',
      arbeitsstatten: 18,
      beschaftigte: 51
    },
    {
      jahr: '2023',
      wirtschaftssektor: '1',
      arbeitsstatten: 16,
      beschaftigte: 43
    },
    {
      jahr: '2011',
      wirtschaftssektor: '2',
      arbeitsstatten: 190,
      beschaftigte: 2300
    },
    {
      jahr: '2023',
      wirtschaftssektor: '2',
      arbeitsstatten: 181,
      beschaftigte: 2130
    }
  ]

  it('bildet je Gruppe und Spalte eine Reihe, aelteste Periode zuerst', () => {
    const reihen = zeitreihen(arbeitsstaetten, 'jahr')
    const sektor1 = reihen.find(
      (r) => r.gruppe === '1' && r.feld === 'arbeitsstatten'
    )

    expect(sektor1?.werte).toEqual([
      { periode: '2011', wert: 21 },
      { periode: '2017', wert: 18 },
      { periode: '2023', wert: 16 }
    ])
  })

  // Dieselbe Verwechslung wie bei den Kennzahlen: Sektor 1 und Sektor 2 sind
  // keine vergleichbaren Zeilen und duerfen nie in einer Reihe landen.
  it('vermischt nie zwei Gruppen in einer Reihe', () => {
    const reihen = zeitreihen(arbeitsstaetten, 'jahr')
    const gruppen = new Set(reihen.map((r) => r.gruppe))

    expect(gruppen).toEqual(new Set(['1', '2']))
    expect(
      reihen.find((r) => r.gruppe === '2' && r.feld === 'arbeitsstatten')?.werte
    ).toEqual([
      { periode: '2011', wert: 190 },
      { periode: '2023', wert: 181 }
    ])
  })

  it('summiert mehrere Zeilen derselben Gruppe und Periode', () => {
    const reihen = zeitreihen(
      [
        { jahr: '2020', kategorie: 'Glas', wert: 10 },
        { jahr: '2020', kategorie: 'Glas', wert: 5 },
        { jahr: '2021', kategorie: 'Glas', wert: 12 },
        { jahr: '2020', kategorie: 'Papier', wert: 1 },
        { jahr: '2021', kategorie: 'Papier', wert: 2 }
      ],
      'jahr'
    )

    expect(reihen.find((r) => r.gruppe === 'Glas')?.werte[0]).toEqual({
      periode: '2020',
      wert: 15
    })
  })

  it('laesst eine einzelne Periode weg — das ist keine Reihe', () => {
    expect(
      zeitreihen([{ jahr: '2023', kategorie: 'Glas', wert: 10 }], 'jahr')
    ).toEqual([])
  })
})

describe('duenneAus', () => {
  const reihe = Array.from({ length: 30 }, (_, i) => ({
    periode: String(1994 + i),
    wert: i
  }))

  // „Und vor zehn Jahren?" ist genau die Frage, die der aelteste Wert
  // beantwortet. Ihn wegzukuerzen macht die Vorgabe unerfuellbar.
  it('behaelt den aeltesten und den neuesten Wert', () => {
    const gekuerzt = duenneAus(reihe, 5)

    expect(gekuerzt).toHaveLength(5)
    expect(gekuerzt[0]?.periode).toBe('1994')
    expect(gekuerzt[gekuerzt.length - 1]?.periode).toBe('2023')
  })

  it('laesst eine kurze Reihe unveraendert', () => {
    expect(duenneAus(reihe.slice(0, 3), 12)).toHaveLength(3)
  })
})

describe('beschreibeKantonZeitreihe', () => {
  it('nennt die Summe als Summe', () => {
    const text = beschreibeKantonZeitreihe(
      [
        { jahr: '2020', gemeinde: 'Liestal', kategorie: 'Glas', wert: 10 },
        { jahr: '2020', gemeinde: 'Aesch', kategorie: 'Glas', wert: 6 },
        { jahr: '2021', gemeinde: 'Liestal', kategorie: 'Glas', wert: 12 },
        { jahr: '2021', gemeinde: 'Aesch', kategorie: 'Glas', wert: 7 }
      ],
      'jahr'
    )

    expect(text).toContain('Summe aller Gemeinden')
    expect(text).toContain('2020: 16')
    expect(text).toContain('2021: 19')
  })

  it('sagt es, wenn es keine frueheren Perioden gibt', () => {
    expect(
      beschreibeKantonZeitreihe([{ jahr: '2023', wert: 1 }], 'jahr')
    ).toContain('keine kantonalen Vergleichswerte')
  })
})
