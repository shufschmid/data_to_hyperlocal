import { describe, expect, it } from 'vitest'
import {
  aenderungsSatz,
  MAX_BLAETTER_JE_LAUF,
  zuHolen,
  type GespeicherterMonat
} from './suedanfluglauf'
import type { Ausgabe } from '../shared/euroairport'

const ausgabe = (jahr: number, monat: number, url = 'a.pdf'): Ausgabe => ({
  jahr,
  monat,
  url
})

const gespeichert = (
  jahr: number,
  monat: number,
  ueber: Partial<GespeicherterMonat> = {}
): GespeicherterMonat => ({
  id: `${jahr}-${monat}`,
  jahr,
  monat,
  anfluege: 100,
  suedlandungen: 20,
  quote: 20,
  quelle_url: 'a.pdf',
  pruefsumme: 'abc',
  ...ueber
})

describe('zuHolen', () => {
  it('holt gar nichts, wenn kein Monat neu ist und keine Adresse sich geaendert hat', () => {
    const ergebnis = zuHolen(
      [ausgabe(2026, 7), ausgabe(2026, 8)],
      [gespeichert(2026, 7), gespeichert(2026, 8)],
      MAX_BLAETTER_JE_LAUF
    )

    expect(ergebnis.holen).toEqual([])
    expect(ergebnis.hinweise).toEqual([])
  })

  it('holt einen neuen Monat', () => {
    const ergebnis = zuHolen(
      [ausgabe(2026, 7), ausgabe(2026, 8)],
      [gespeichert(2026, 7)],
      MAX_BLAETTER_JE_LAUF
    )

    expect(ergebnis.holen).toEqual([ausgabe(2026, 8)])
  })

  it('holt einen bekannten Monat, dessen Adresse sich geaendert hat', () => {
    // A re-upload lands at a new address (`…WEBv0_07_1.pdf`). That is the one
    // signal the overview page gives that a month was revised.
    const ergebnis = zuHolen(
      [ausgabe(2026, 7, 'neu.pdf')],
      [gespeichert(2026, 7, { quelle_url: 'alt.pdf' })],
      MAX_BLAETTER_JE_LAUF
    )

    expect(ergebnis.holen).toEqual([ausgabe(2026, 7, 'neu.pdf')])
  })

  it('nimmt die neuesten Monate zuerst und sagt, was liegen bleibt', () => {
    const alle = [
      ausgabe(2025, 11),
      ausgabe(2026, 1),
      ausgabe(2026, 8),
      ausgabe(2026, 7)
    ]

    const ergebnis = zuHolen(alle, [], 2)

    expect(ergebnis.holen).toEqual([ausgabe(2026, 8), ausgabe(2026, 7)])
    // A cap that bites has to be audible, or a first run that read 2 of 51
    // months reads exactly like a source with nothing new.
    expect(ergebnis.hinweise).toEqual([
      '2 von 4 Monatsblaettern gelesen (Deckel 2), der Rest beim naechsten Lauf.'
    ])
  })

  it('haelt einen Monat ohne gespeicherte Adresse fuer neu', () => {
    const ergebnis = zuHolen(
      [ausgabe(2026, 7)],
      [gespeichert(2026, 7, { quelle_url: null })],
      MAX_BLAETTER_JE_LAUF
    )

    expect(ergebnis.holen.length).toBe(1)
  })
})

describe('aenderungsSatz', () => {
  it('schweigt, wenn die Zahlen dieselben sind', () => {
    expect(
      aenderungsSatz(gespeichert(2026, 7), {
        anfluege: 100,
        suedlandungen: 20,
        quote: 20
      })
    ).toBeNull()
  })

  it('nennt den alten Stand, wenn die Quote sich bewegt hat', () => {
    expect(
      aenderungsSatz(gespeichert(2026, 7, { quote: 43.7 }), {
        anfluege: 3778,
        suedlandungen: 1700,
        quote: 45
      })
    ).toBe(
      'Juli 2026: der EuroAirport hat seine Zahlen revidiert — neu 1700 von 3778 Landungen (45 Prozent), zuvor 20 von 100 (43,7 Prozent).'
    )
  })

  it('nennt auch eine Bewegung, die die Quote nicht veraendert', () => {
    // Both figures moved by the same factor: the percentage is unchanged and
    // the month is still a different month than the one we stored.
    expect(
      aenderungsSatz(gespeichert(2026, 7), {
        anfluege: 200,
        suedlandungen: 40,
        quote: 20
      })
    ).toContain('neu 40 von 200')
  })

  it('schweigt bei einem Monat, den wir noch gar nicht hatten', () => {
    expect(
      aenderungsSatz(null, { anfluege: 100, suedlandungen: 20, quote: 20 })
    ).toBeNull()
  })
})
