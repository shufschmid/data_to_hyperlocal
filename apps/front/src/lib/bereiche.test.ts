import { BEREICHE, bereichsZaehler, bereichVon, zielImBereich } from './bereiche'

describe('Bereiche', () => {
  it('stehen in der Reihenfolge der Redaktion: Gemeinde, Medien, Daten, Chefredaktion', () => {
    expect(BEREICHE.map((b) => b.text)).toEqual(['Gemeinde', 'Medien', 'Daten', 'Chefredaktion'])
  })

  it('fuehren jede Werkbank genau einmal', () => {
    const alle = BEREICHE.flatMap((b) => b.werkbaenke.map((w) => w.wert))
    expect(new Set(alle).size).toBe(alle.length)
    expect(alle).toHaveLength(11)
  })

  it('kennen den Bereich einer Werkbank, nicht aber die Einstellungen', () => {
    expect(bereichVon('amtsblatt')?.wert).toBe('gemeinde')
    expect(bereichVon('kanton')?.wert).toBe('gemeinde')
    expect(bereichVon('punkt6')?.wert).toBe('medien')
    expect(bereichVon('statistik')?.wert).toBe('daten')
    expect(bereichVon('gemeinden')).toBeNull()
    expect(bereichVon('blog')).toBeNull()
  })
})

describe('bereichsZaehler', () => {
  const daten = BEREICHE[2]!

  it('zaehlt die Arbeit der Werkbaenke zusammen', () => {
    expect(
      bereichsZaehler(BEREICHE[0]!, {
        gemeindeseiten: { anzahl: 4, art: 'arbeit' },
        veranstaltungen: { anzahl: 6, art: 'arbeit' },
        amtsblatt: { anzahl: 2, art: 'arbeit' }
      })
    ).toEqual({ anzahl: 12, art: 'arbeit' })
  })

  it('zeigt einen Fehler vor der Arbeit — etwas Falsches draussen ist wichtiger', () => {
    expect(
      bereichsZaehler(daten, {
        statistik: { anzahl: 1, art: 'fehler' },
        sport: { anzahl: 0, art: 'fehler' }
      })
    ).toEqual({ anzahl: 1, art: 'fehler' })
  })

  it('bleibt bei null, wo nichts liegt', () => {
    expect(bereichsZaehler(daten, {})).toEqual({ anzahl: 0, art: 'arbeit' })
  })

  it('traegt die Farbe der Chefredaktion, wo nur sie etwas hat', () => {
    expect(bereichsZaehler(BEREICHE[3]!, { chefredaktion: { anzahl: 3, art: 'chef' } })).toEqual({
      anzahl: 3,
      art: 'chef'
    })
  })
})

describe('zielImBereich', () => {
  it('fuehrt zur zuletzt offenen Werkbank des Bereichs, sonst zur ersten', () => {
    const medien = BEREICHE[1]!
    expect(zielImBereich(medien, {})).toBe('wochenblaetter')
    expect(zielImBereich(medien, { medien: 'punkt6' })).toBe('punkt6')
    expect(zielImBereich(medien, { medien: 'amtsblatt' })).toBe('wochenblaetter')
  })
})
