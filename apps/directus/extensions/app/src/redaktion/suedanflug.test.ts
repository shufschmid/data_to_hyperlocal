import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMonatsblatt, type Monatsblatt } from '../shared/euroairport'
import {
  bewerteMonat,
  leseSchwellen,
  STANDARD_SCHWELLEN,
  type Schwellen
} from './suedanflug'
import type { GespeicherterMonat } from './suedanfluglauf'

const blatt = (name: string): Monatsblatt =>
  parseMonatsblatt(
    readFileSync(
      join(__dirname, '..', 'shared', 'euroairport', 'fixtures', `${name}.txt`),
      'utf8'
    )
  )

const monat = (
  jahr: number,
  m: number,
  anfluege: number,
  suedlandungen: number
): GespeicherterMonat => ({
  id: `${jahr}-${m}`,
  jahr,
  monat: m,
  anfluege,
  suedlandungen,
  quote: Math.round((suedlandungen / anfluege) * 1000) / 10,
  quelle_url: null,
  pruefsumme: null
})

describe('leseSchwellen', () => {
  it('nimmt die Schwellen aus der Quellenzeile', () => {
    expect(
      leseSchwellen({ monatsschwelle: 35, jahresschwellen: [8, 10, 12] })
    ).toEqual({ monatsschwelle: 35, jahresschwellen: [8, 10, 12] })
  })

  it('faellt auf die Vorgabe zurueck, wenn die Zeile nichts sagt', () => {
    // 40 percent is the newsroom's own threshold (Jolanda, 17 September 2026),
    // 8 and 10 the runway-use agreement of 10 February 2006.
    expect(leseSchwellen(null)).toEqual(STANDARD_SCHWELLEN)
    expect(leseSchwellen({})).toEqual(STANDARD_SCHWELLEN)
    expect(leseSchwellen('kaputt')).toEqual(STANDARD_SCHWELLEN)
  })

  it('uebergeht Unsinn in einzelnen Feldern, statt ihn zu uebernehmen', () => {
    expect(
      leseSchwellen({ monatsschwelle: 'viel', jahresschwellen: [8, 'zehn'] })
    ).toEqual({ monatsschwelle: 40, jahresschwellen: [8] })
  })
})

describe('bewerteMonat', () => {
  const schwellen: Schwellen = STANDARD_SCHWELLEN

  it('schlaegt den Juli 2026 vor: 43,7 Prozent ueber der Monatsschwelle', () => {
    const juli = blatt('2026-07')
    const bewertung = bewerteMonat(juli, [monat(2026, 6, 3737, 596)], schwellen)

    expect(bewertung.vorschlag).toBe(true)
    expect(bewertung.neuUeberschritten).toEqual([
      'Monatsschwelle der Redaktion: 40 Prozent'
    ])
    // The year thresholds are exceeded too — June alone was already 15,9
    // percent — but they were exceeded before this month, so they are STATE
    // and not news. Both are reported; only the crossing proposes.
    expect(bewertung.ueberschritten).toEqual([
      'Monatsschwelle der Redaktion: 40 Prozent',
      'Jahresschwelle der Pistenbenutzungsvereinbarung: 8 Prozent',
      'Jahresschwelle der Pistenbenutzungsvereinbarung: 10 Prozent'
    ])
    expect(bewertung.begruendung).toContain('43,7 Prozent')
    expect(bewertung.vormonat).toEqual({ jahr: 2026, monat: 6, quote: 15.9 })
    expect(bewertung.vorjahresmonat).toBeNull()
  })

  it('schlaegt den August 2026 nicht vor: 26,5 Prozent, unter der Schwelle', () => {
    const august = blatt('2026-08')
    const bewertung = bewerteMonat(
      august,
      [monat(2026, 7, 3778, 1652)],
      schwellen
    )

    expect(bewertung.vorschlag).toBe(false)
    expect(bewertung.neuUeberschritten).toEqual([])
    expect(bewertung.begruendung).toBeNull()
  })

  it('schlaegt einen Monat vor, der die Jahresschwelle erst reisst', () => {
    // A quiet start to the year, then August's 26,5 percent pushes the year
    // figure past both marks of the agreement for the first time.
    const bewertung = bewerteMonat(
      blatt('2026-08'),
      [monat(2026, 7, 3778, 100)],
      schwellen
    )

    expect(bewertung.vorschlag).toBe(true)
    expect(bewertung.neuUeberschritten).toEqual([
      'Jahresschwelle der Pistenbenutzungsvereinbarung: 8 Prozent',
      'Jahresschwelle der Pistenbenutzungsvereinbarung: 10 Prozent'
    ])
  })

  it('rechnet die Jahresquote ueber die Monate, die wir haben, und sagt wie viele', () => {
    const august = blatt('2026-08')
    const bewertung = bewerteMonat(
      august,
      [monat(2026, 6, 3737, 596), monat(2026, 7, 3778, 1652)],
      schwellen
    )

    // 596 + 1652 + 973 of 3737 + 3778 + 3675 = 3221 of 11190 = 28,8 percent.
    expect(bewertung.jahresAnfluege).toBe(11190)
    expect(bewertung.jahresSuedlandungen).toBe(3221)
    expect(bewertung.jahresquote).toBe(28.8)
    // Complete or declared: a year figure from three of twelve months is a
    // partial year, and whoever writes from it has to be able to say so.
    expect(bewertung.jahresmonate).toBe(3)
  })

  it('nennt die Jahresschwellen der Vereinbarung, wenn die Jahresquote sie reisst', () => {
    const august = blatt('2026-08')
    const bewertung = bewerteMonat(august, [], schwellen)

    // August alone is 26,5 percent, so both 8 and 10 are exceeded — and with
    // no earlier month held, both are crossed for the first time.
    expect(bewertung.ueberschritten).toEqual([
      'Jahresschwelle der Pistenbenutzungsvereinbarung: 8 Prozent',
      'Jahresschwelle der Pistenbenutzungsvereinbarung: 10 Prozent'
    ])
    expect(bewertung.neuUeberschritten).toEqual(bewertung.ueberschritten)
    expect(bewertung.vorschlag).toBe(true)
  })

  it('zaehlt die Tage ueber 30 und ueber 50 Prozent und nennt den hoechsten', () => {
    const juli = blatt('2026-07')
    const bewertung = bewerteMonat(juli, [], schwellen)

    expect(bewertung.tageUeber30).toBe(21)
    expect(bewertung.tageUeber50).toBe(11)
    expect(bewertung.hoechsterTag).toEqual({
      datum: '2026-07-20',
      anfluege: 126,
      suedlandungen: 120,
      quote: 95.2
    })
  })

  it('findet den Vorjahresmonat, wenn wir ihn haben', () => {
    const juli = blatt('2026-07')
    const bewertung = bewerteMonat(juli, [monat(2025, 7, 3700, 836)], schwellen)

    expect(bewertung.vorjahresmonat).toEqual({
      jahr: 2025,
      monat: 7,
      quote: 22.6
    })
  })

  it('urteilt, schreibt aber nicht', () => {
    const bewertung = bewerteMonat(blatt('2025-12'), [], STANDARD_SCHWELLEN)

    // A quiet month: 2,9 percent, under every threshold, nothing to propose.
    expect(bewertung.vorschlag).toBe(false)
    expect(bewertung.jahresquote).toBe(2.9)
    expect(bewertung.tageUeber30).toBe(1)
    expect(bewertung.hoechsterTag?.datum).toBe('2025-12-24')
  })
})
