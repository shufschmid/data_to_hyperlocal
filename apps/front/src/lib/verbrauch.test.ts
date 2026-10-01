import { betrag, einstellungFuer, etatKnapp, tischName, tokensKurz, verlustText } from './verbrauch'

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

  it('zeigt Geld mit Waehrung, Kleines mit drei Stellen, ohne Preise einen Strich', () => {
    expect(betrag(12.345, 'USD')).toBe('12.35 USD')
    expect(betrag(0.0047, 'USD')).toBe('0.005 USD')
    expect(betrag(0, 'USD')).toBe('0.00 USD')
    expect(betrag(3, null)).toBe('–')
  })

  it('sagt, was Geld fuer nichts war', () => {
    expect(verlustText({ abgebrochen: 0, fehler: 0 })).toBeNull()
    expect(verlustText({ abgebrochen: 2, fehler: 1 })).toBe('2 abgebrochen, 1 gescheitert')
  })

  it('die Einstellung gilt genau fuer den Zweck, sonst fuer den Tisch', () => {
    const e = [
      { zweck: 'amtsblatt', modell: 'claude-haiku-4-5-20251001', max_tokens: null, notiz: null },
      { zweck: 'amtsblatt:plaene', modell: 'claude-sonnet-5', max_tokens: null, notiz: null }
    ]
    expect(einstellungFuer(e, 'amtsblatt:plaene')?.modell).toBe('claude-sonnet-5')
    expect(einstellungFuer(e, 'amtsblatt:sichtung')?.modell).toBe('claude-haiku-4-5-20251001')
    expect(einstellungFuer(e, 'kanton:sichtung')).toBeNull()
  })

  it('ein Etat ist knapp, wenn die groesste Antwort an die Grenze kam oder eine abbrach', () => {
    expect(etatKnapp({ max_tokens_zuletzt: 4000, ausgabe_max: 3700, abgebrochen: 0 })).toBe(true)
    expect(etatKnapp({ max_tokens_zuletzt: 4000, ausgabe_max: 1200, abgebrochen: 0 })).toBe(false)
    expect(etatKnapp({ max_tokens_zuletzt: null, ausgabe_max: 9000, abgebrochen: 1 })).toBe(true)
  })
})
