import type { TischeinstellungFelder } from '@/graphql/redaktion'
import {
  anlassVorschlag,
  einstellungFuer,
  imVorlauf,
  istVorschlag,
  STANDARD_EINSTELLUNG,
  stufeText,
  vorlaufFuer
} from './tische'

const zeile = (ueber: Partial<TischeinstellungFelder> = {}): TischeinstellungFelder => ({
  id: 't',
  tisch: 'veranstaltung',
  schwelle: 2,
  vorlauf_stufe4: 45,
  vorlauf_stufe3: 14,
  vorlauf_stufe2: 7,
  dauerangebote_je_woche: 2,
  ...ueber
})

describe('einstellungFuer', () => {
  it('liest die Zeile des Tischs und nimmt sonst den Standard', () => {
    expect(einstellungFuer([zeile()], 'veranstaltung')).toEqual({
      schwelle: 2,
      vorlauf: { 4: 45, 3: 14, 2: 7 },
      dauerangebote_je_woche: 2
    })
    expect(einstellungFuer([zeile()], 'gemeinde')).toEqual(STANDARD_EINSTELLUNG)
    expect(einstellungFuer([zeile({ schwelle: 9, vorlauf_stufe4: -1 })], 'veranstaltung').schwelle).toBe(3)
  })
})

describe('Schwelle und Vorlauf', () => {
  it('spiegelt die Regel des Laufs', () => {
    expect(istVorschlag(3, 3)).toBe(true)
    expect(istVorschlag(2, 3)).toBe(false)
    expect(istVorschlag(null, 1)).toBe(false)
    expect(vorlaufFuer(4, STANDARD_EINSTELLUNG)).toBe(30)
    expect(vorlaufFuer(undefined, STANDARD_EINSTELLUNG)).toBe(10)
    expect(imVorlauf('2026-10-25', 4, '2026-09-29', STANDARD_EINSTELLUNG)).toBe(true)
    expect(imVorlauf('2026-10-25', 3, '2026-09-29', STANDARD_EINSTELLUNG)).toBe(false)
    expect(imVorlauf(null, 3, '2026-09-29', STANDARD_EINSTELLUNG)).toBe(false)
  })

  it('das Dorffest liegt einen Monat vorher oben, der kleine Vereinsanlass erst grosszuegig und nah', () => {
    const grosszuegig = { ...STANDARD_EINSTELLUNG, schwelle: 2 }
    expect(
      anlassVorschlag({ vorschlag_wert: 4, anker_am: '2026-10-25' }, '2026-09-29', STANDARD_EINSTELLUNG)
    ).toBe(true)
    expect(
      anlassVorschlag({ vorschlag_wert: 2, anker_am: '2026-10-02' }, '2026-09-29', STANDARD_EINSTELLUNG)
    ).toBe(false)
    expect(anlassVorschlag({ vorschlag_wert: 2, anker_am: '2026-10-02' }, '2026-09-29', grosszuegig)).toBe(
      true
    )
    expect(anlassVorschlag({ anker_am: '2026-10-02' }, '2026-09-29', grosszuegig)).toBe(false)
  })

  it('benennt die Stufe auf der Zeile', () => {
    expect(stufeText(4)).toBe('Stufe 4 · wichtig')
    expect(stufeText(null)).toBeNull()
  })
})
