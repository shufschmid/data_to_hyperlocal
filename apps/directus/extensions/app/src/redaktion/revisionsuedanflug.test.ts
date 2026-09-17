import { describe, expect, it } from 'vitest'
import {
  revisionsBefundSuedanflug,
  revisionsSchreibungenSuedanflug,
  type MonatsStand
} from './revisionsuedanflug'

const JETZT = '2026-09-17T10:00:00.000Z'

const stand = (ueber: Partial<MonatsStand> = {}): MonatsStand => ({
  jahr: 2026,
  monat: 7,
  anfluege: 3778,
  suedlandungen: 1652,
  quote: 43.7,
  ...ueber
})

const meldung = (
  ueber: Partial<{ titel: string; lead: string; text: string }> = {}
) => ({
  titel: 'Fast jede zweite Landung über den Süden',
  lead: 'Im Juli 2026 waren es 43,7 Prozent.',
  text: '1652 von 3778 Landungen gingen über den Süden, wie der EuroAirport meldet.',
  ...ueber
})

describe('revisionsBefundSuedanflug', () => {
  it('schweigt, wenn sich nichts bewegt hat', () => {
    expect(
      revisionsBefundSuedanflug(meldung(), stand(), stand(), JETZT)
    ).toBeNull()
  })

  it('meldet eine revidierte Quote, die der Text noch nennt', () => {
    const befund = revisionsBefundSuedanflug(
      meldung(),
      stand(),
      stand({ suedlandungen: 1700, quote: 45 }),
      JETZT
    )

    expect(befund).toContain('45 Prozent statt 43,7 Prozent')
    expect(befund).toContain('Juli 2026')
    expect(befund).toContain('17. September 2026')
  })

  it('meldet eine revidierte Zahl, auch wenn die Quote gleich bleibt', () => {
    // 3304 von 7556 ist dieselbe Quote und nicht derselbe Monat — ein Text,
    // der die absoluten Zahlen nennt, ist danach falsch.
    const befund = revisionsBefundSuedanflug(
      meldung(),
      stand(),
      stand({ anfluege: 7556, suedlandungen: 3304 }),
      JETZT
    )

    expect(befund).not.toBeNull()
    expect(befund).toContain('3304 von 7556')
  })

  it('schweigt, wenn der Text die bewegte Zahl gar nie genannt hat', () => {
    // «Der Juli war laut» steht nach jeder Revision noch da. Eine Warnung
    // darauf wuerde die Redaktorin lehren, den Chip zu uebersehen.
    const ohneZahl = {
      titel: 'Ein lauter Juli über dem Leimental',
      lead: 'Der EuroAirport hat mehr Landungen über den Süden geführt als sonst.',
      text: 'Wie viele es genau waren, steht im Monatsblatt.'
    }

    expect(
      revisionsBefundSuedanflug(
        ohneZahl,
        stand(),
        stand({ quote: 45, suedlandungen: 1700 }),
        JETZT
      )
    ).toBeNull()
  })

  it('schweigt bei einer Meldung ohne Text', () => {
    expect(
      revisionsBefundSuedanflug(
        { titel: null, lead: null, text: null },
        stand(),
        stand({ quote: 45 }),
        JETZT
      )
    ).toBeNull()
  })

  it('erkennt die Quote auch mit Dezimalkomma im Text', () => {
    const befund = revisionsBefundSuedanflug(
      { titel: null, lead: 'Es waren 43,7 Prozent.', text: null },
      stand(),
      stand({ quote: 41.2, suedlandungen: 1556 }),
      JETZT
    )

    expect(befund).not.toBeNull()
  })
})

describe('revisionsSchreibungenSuedanflug', () => {
  it('schreibt nur, wo sich der Stand wirklich aendert', () => {
    const neu = stand({ suedlandungen: 1700, quote: 45 })
    const schonDa = revisionsBefundSuedanflug(meldung(), stand(), neu, JETZT)

    const schreibungen = revisionsSchreibungenSuedanflug(
      [
        { id: 'm-1', ...meldung(), revision_hinweis: null },
        // Traegt den Befund schon — nichts zu tun, sonst wanderte
        // `date_updated` bei jedem Lauf.
        { id: 'm-2', ...meldung(), revision_hinweis: schonDa }
      ],
      stand(),
      neu,
      JETZT
    )

    expect(schreibungen.map((s) => s.id)).toEqual(['m-1'])
    expect(schreibungen[0]?.revision_geprueft_am).toBe(JETZT)
  })

  it('loescht einen Befund, der nicht mehr gilt', () => {
    // Der Flughafen hat zurueckkorrigiert: der Beitrag stimmt wieder.
    const schreibungen = revisionsSchreibungenSuedanflug(
      [{ id: 'm-1', ...meldung(), revision_hinweis: 'Alter Befund.' }],
      stand(),
      stand(),
      JETZT
    )

    expect(schreibungen).toEqual([
      { id: 'm-1', revision_hinweis: null, revision_geprueft_am: JETZT }
    ])
  })
})
