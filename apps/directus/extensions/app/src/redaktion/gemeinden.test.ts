import { describe, expect, it } from 'vitest'
import type { Gemeinde } from '../types/schema'
import {
  describeCoverage,
  hasUsableCoverage,
  istPeriodenwert,
  latestPeriod,
  matchMunicipalities,
  normalizeBfs,
  normalizeName,
  PERIODE_MAX
} from './gemeinden'

function gemeinde(bfs: number, name: string): Gemeinde {
  return {
    id: `id-${bfs}`,
    bfs_nummer: bfs,
    name,
    bezirk: 'Arlesheim',
    aktiv: true,
    date_created: null,
    date_updated: null
  }
}

const AESCH = gemeinde(2761, 'Aesch')
const ALLSCHWIL = gemeinde(2762, 'Allschwil')
const LIESTAL = gemeinde(2829, 'Liestal')

describe('normalizeBfs', () => {
  it('accepts the string form the portal actually sends', () => {
    expect(normalizeBfs('2761')).toBe(2761)
  })

  it('accepts a number', () => {
    expect(normalizeBfs(2761)).toBe(2761)
  })

  it('tolerates padding and whitespace', () => {
    expect(normalizeBfs(' 02761 ')).toBe(2761)
  })

  it('rejects anything that is not a plain number', () => {
    expect(normalizeBfs('2761a')).toBeNull()
    expect(normalizeBfs('Aesch (BL)')).toBeNull()
    expect(normalizeBfs('')).toBeNull()
    expect(normalizeBfs(null)).toBeNull()
    expect(normalizeBfs(undefined)).toBeNull()
    expect(normalizeBfs(27.61)).toBeNull()
  })
})

describe('matchMunicipalities', () => {
  // The reason this whole module matches on numbers: the portal's label for
  // Aesch is "Aesch (BL)", so joining on the name loses it — and loses it
  // silently, which is worse.
  it('matches a municipality whose portal label carries a canton suffix', () => {
    const rows = [
      { bfs_gemeindenummer: '2761', gemeinde: 'Aesch (BL)', wert: 21.3 },
      { bfs_gemeindenummer: '2762', gemeinde: 'Allschwil', wert: 18.9 }
    ]

    const coverage = matchMunicipalities(
      rows,
      [AESCH, ALLSCHWIL],
      'bfs_gemeindenummer'
    )

    expect(coverage.matched.map((t) => t.gemeinde.name)).toEqual([
      'Aesch',
      'Allschwil'
    ])
    expect(coverage.missing).toEqual([])
  })

  it('would have missed it on the name — the trap, stated as a test', () => {
    const portalLabel = 'Aesch (BL)'
    expect(portalLabel).not.toBe(AESCH.name)
  })

  it('groups several rows per municipality', () => {
    const rows = [
      { bfs_gemeindenummer: '2761', kategorie: 'Glas', wert: 21 },
      { bfs_gemeindenummer: '2761', kategorie: 'Papier', wert: 75 },
      { bfs_gemeindenummer: '2762', kategorie: 'Glas', wert: 19 }
    ]

    const coverage = matchMunicipalities(
      rows,
      [AESCH, ALLSCHWIL],
      'bfs_gemeindenummer'
    )

    expect(coverage.matched[0]?.rows).toHaveLength(2)
    expect(coverage.matched[1]?.rows).toHaveLength(1)
  })

  // This is the guard against invented numbers: a municipality with no rows
  // gets reported as missing, so no article is written for it.
  it('reports a municipality that has no rows instead of returning it empty', () => {
    const rows = [{ bfs_gemeindenummer: '2761', wert: 21 }]

    const coverage = matchMunicipalities(
      rows,
      [AESCH, LIESTAL],
      'bfs_gemeindenummer'
    )

    expect(coverage.matched.map((t) => t.gemeinde.name)).toEqual(['Aesch'])
    expect(coverage.missing.map((g) => g.name)).toEqual(['Liestal'])
  })

  it('collects BFS numbers it does not know rather than failing', () => {
    const rows = [
      { bfs_gemeindenummer: '2761', wert: 1 },
      { bfs_gemeindenummer: '9999', wert: 2 },
      { bfs_gemeindenummer: '9999', wert: 3 }
    ]

    const coverage = matchMunicipalities(rows, [AESCH], 'bfs_gemeindenummer')

    expect(coverage.unknown).toEqual([9999])
  })

  it('skips rows whose BFS column is unusable', () => {
    const rows = [
      { bfs_gemeindenummer: '2761', wert: 1 },
      { bfs_gemeindenummer: null, wert: 2 },
      { wert: 3 }
    ]

    const coverage = matchMunicipalities(rows, [AESCH], 'bfs_gemeindenummer')

    expect(coverage.matched[0]?.rows).toHaveLength(1)
    expect(coverage.unknown).toEqual([])
  })

  // The referendum datasets call the column entity_id.
  it('works with whatever the BFS column is called', () => {
    const rows = [{ entity_id: '2829', name: 'Liestal', yeas: 900 }]

    const coverage = matchMunicipalities(rows, [LIESTAL], 'entity_id')

    expect(coverage.matched).toHaveLength(1)
  })
})

