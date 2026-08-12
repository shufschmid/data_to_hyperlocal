import { describe, expect, it } from 'vitest'
import {
  findeRelativeZeitangaben,
  korrekturHinweis,
  nenntJahr,
  pruefeZeitbezug
} from './zeitbezug'

describe('findeRelativeZeitangaben — harte Treffer', () => {
  const immerFalsch = [
    'Gestern wurden die Zahlen veroeffentlicht.',
    'Heute liegt der Wert bei 280 Kilogramm.',
    'Dieses Jahr sank die Menge deutlich.',
    'In diesem Jahr sank die Menge deutlich.',
    'Letztes Jahr lag der Wert hoeher.',
    'Im vergangenen Jahr lag der Wert hoeher.',
    'Vergangenes Jahr wurde mehr Glas gesammelt.',
    'Nächstes Jahr tritt die neue Regel in Kraft.',
    'Kürzlich hat der Kanton die Daten publiziert.',
    'Vor kurzem wurde die Statistik aktualisiert.',
    'Derzeit liegt Aesch im Mittelfeld.',
    'Momentan fehlen Vergleichswerte.',
    'Zurzeit ist die Lage unklar.',
    'Aktuell betraegt der Anteil 30 Prozent.',
    'Diese Woche erschien der Bericht.'
  ]

  for (const satz of immerFalsch) {
    it(`erkennt: ${satz}`, () => {
      expect(findeRelativeZeitangaben(satz).hart.length).toBeGreaterThan(0)
    })
  }
})

describe('findeRelativeZeitangaben — was NICHT anschlagen darf', () => {
  const einwandfrei = [
    'Im Jahr 2025 sank die Abfallmenge in Aesch auf 280 Kilogramm pro Person.',
    'Zwischen 2017 und 2025 hat sich der Wert halbiert.',
    'Der Kantonsschnitt lag 2025 bei 287 Kilogramm.',
    'Liestal meldete 2024 noch 310 Kilogramm, 2025 waren es 295.',
    'Die Gemeinde Therwil erreichte 2025 den tiefsten Wert im Bezirk Arlesheim.'
  ]

  for (const satz of einwandfrei) {
    it(`laesst durch: ${satz}`, () => {
      expect(findeRelativeZeitangaben(satz).hart).toEqual([])
    })
  }

  // The reason the check is two-tiered. This sentence is good German and good
  // journalism; a single blocking list would reject it, the editor would stop
  // believing the check, and it would end up protecting nothing.
  it('meldet "Vorjahr" nur weich, blockiert es nicht', () => {
    const befund = findeRelativeZeitangaben(
      'Gegenueber dem Vorjahr 2024 sank die Menge um zwoelf Kilogramm.'
    )
    expect(befund.hart).toEqual([])
    expect(befund.weich).toContain('Vorjahr')
  })

  it('trifft nur ganze Woerter', () => {
    // "heutig" und "Aktuelles" enthalten Treffer als Teilstring
    const befund = findeRelativeZeitangaben(
      'Die Aktuelles-Redaktion arbeitete am heutigen Standort.'
    )
    expect(befund.hart).toEqual([])
  })

  it('ist unabhaengig von Gross- und Kleinschreibung', () => {
    expect(findeRelativeZeitangaben('AKTUELL steigt der Wert.').hart).toContain(
      'aktuell'
    )
  })
})

describe('nenntJahr', () => {
  it('erkennt die Jahreszahl im Text', () => {
    expect(nenntJahr('Im Jahr 2025 lag der Wert bei 280.', '2025')).toBe(true)
  })

  it('erkennt sie auch bei einer Datums-Periode', () => {
    expect(
      nenntJahr('Die Abstimmung vom 14. Juni 2026 ...', '2026-06-14')
    ).toBe(true)
  })

  // The failure no keyword list catches: nothing is relatively phrased, but the
  // text still reads as if it were about now.
  it('faellt auf, wenn das Bezugsjahr gar nicht vorkommt', () => {
    expect(nenntJahr('Die Abfallmenge sank auf 280 Kilogramm.', '2025')).toBe(
      false
    )
  })

  it('laesst sich nicht von einer laengeren Zahl taeuschen', () => {
    expect(nenntJahr('Die Vorlage 20250 wurde angenommen.', '2025')).toBe(false)
    expect(nenntJahr('Es waren 12025 Stimmen.', '2025')).toBe(false)
  })

  it('ist tolerant, wenn die Periode kein Jahr ist', () => {
    expect(nenntJahr('Irgendein Text.', 'Q3')).toBe(true)
  })
})

describe('pruefeZeitbezug', () => {
  it('besteht bei einem sauberen Text', () => {
    const ergebnis = pruefeZeitbezug(
      'Im Jahr 2025 sammelte Aesch 21 Kilogramm Glas pro Person.',
      '2025'
    )
    expect(ergebnis.bestanden).toBe(true)
    expect(ergebnis.hart).toEqual([])
    expect(ergebnis.jahrFehlt).toBe(false)
  })

  it('faellt bei einer harten Zeitangabe durch', () => {
    const ergebnis = pruefeZeitbezug(
      'Vergangenes Jahr sammelte Aesch 21 Kilogramm Glas, 2025 waren es mehr.',
      '2025'
    )
    expect(ergebnis.bestanden).toBe(false)
    expect(ergebnis.hart).toContain('vergangenes Jahr')
  })

  it('faellt auch durch, wenn nur die Jahreszahl fehlt', () => {
    const ergebnis = pruefeZeitbezug(
      'Aesch sammelte 21 Kilogramm Glas pro Person.',
      '2025'
    )
    expect(ergebnis.bestanden).toBe(false)
    expect(ergebnis.hart).toEqual([])
    expect(ergebnis.jahrFehlt).toBe(true)
  })

  it('besteht trotz weicher Treffer', () => {
    const ergebnis = pruefeZeitbezug(
      'Gegenueber dem Vorjahr sank die Menge 2025 um zwoelf Kilogramm.',
      '2025'
    )
    expect(ergebnis.bestanden).toBe(true)
    expect(ergebnis.weich.length).toBeGreaterThan(0)
  })
})

describe('korrekturHinweis', () => {
  // The retry has to name what was wrong — the model already had the rule and
  // broke it, so repeating the rule verbatim would change nothing.
  it('nennt die beanstandeten Woerter woertlich', () => {
    const hinweis = korrekturHinweis(
      { hart: ['vergangenes Jahr', 'derzeit'], jahrFehlt: false },
      '2025'
    )
    expect(hinweis).toContain('"vergangenes Jahr"')
    expect(hinweis).toContain('"derzeit"')
  })

  it('fordert die fehlende Jahreszahl ein', () => {
    const hinweis = korrekturHinweis({ hart: [], jahrFehlt: true }, '2025')
    expect(hinweis).toContain('2025')
  })

  it('nennt beides, wenn beides zutrifft', () => {
    const hinweis = korrekturHinweis(
      { hart: ['heute'], jahrFehlt: true },
      '2026'
    )
    expect(hinweis).toContain('"heute"')
    expect(hinweis).toContain('2026')
  })
})
