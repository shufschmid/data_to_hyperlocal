import { describe, expect, it } from 'vitest'
import {
  erlaubteProzentangaben,
  findeProzentangaben,
  unbelegteProzentangaben,
  zahlenKorrekturHinweis
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
