import { describe, expect, it } from 'vitest'
import {
  erlaubteProzentangaben,
  findeProzentangaben,
  unbelegteProzentangaben,
  zahlenKorrekturHinweis,
  ableitbareProzentangaben,
  ungenaueProzentangaben
} from './zahlen'

describe('findeProzentangaben', () => {
  it('findet Prozentangaben in beiden Schreibweisen', () => {
    expect(findeProzentangaben('61.83 Prozent unter dem Schnitt')).toEqual([
      61.83
    ])
    expect(findeProzentangaben('ein Plus von 8%')).toEqual([8])
  })

  it('versteht das deutsche Dezimalkomma', () => {
    expect(findeProzentangaben('61,83 Prozent')).toEqual([61.83])
  })

  it('findet mehrere', () => {
    expect(findeProzentangaben('8 Prozent hier, 12,5 Prozent dort')).toEqual([
      8, 12.5
    ])
  })

  it('findet nichts, wo nichts ist', () => {
    expect(findeProzentangaben('156 Kilogramm pro Einwohner')).toEqual([])
  })
})

describe('unbelegteProzentangaben', () => {
  // The observed failure: the tool supplied 61.83, the article printed 68.
  it('erkennt eine selbst gerechnete Prozentzahl', () => {
    const text = 'Das entspricht einem Rueckstand von rund 68 Prozent.'
    expect(unbelegteProzentangaben(text, [61.83])).toEqual([68])
  })

  // Rounding is the model doing its job. Flagging it would train the editor to
  // ignore the warnings, and then the check protects nothing.
  it('akzeptiert eine sauber gerundete Angabe', () => {
    expect(unbelegteProzentangaben('rund 62 Prozent', [61.83])).toEqual([])
    expect(unbelegteProzentangaben('rund 61 Prozent', [61.83])).toEqual([])
  })

  it('akzeptiert die woertlich uebernommene Angabe', () => {
    expect(
      unbelegteProzentangaben('61.83 Prozent unter dem Schnitt', [61.83])
    ).toEqual([])
  })

  it('prueft jede Angabe einzeln', () => {
    const text = '8 Prozent mehr Glas, aber 68 Prozent weniger Gruengut.'
    expect(unbelegteProzentangaben(text, [8.2, 61.83])).toEqual([68])
  })

  it('meldet nichts, wenn der Text ohne Prozente auskommt', () => {
    expect(
      unbelegteProzentangaben('156 Kilogramm pro Einwohner', [61.83])
    ).toEqual([])
  })

  // Nothing supplied means nothing may be claimed.
  it('beanstandet jede Prozentangabe, wenn gar keine geliefert wurde', () => {
    expect(unbelegteProzentangaben('rund 40 Prozent', [])).toEqual([40])
  })
})

describe('erlaubteProzentangaben', () => {
  it('liest die Werte aus der Einordnung', () => {
    const einordnung = [
      'Glas · kg pro Einw.: 21.26 gegenueber 20.87 im Kantonsschnitt — 1.87 Prozent ueber dem Kantonsschnitt',
      'Gruengut · kg pro Einw.: 34.9 gegenueber 91.42 im Kantonsschnitt — 61.83 Prozent unter dem Kantonsschnitt'
    ].join('\n')

    expect(erlaubteProzentangaben(einordnung)).toEqual([1.87, 61.83])
  })

  it('kommt mit einer Einordnung ohne Prozente klar', () => {
    expect(erlaubteProzentangaben('(kein Vergleich moeglich)')).toEqual([])
  })
})

describe('zahlenKorrekturHinweis', () => {
  it('nennt die beanstandeten Zahlen und sagt, was zu tun ist', () => {
    const hinweis = zahlenKorrekturHinweis([68])

    expect(hinweis).toContain('68 Prozent')
    expect(hinweis).toContain('Rechne nicht selbst')
  })

  it('schweigt, wenn nichts zu beanstanden ist', () => {
    expect(zahlenKorrekturHinweis([])).toBe('')
  })
})

describe('ableitbareProzentangaben', () => {
  // Der Motorfahrzeug-Fall: Anteil Elektro an den Personenwagen.
  const zeilen = [
    { fahrzeugart: 'Personenwagen', treibstoff: 'Benzin', anzahl: 900 },
    { fahrzeugart: 'Personenwagen', treibstoff: 'Elektrisch', anzahl: 100 },
    { fahrzeugart: 'Motorrad', treibstoff: 'Benzin', anzahl: 500 },
    { fahrzeugart: 'Motorrad', treibstoff: 'Elektrisch', anzahl: 500 }
  ]

  it('leitet Familien-Anteile ab: Elektro an den Personenwagen', () => {
    const erlaubt = ableitbareProzentangaben(zeilen)
    expect(erlaubt).toContain(10) // 100 von 1000 Personenwagen
    expect(erlaubt).toContain(50) // 500 von 1000 Motorraedern
  })

  it('leitet Anteile am Ganzen ab', () => {
    expect(ableitbareProzentangaben(zeilen)).toContain(5) // 100 von 2000
  })

  it('leitet Veraenderungen zwischen allen Punkten einer Reihe ab', () => {
    const erlaubt = ableitbareProzentangaben(
      [],
      [
        {
          gruppe: 'Personenwagen · Elektrisch',
          feld: 'anzahl',
          werte: [
            { periode: '2024-05', wert: 289 },
            { periode: '2025-05', wert: 369 },
            { periode: '2026-08', wert: 511 }
          ]
        }
      ]
    )
    // 289 → 511 ueber die ganze Reihe, 369 → 511 seit dem Vorjahr.
    expect(erlaubt).toContain(76.82)
    expect(erlaubt).toContain(38.48)
  })
})

describe('ungenaueProzentangaben', () => {
  // Gemessen an der ersten Tiefen-Ueberarbeitung: 511 von 9399 sind 5.44
  // Prozent, der Artikel schrieb "5,2" — innerhalb der Ein-Punkt-Toleranz,
  // ausserhalb jeder ehrlichen Rundung.
  it('meldet eine Dezimalangabe, die keine Rundung des Quellwerts ist', () => {
    expect(
      ungenaueProzentangaben('Der Anteil liegt bei 5,2 Prozent.', [5.44])
    ).toEqual([{ zahl: 5.2, naechster: 5.44 }])
  })

  it('laesst ehrliche Rundungen durch — Dezimale eng, Ganzzahl grosszuegig', () => {
    expect(ungenaueProzentangaben('5,4 Prozent', [5.44])).toEqual([])
    expect(ungenaueProzentangaben('rund 5 Prozent', [5.44])).toEqual([])
    expect(ungenaueProzentangaben('62 Prozent', [61.83])).toEqual([])
  })

  it('ueberlaesst voellig unbelegte Werte dem groben Check', () => {
    expect(ungenaueProzentangaben('99 Prozent', [5.44])).toEqual([])
  })
})
