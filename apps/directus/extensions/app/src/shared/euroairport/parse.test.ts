import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EUROAIRPORT_BASIS,
  parseMonatsblatt,
  parseUebersicht,
  type Monatsblatt
} from './parse'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')

const uebersicht = (): string => fixture('uebersicht.html')
const blatt = (name: string): Monatsblatt =>
  parseMonatsblatt(fixture(`${name}.txt`))

describe('parseUebersicht', () => {
  it('liest Jahr und Monat aus den Kopfzeilen, nicht aus dem Dateinamen', () => {
    const ausgaben = parseUebersicht(uebersicht())

    // Measured on the real page, 17 September 2026: 2022 starts in June, 2026
    // ends in August, everything in between is complete.
    expect(ausgaben.length).toBe(51)

    const juli2023 = ausgaben.find((a) => a.jahr === 2023 && a.monat === 7)
    // The file is called "…_2023_Juillet.pdf" — no month NUMBER in the name at
    // all. The cell is what says July, and that is the whole point.
    expect(juli2023?.url).toBe(
      'https://www.euroairport.com/sites/default/files/medias/file/2026/08/Utilisation_ILS33_pour_2023_Juillet.pdf'
    )

    // The upload folder says 2026/09 while the report is August 2026. A reader
    // that believed the folder would file this month a year late.
    const august2026 = ausgaben.find((a) => a.jahr === 2026 && a.monat === 8)
    expect(august2026?.url).toBe(
      'https://www.euroairport.com/sites/default/files/medias/file/2026/09/Utilisation_ILS33_pour_2026_WEBv0_08.pdf'
    )
  })

  it('macht relative Adressen gegen den Host absolut', () => {
    const dezember2024 = parseUebersicht(uebersicht()).find(
      (a) => a.jahr === 2024 && a.monat === 12
    )

    expect(dezember2024?.url).toBe(
      `${EUROAIRPORT_BASIS}/sites/default/files/imported_files/Utilisation_ILS33_pour_2024_WEBv0_12.pdf`
    )
  })

  it('uebergeht leere Zellen, statt sie zu erfinden', () => {
    const ausgaben = parseUebersicht(uebersicht())

    // 2022 carries nothing before June — the cells are there and empty.
    expect(ausgaben.some((a) => a.jahr === 2022 && a.monat < 6)).toBe(false)
    expect(ausgaben.some((a) => a.jahr === 2022 && a.monat === 6)).toBe(true)
  })

  it('ist bei einer Seite ohne Tabelle leer statt ein Fehlschlag', () => {
    expect(parseUebersicht('<html><body><p>Nichts</p></body></html>')).toEqual(
      []
    )
    expect(parseUebersicht('<table><tbody></tbody></table>')).toEqual([])
  })
})

