import type { TischeinstellungFelder } from '@/graphql/redaktion'
import {
  anlassVorschlag,
  automatischPublizierte,
  autoPublizieren,
  EINSTELLBARE_TISCHE,
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

  it('fuehrt das Buschtelefon als dritten einstellbaren Tisch, mit eigener Zeile', () => {
    expect(EINSTELLBARE_TISCHE.map((t) => t.wert)).toEqual(['gemeinde', 'veranstaltung', 'buschtelefon'])
    expect(einstellungFuer([zeile({ tisch: 'buschtelefon', schwelle: 4 })], 'buschtelefon').schwelle).toBe(4)
    expect(einstellungFuer([zeile()], 'buschtelefon').schwelle).toBe(3)
  })

  it('benennt die Stufe auf der Zeile', () => {
    expect(stufeText(4)).toBe('Stufe 4 · wichtig')
    expect(stufeText(null)).toBeNull()
  })
})

describe('Auto-Publish', () => {
  const meldung = (ueber: Record<string, unknown>) => ({
    id: 'a',
    status: 'publiziert',
    publiziert_durch: 'automatik',
    publiziert_am: '2026-11-15T12:00:00.000Z',
    gemeindemitteilung: { id: 'g' },
    spiel: null,
    ...ueber
  })

  it('ist nur mit einem gespeicherten Ja eingeschaltet', () => {
    const zeile = {
      id: '1',
      tisch: 'kanton',
      schwelle: 3,
      vorlauf_stufe4: 30,
      vorlauf_stufe3: 10,
      vorlauf_stufe2: 5,
      dauerangebote_je_woche: 1
    }
    expect(autoPublizieren([], 'kanton')).toBe(false)
    expect(autoPublizieren([zeile], 'kanton')).toBe(false)
    expect(autoPublizieren([{ ...zeile, auto_publizieren: true }], 'kanton')).toBe(true)
    expect(autoPublizieren([{ ...zeile, auto_publizieren: true }], 'sport')).toBe(false)
  })

  it('zeigt, was der Lauf dieses Tischs publiziert hat — neueste zuerst, 14 Tage', () => {
    const liste = [
      meldung({ id: 'alt', publiziert_am: '2026-10-20T12:00:00.000Z' }),
      meldung({ id: 'gestern' }),
      meldung({ id: 'heute', publiziert_am: '2026-11-16T12:00:00.000Z' }),
      meldung({ id: 'person', publiziert_durch: 'redaktion' }),
      meldung({ id: 'zurueck', status: 'verworfen' }),
      meldung({ id: 'sport', gemeindemitteilung: null, spiel: { id: 's' } })
    ]
    expect(automatischPublizierte(liste, 'gemeinde', '2026-11-16').map((m) => m.id)).toEqual([
      'heute',
      'gestern'
    ])
    expect(automatischPublizierte(liste, 'sport', '2026-11-16').map((m) => m.id)).toEqual(['sport'])
  })
})
