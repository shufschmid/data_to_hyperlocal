import { describe, expect, it } from 'vitest'
import {
  blattAusZeile,
  faktenFuer,
  meldungsfelder,
  type Quotenzeile
} from './suedanflug'

const URL_JULI =
  'https://www.euroairport.com/sites/default/files/medias/file/2026/08/Utilisation_ILS33_pour_2026_WEBv0_07.pdf'

const zeile = (ueber: Partial<Quotenzeile> = {}): Quotenzeile => ({
  id: 'q-1',
  jahr: 2026,
  monat: 7,
  anfluege: 3778,
  suedlandungen: 1652,
  quote: 43.7,
  aktualisiert_am: '2026-08-04',
  provisorisch: true,
  tage: [
    {
      datum: '2026-07-20',
      anfluege: 126,
      suedlandungen: 120,
      quote: 95.2,
      zeitfenster: ['00h05', '08h25-23h24']
    }
  ],
  befunde: [],
  quelle_url: URL_JULI,
  ...ueber
})

const gemeinde = { name: 'Binningen', suedanflug: true }

describe('blattAusZeile', () => {
  it('baut das Blatt aus den gespeicherten Spalten', () => {
    const blatt = blattAusZeile(zeile())

    expect(blatt.jahr).toBe(2026)
    expect(blatt.anfluege).toBe(3778)
    expect(blatt.tage.length).toBe(1)
  })

  it('verweigert eine Zeile ohne Zahlen', () => {
    expect(() => blattAusZeile(zeile({ anfluege: null }))).toThrow()
  })

  it('verweigert eine Zeile ohne Adresse des Monatsblatts', () => {
    // The source line is built by code and carries exactly one address. A
    // Meldung that names a source a reader cannot open is worse than none.
    expect(() => blattAusZeile(zeile({ quelle_url: null }))).toThrow()
    expect(() => blattAusZeile(zeile({ quelle_url: '  ' }))).toThrow()
  })
})

describe('faktenFuer', () => {
  it('weist eine Gemeinde ab, die nicht als betroffen erfasst ist', () => {
    // Who lies under the approach is the newsroom's judgement and lives in
    // `gemeinden.suedanflug`. Without it there is no article, because the
    // article's whole point is «also ueber dieser Gemeinde».
    expect(() =>
      faktenFuer({
        zeile: zeile(),
        gemeinde: { name: 'Dornach', suedanflug: false },
        bestand: [],
        quelle: null
      })
    ).toThrow(/nicht als Suedanflug-Gemeinde/)
  })

  it('nimmt die Schwellen aus der Quellenzeile', () => {
    const fakten = faktenFuer({
      zeile: zeile(),
      gemeinde,
      bestand: [],
      quelle: { konfiguration: { monatsschwelle: 60, jahresschwellen: [8] } }
    })

    expect(fakten.schwellen.monatsschwelle).toBe(60)
    // 43,7 percent is below 60, so the newsroom's threshold does not fire —
    // the year one still does.
    expect(fakten.bewertung.neuUeberschritten).toEqual([
      'Jahresschwelle der Pistenbenutzungsvereinbarung: 8 Prozent'
    ])
  })

  it('faellt ohne Quellenzeile auf die Vorgabe zurueck', () => {
    const fakten = faktenFuer({
      zeile: zeile(),
      gemeinde,
      bestand: [],
      quelle: null
    })

    expect(fakten.schwellen.monatsschwelle).toBe(40)
    expect(fakten.gemeinde).toBe('Binningen')
    expect(fakten.quelleUrl).toBe(URL_JULI)
  })
})

describe('meldungsfelder', () => {
  it('haengt die Quellenzeile an und legt die Warnungen ab', () => {
    const fakten = faktenFuer({
      zeile: zeile(),
      gemeinde,
      bestand: [],
      quelle: null
    })

    const felder = meldungsfelder(
      {
        bericht: { titel: 'Titel', lead: 'Lead.', text: 'Text.' },
        warnungen: ['Zahl "4000" steht nicht in den Angaben.']
      },
      fakten
    )

    expect(felder['text']).toContain('Quelle: EuroAirport')
    expect(felder['text']).toContain(URL_JULI)
    expect(felder['zeit_warnungen']).toEqual([
      'Zahl "4000" steht nicht in den Angaben.'
    ])
    expect(felder['verarbeitung']).toBe('idle')
  })

  it('legt keine leere Warnungsliste ab', () => {
    const fakten = faktenFuer({
      zeile: zeile(),
      gemeinde,
      bestand: [],
      quelle: null
    })

    const felder = meldungsfelder(
      {
        bericht: { titel: 'Titel', lead: 'Lead.', text: 'Text.' },
        warnungen: []
      },
      fakten
    )

    expect(felder['zeit_warnungen']).toBeNull()
  })
})
