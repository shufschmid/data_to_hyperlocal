import { describe, expect, it } from 'vitest'
import {
  alleDaten,
  heuteAus,
  jahrAusKurzform,
  jahrFuerMonatTag,
  jahrFuerMonatTagVorwaerts,
  monatVon,
  parseDatum,
  plausibel
} from './datum'

const HEUTE = heuteAus('2026-09-14')

describe('parseDatum', () => {
  it('liest die Formen der neun Gemeindeseiten', () => {
    expect(parseDatum('Mittwoch, 19.08.2026', HEUTE)).toBe('2026-08-19')
    expect(parseDatum(' 08.09.2026 ', HEUTE)).toBe('2026-09-08')
    expect(parseDatum('03. Sep 2026', HEUTE)).toBe('2026-09-03')
    expect(parseDatum('14. Sep 2026', HEUTE)).toBe('2026-09-14')
    expect(parseDatum('11. September 2026', HEUTE)).toBe('2026-09-11')
    expect(parseDatum('2026-09-10 07:55', HEUTE)).toBe('2026-09-10')
    expect(parseDatum('14.09.26', HEUTE)).toBe('2026-09-14')
  })

  it('weist das Jahr 2626 und unmoegliche Tage ab', () => {
    expect(parseDatum('2626-09-14', HEUTE)).toBeNull()
    expect(parseDatum('31.02.2026', HEUTE)).toBeNull()
    expect(parseDatum('kein Datum', HEUTE)).toBeNull()
  })

  it('haelt den Deckel bei naechstem Jahr — ein altes Datum bleibt ein Datum', () => {
    expect(parseDatum('30.06.2027', HEUTE)).toBe('2027-06-30')
    expect(parseDatum('01.01.2028', HEUTE)).toBeNull()
    expect(parseDatum('01.01.2024', HEUTE)).toBe('2024-01-01')
    expect(parseDatum('31.12.2023', HEUTE)).toBe('2023-12-31')
    expect(parseDatum('31.12.1999', HEUTE)).toBeNull()
  })

  it('nimmt das erste plausible Datum eines Textes — Dateinamen werden ihm deshalb nie gegeben', () => {
    expect(parseDatum('Sitzordnung-01.07.2026-30.06.2027.pdf', HEUTE)).toBe(
      '2026-07-01'
    )
  })
})

describe('Jahres-Ableitungen', () => {
  it('ergaenzt ein zweistelliges Jahr um das Jahrhundert, das nicht in die Zukunft zeigt', () => {
    expect(jahrAusKurzform(26, HEUTE)).toBe(2026)
    expect(jahrAusKurzform(27, HEUTE)).toBe(2027)
    expect(jahrAusKurzform(28, HEUTE)).toBe(1928)
    expect(jahrAusKurzform(99, HEUTE)).toBe(1999)
  })

  it('legt ein Kalender-Kaestchen ohne Jahr ins laufende Jahr, ausser der Tag laege noch vor uns', () => {
    expect(jahrFuerMonatTag(9, 14, HEUTE)).toBe(2026)
    expect(jahrFuerMonatTag(9, 10, HEUTE)).toBe(2026)
    expect(jahrFuerMonatTag(9, 15, HEUTE)).toBe(2025)
    expect(jahrFuerMonatTag(7, 2, HEUTE)).toBe(2026)
    expect(jahrFuerMonatTag(12, 31, HEUTE)).toBe(2025)
    expect(jahrFuerMonatTag(1, 1, HEUTE)).toBe(2026)
  })

  it('legt einen angekuendigten Termin ohne Jahr nach vorn', () => {
    expect(jahrFuerMonatTagVorwaerts(9, 22, HEUTE)).toBe(2026)
    expect(jahrFuerMonatTagVorwaerts(9, 14, HEUTE)).toBe(2026)
    expect(jahrFuerMonatTagVorwaerts(1, 5, HEUTE)).toBe(2027)
  })
})

describe('monatVon', () => {
  it('kennt Kurz- und Langformen, auch die uneinheitlichen', () => {
    expect(monatVon('Sep')).toBe(9)
    expect(monatVon('Sept.')).toBe(9)
    expect(monatVon('September')).toBe(9)
    expect(monatVon('Juli')).toBe(7)
    expect(monatVon('Jul')).toBe(7)
    expect(monatVon('März')).toBe(3)
    expect(monatVon('Maerz')).toBe(3)
    expect(monatVon('Mrz')).toBe(3)
    expect(monatVon('Okt')).toBe(10)
    expect(monatVon('Sommer')).toBeNull()
    expect(monatVon('')).toBeNull()
  })
})

describe('plausibel', () => {
  it('verlangt einen echten Kalendertag, nicht spaeter als naechstes Jahr', () => {
    expect(plausibel('2026-02-29', HEUTE)).toBe(false)
    expect(plausibel('2024-02-29', HEUTE)).toBe(true)
    expect(plausibel('2026-13-01', HEUTE)).toBe(false)
    expect(plausibel('nicht-iso', HEUTE)).toBe(false)
    expect(plausibel('2027-12-31', HEUTE)).toBe(true)
    expect(plausibel('2028-01-01', HEUTE)).toBe(false)
    expect(plausibel('2626-09-14', HEUTE)).toBe(false)
  })

  it('ein altes Datum ist alt, nicht unbekannt — das Archiv einer i-web-Liste bleibt datiert', () => {
    expect(plausibel('2022-03-22', HEUTE)).toBe(true)
    expect(plausibel('2020-10-28', HEUTE)).toBe(true)
    expect(plausibel('2000-01-01', HEUTE)).toBe(true)
    expect(plausibel('1999-12-31', HEUTE)).toBe(false)
  })
})

describe('alleDaten', () => {
  it('sammelt jede genannte Tagesangabe einmal, in Textreihenfolge', () => {
    expect(
      alleDaten(
        'Papiersammlung am 22.09.2026 und am 20. Oktober 2026, nochmals 22.09.2026.',
        HEUTE
      )
    ).toEqual(['2026-09-22', '2026-10-20'])
  })

  it('legt Nennungen ohne Jahr nach vorn', () => {
    expect(
      alleDaten(
        'Die Gruengutabfuhr vom Montag, 22. September faellt aus.',
        HEUTE
      )
    ).toEqual(['2026-09-22'])
    expect(alleDaten('Ab 5. Januar gilt der neue Kalender.', HEUTE)).toEqual([
      '2027-01-05'
    ])
  })

  it('laesst unplausible Angaben liegen', () => {
    expect(alleDaten('Vom 31.02.2026 und 2626-09-14.', HEUTE)).toEqual([])
  })
})
