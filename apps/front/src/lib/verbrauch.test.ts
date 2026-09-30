import { tischName, tokensKurz, verlustText } from './verbrauch'

describe('verbrauch', () => {
  it('kuerzt Tokens auf eine lesbare Groessenordnung', () => {
    expect(tokensKurz(999)).toBe('999')
    expect(tokensKurz(45_678)).toBe('45,7 k')
    expect(tokensKurz(1_234_567)).toBe('1,2 Mio.')
    expect(tokensKurz(Number.NaN)).toBe('–')
  })

  it('nennt den Tisch wie die Werkbank, Unbekanntes bleibt sichtbar', () => {
    expect(tischName('veranstaltungen')).toBe('Veranstaltungen')
    expect(tischName('lernen')).toBe('Lernschicht')
    expect(tischName('irgendwas')).toBe('irgendwas')
  })

  it('sagt, was Geld fuer nichts war', () => {
    const summe = {
      aufrufe: 3,
      eingabe_tokens: 0,
      ausgabe_tokens: 0,
      cache_gelesen_tokens: 0,
      cache_geschrieben_tokens: 0
    }
    expect(verlustText({ ...summe, abgebrochen: 0, fehler: 0 })).toBeNull()
    expect(verlustText({ ...summe, abgebrochen: 2, fehler: 1 })).toBe('2 abgebrochen, 1 gescheitert')
  })
})
