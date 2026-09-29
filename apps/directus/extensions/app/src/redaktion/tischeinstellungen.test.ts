import { describe, expect, it } from 'vitest'
import {
  anlassVorschlag,
  imVorlauf,
  istVorschlag,
  ladeTischeinstellung,
  STANDARD_EINSTELLUNG,
  stufeAus,
  tischeinstellungAus,
  tischeinstellungFelder,
  vorlaufFuer
} from './tischeinstellungen'

const STILL = { warn: () => undefined }

describe('tischeinstellungAus', () => {
  it('liest eine Zeile und faellt je Feld auf den Standard zurueck', () => {
    expect(tischeinstellungAus(null)).toEqual(STANDARD_EINSTELLUNG)
    expect(
      tischeinstellungAus({
        schwelle: 2,
        vorlauf_stufe4: 45,
        vorlauf_stufe3: null,
        vorlauf_stufe2: 500,
        dauerangebote_je_woche: 3
      })
    ).toEqual({
      schwelle: 2,
      vorlauf: { 4: 45, 3: 10, 2: 5 },
      dauerangebote_je_woche: 3
    })
    expect(tischeinstellungAus({ schwelle: 9 }).schwelle).toBe(3)
  })

  it('kennt nur vier Stufen', () => {
    expect(stufeAus(3)).toBe(3)
    expect(stufeAus(5)).toBeNull()
    expect(stufeAus('3')).toBeNull()
  })
})

describe('Schwelle und Vorlauf', () => {
  it('ein Vorschlag ist, was die Schwelle erreicht — nie eine unbenotete Zeile', () => {
    expect(istVorschlag(3, 3)).toBe(true)
    expect(istVorschlag(2, 3)).toBe(false)
    expect(istVorschlag(2, 2)).toBe(true)
    expect(istVorschlag(null, 1)).toBe(false)
  })

  it('der Vorlauf haengt an der Stufe: das Dorffest kommt einen Monat vorher, der Vereinsanlass fuenf Tage', () => {
    expect(vorlaufFuer(4, STANDARD_EINSTELLUNG)).toBe(30)
    expect(vorlaufFuer(3, STANDARD_EINSTELLUNG)).toBe(10)
    expect(vorlaufFuer(2, STANDARD_EINSTELLUNG)).toBe(5)
    expect(vorlaufFuer(null, STANDARD_EINSTELLUNG)).toBe(10)
    expect(imVorlauf('2026-10-25', 4, '2026-09-29', STANDARD_EINSTELLUNG)).toBe(
      true
    )
    expect(imVorlauf('2026-10-25', 3, '2026-09-29', STANDARD_EINSTELLUNG)).toBe(
      false
    )
    expect(imVorlauf('2026-10-25', 3, '2026-10-15', STANDARD_EINSTELLUNG)).toBe(
      true
    )
  })

  it('auf dem Veranstaltungstisch braucht es beides: Note und Vorlauf', () => {
    const grosszuegig = { ...STANDARD_EINSTELLUNG, schwelle: 2 as const }
    expect(
      anlassVorschlag(
        { vorschlag_wert: 4, anker_am: '2026-10-25' },
        '2026-09-29',
        STANDARD_EINSTELLUNG
      )
    ).toBe(true)
    expect(
      anlassVorschlag(
        { vorschlag_wert: 2, anker_am: '2026-10-02' },
        '2026-09-29',
        STANDARD_EINSTELLUNG
      )
    ).toBe(false)
    expect(
      anlassVorschlag(
        { vorschlag_wert: 2, anker_am: '2026-10-02' },
        '2026-09-29',
        grosszuegig
      )
    ).toBe(true)
    expect(
      anlassVorschlag(
        { vorschlag_wert: 2, anker_am: '2026-10-20' },
        '2026-09-29',
        grosszuegig
      )
    ).toBe(false)
  })
})

describe('tischeinstellungFelder', () => {
  it('nimmt nur die genannten Spalten, geprueft', () => {
    expect(
      tischeinstellungFelder({ schwelle: 2, vorlauf_stufe4: '45' })
    ).toEqual({ schwelle: 2, vorlauf_stufe4: 45 })
    expect(() => tischeinstellungFelder({ schwelle: 0 })).toThrow(/Schwelle/)
    expect(() => tischeinstellungFelder({ dauerangebote_je_woche: 9 })).toThrow(
      /Dauerangebote/
    )
    expect(() => tischeinstellungFelder({})).toThrow(/Keine Einstellung/)
  })
})

describe('ladeTischeinstellung', () => {
  it('liest die Zeile des Tischs und faellt ohne Tabelle auf den Standard zurueck', async () => {
    const dienst = {
      readByQuery: async (q: Record<string, unknown>) => {
        expect(q['filter']).toEqual({ tisch: { _eq: 'veranstaltung' } })
        return [
          {
            schwelle: 2,
            vorlauf_stufe4: 40,
            vorlauf_stufe3: 14,
            vorlauf_stufe2: 7,
            dauerangebote_je_woche: 2
          }
        ]
      }
    }
    expect(await ladeTischeinstellung(dienst, 'veranstaltung', STILL)).toEqual({
      schwelle: 2,
      vorlauf: { 4: 40, 3: 14, 2: 7 },
      dauerangebote_je_woche: 2
    })
    const kaputt = {
      readByQuery: async () => {
        throw new Error('relation "tischeinstellungen" does not exist')
      }
    }
    expect(await ladeTischeinstellung(kaputt, 'gemeinde', STILL)).toEqual(
      STANDARD_EINSTELLUNG
    )
  })
})