describe('hasUsableCoverage', () => {
  it('is false when nothing matched — the run must not produce articles', () => {
    const coverage = matchMunicipalities([], [AESCH], 'bfs_gemeindenummer')
    expect(hasUsableCoverage(coverage)).toBe(false)
  })

  it('is true as soon as one municipality has data', () => {
    const coverage = matchMunicipalities(
      [{ bfs_gemeindenummer: '2761' }],
      [AESCH, LIESTAL],
      'bfs_gemeindenummer'
    )
    expect(hasUsableCoverage(coverage)).toBe(true)
  })
})

describe('describeCoverage', () => {
  it('names the municipalities that were left out', () => {
    const coverage = matchMunicipalities(
      [{ bfs_gemeindenummer: '2761' }, { bfs_gemeindenummer: '7777' }],
      [AESCH, LIESTAL],
      'bfs_gemeindenummer'
    )

    const text = describeCoverage(coverage)

    expect(text).toContain('1 Gemeinden mit Daten')
    expect(text).toContain('Liestal')
    expect(text).toContain('unbekannte BFS-Nummern')
  })
})

describe('latestPeriod', () => {
  it('picks the newest year', () => {
    const rows = [{ jahr: '2024' }, { jahr: '2026' }, { jahr: '2025' }]
    expect(latestPeriod(rows, 'jahr')).toBe('2026')
  })

  it('picks the newest date', () => {
    const rows = [{ date: '2026-06-14' }, { date: '2026-03-03' }]
    expect(latestPeriod(rows, 'date')).toBe('2026-06-14')
  })

  it('ignores unusable values', () => {
    expect(latestPeriod([{ jahr: null }, { jahr: '2025' }, {}], 'jahr')).toBe(
      '2025'
    )
  })

  it('returns null when there is nothing to pick', () => {
    expect(latestPeriod([], 'jahr')).toBeNull()
  })

  // Der Fall aus der Produktion: die Zeitachse darf eine TEXT-Spalte sein, und
  // Buchstaben schlagen im Stringvergleich jede Jahreszahl. Ein einziger
  // Beschriftungswert wurde so zur Periode des Laufs — und sprengte
  // laeufe.periode (varchar 32), worauf der Datensatz bei jedem Tick scheiterte.
  it('laesst Freitext nicht gegen die Jahreszahl gewinnen', () => {
    const rows = [
      { periode: '2024' },
      { periode: 'Zeitraum 2020-2024, provisorisch' },
      { periode: '2026' },
      { periode: 'ohne Angabe' }
    ]
    expect(latestPeriod(rows, 'periode')).toBe('2026')
  })

  it('meldet keine Periode, wenn die Spalte nur Beschriftungen enthaelt', () => {
    expect(latestPeriod([{ periode: 'ohne Angabe' }], 'periode')).toBeNull()
  })

  it('nimmt die ueblichen Periodenformen an', () => {
    expect(istPeriodenwert('2026')).toBe(true)
    expect(istPeriodenwert('2026-06')).toBe(true)
    expect(istPeriodenwert('2026-06-14')).toBe(true)
    expect(istPeriodenwert('2026-06-14T00:00:00+02:00')).toBe(true)
    expect(istPeriodenwert('2026-06-14T00:00:00.000Z')).toBe(true)
    expect(istPeriodenwert('2025/26')).toBe(true)
    expect(istPeriodenwert('2026-Q1')).toBe(true)
  })

  it('weist ab, was keine Periode ist', () => {
    expect(istPeriodenwert('ohne Angabe')).toBe(false)
    expect(istPeriodenwert('Zeitraum 2020-2024, provisorisch')).toBe(false)
    expect(istPeriodenwert('Schuljahr 2023/24')).toBe(false)
    expect(istPeriodenwert('Stand 31.12.2024')).toBe(false)
  })

  // Der Wert ist der eindeutige Schluessel (datensatz, periode): wuerde er beim
  // Lesen getrimmt, bekaeme eine Periode mit Leerzeichen einen zweiten Lauf.
  it('gibt den Wert unveraendert zurueck, auch mit Leerzeichen', () => {
    expect(latestPeriod([{ jahr: ' 2026 ' }], 'jahr')).toBe(' 2026 ')
  })

  it('bleibt unter der Laenge, die laeufe.periode traegt', () => {
    const laengste = '2026-06-14T00:00:00.000+02:00'
    expect(istPeriodenwert(laengste)).toBe(true)
    expect(laengste.length).toBeLessThanOrEqual(PERIODE_MAX)
  })
})