describe('parseMonatsblatt', () => {
  it('liest das Juli-Blatt mit den 43,7 Prozent des Wochenblatts', () => {
    const juli = blatt('2026-07')

    expect(juli.jahr).toBe(2026)
    expect(juli.monat).toBe(7)
    expect(juli.anfluege).toBe(3778)
    expect(juli.suedlandungen).toBe(1652)
    expect(juli.quote).toBe(43.7)
    expect(juli.aktualisiert_am).toBe('2026-08-04')
    expect(juli.tage.length).toBe(31)
    expect(juli.befunde).toEqual([])
  })

  it('liest eine Tageszeile samt Zeitfenstern', () => {
    const august = blatt('2026-08')
    const erster = august.tage[0]

    expect(erster).toEqual({
      datum: '2026-08-01',
      anfluege: 105,
      suedlandungen: 35,
      quote: 33.3,
      zeitfenster: ['13h53-20h30']
    })

    // Two windows, separated by a semicolon and a space.
    expect(august.tage[1]?.zeitfenster).toEqual(['16h07-16h52', '20h10-20h56'])
    // Three windows, no spaces at all (19 August 2026, as printed).
    expect(august.tage[18]?.zeitfenster).toEqual([
      '13h32-15h00',
      '15h20-17h53',
      '18h25-20h36'
    ])
  })

  it('liest den Strich als null Suedlandungen, nicht als fehlenden Wert', () => {
    const august = blatt('2026-08')

    // "03/08/2026 120 - -" — the Uhrzeit column is missing entirely.
    expect(august.tage[2]).toEqual({
      datum: '2026-08-03',
      anfluege: 120,
      suedlandungen: 0,
      quote: 0,
      zeitfenster: []
    })

    // "15/08/2026 102 - - -" — the Uhrzeit column is a dash of its own.
    expect(august.tage[14]).toEqual({
      datum: '2026-08-15',
      anfluege: 102,
      suedlandungen: 0,
      quote: 0,
      zeitfenster: []
    })
  })

  it('liest eine Zeile ohne Uhrzeit', () => {
    // "27/08/2026 124 1 0,8%" — a landing, but no window printed.
    expect(blatt('2026-08').tage[26]).toEqual({
      datum: '2026-08-27',
      anfluege: 124,
      suedlandungen: 1,
      quote: 0.8,
      zeitfenster: []
    })
  })

  it('meldet den Tag, an dem die Quelle sich selbst widerspricht', () => {
    const august = blatt('2026-08')

    // 07/08/2026: 130 south landings on 128 approaches, 101,6 percent. Printed
    // that way in the original; reported, never smoothed.
    expect(august.tage[6]?.suedlandungen).toBe(130)
    expect(august.befunde).toEqual([
      '7. August 2026: 130 Suedlandungen bei 128 Anfluegen (101,6 Prozent) — die Quelle widerspricht sich hier selbst.'
    ])
    // The totals still add up, so nothing else is reported.
    expect(august.anfluege).toBe(3675)
    expect(august.suedlandungen).toBe(973)
    expect(august.quote).toBe(26.5)
  })

  it('liest einen ruhigen Monat und bleibt provisorisch', () => {
    const dezember = blatt('2025-12')

    expect(dezember.jahr).toBe(2025)
    expect(dezember.monat).toBe(12)
    expect(dezember.anfluege).toBe(3152)
    expect(dezember.suedlandungen).toBe(91)
    expect(dezember.quote).toBe(2.9)
    // Updated on 30 January 2026 and STILL marked provisional — which is why a
    // published article can go wrong months later.
    expect(dezember.aktualisiert_am).toBe('2026-01-30')
    expect(dezember.provisorisch).toBe(true)
    expect(dezember.befunde).toEqual([])
    expect(dezember.tage.filter((t) => t.suedlandungen > 0).length).toBe(1)
  })

  it('meldet eine Summe, die nicht zur TOTAL-Zeile passt', () => {
    const text = [
      'Date/Datum Total des atterrissages IFR par jour /',
      '01/08/2026 100 20 20,0% 13h53-20h30',
      '02/08/2026 100 20 20,0% 13h53-20h30',
      'TOTAL 250 40 16,0%',
      'Actualisé le/Aktualisiert am 03/09/2026'
    ].join('\n')

    expect(parseMonatsblatt(text).befunde).toEqual([
      'Die Tageszeilen ergeben 200 Anfluege, die TOTAL-Zeile nennt 250.'
    ])
  })

  it('meldet eine gedruckte Quote, die die eigene Division nicht traegt', () => {
    const text = [
      '01/08/2026 100 20 45,0% 13h53-20h30',
      'TOTAL 100 20 20,0%',
      'Actualisé le/Aktualisiert am 03/09/2026'
    ].join('\n')

    expect(parseMonatsblatt(text).befunde).toEqual([
      '1. August 2026: gedruckt sind 45 Prozent, aus 20 von 100 errechnen sich 20 Prozent.'
    ])
  })

  it('meldet eine TOTAL-Quote, die die eigene Division nicht traegt', () => {
    const text = [
      '01/08/2026 100 20 20,0% 13h53-20h30',
      'TOTAL 100 20 40,0%',
      'Actualisé le/Aktualisiert am 03/09/2026'
    ].join('\n')

    expect(parseMonatsblatt(text).befunde).toEqual([
      'Monatstotal: gedruckt sind 40 Prozent, aus 20 von 100 errechnen sich 20 Prozent.'
    ])
  })

  it('meldet, wenn die Tageszeilen einen anderen Monat nennen als die Tabellenzelle', () => {
    const befunde = parseMonatsblatt(fixture('2026-08.txt'), {
      jahr: 2026,
      monat: 7
    }).befunde

    expect(befunde).toContain(
      'Die Tabellenzelle nennt 07/2026, die Tageszeilen nennen 08/2026.'
    )
  })

  it('wirft bei einer Textschicht ohne eine einzige Tageszeile', () => {
    expect(() => parseMonatsblatt('Provisorische Zahlen')).toThrow(
      /keine Tageszeile/i
    )
  })
})