describe('Gemeindespalte von Hand gewaehlt', () => {
  const gemeinden = [
    {
      id: 'g1',
      bfs_nummer: 2761,
      name: 'Aesch',
      bezirk: 'Arlesheim',
      aktiv: true
    },
    {
      id: 'g2',
      bfs_nummer: 2829,
      name: 'Liestal',
      bezirk: 'Liestal',
      aktiv: true
    }
  ] as Gemeinde[]

  // Zeigt der Redaktor auf eine Namensspalte, weil das Portal keine BFS-Nummer
  // annotiert, darf der Kantonszusatz nicht sechs Gemeinden verschlucken.
  it('trifft ueber den Namen, wenn die Spalte keine Nummern enthaelt', () => {
    const coverage = matchMunicipalities(
      [
        { gemeinde: 'Aesch (BL)', wert: 3 },
        { gemeinde: 'Liestal', wert: 16 }
      ],
      gemeinden,
      'gemeinde'
    )

    expect(coverage.matched.map((m) => m.gemeinde.name)).toEqual([
      'Aesch',
      'Liestal'
    ])
    expect(coverage.missing).toEqual([])
  })

  it('bevorzugt weiterhin die Nummer, wo eine steht', () => {
    const coverage = matchMunicipalities(
      [{ bfs: '2761', gemeinde: 'Falsch geschrieben', wert: 1 }],
      gemeinden,
      'bfs'
    )

    expect(coverage.matched[0]?.gemeinde.name).toBe('Aesch')
  })

  it('meldet einen unbrauchbaren Spaltennamen als fehlende Abdeckung', () => {
    const coverage = matchMunicipalities(
      [{ gemeinde: 'Aesch', wert: 1 }],
      gemeinden,
      'gibtsnicht'
    )

    expect(coverage.matched).toEqual([])
    expect(coverage.missing).toHaveLength(2)
  })
})

describe('normalizeName', () => {
  it('entfernt den Kantonszusatz', () => {
    expect(normalizeName('Aesch (BL)')).toBe('aesch')
    expect(normalizeName('  Oberwil (BL) ')).toBe('oberwil')
  })

  it('laesst einen Namen mit Klammer im Wort in Ruhe', () => {
    expect(normalizeName('Sankt (Sankt) Ort')).toBe('sankt (sankt) ort')
  })
})
