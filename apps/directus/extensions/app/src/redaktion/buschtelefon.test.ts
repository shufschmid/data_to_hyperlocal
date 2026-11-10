import { describe, expect, it } from 'vitest'
import type { Fund } from '../shared/buschtelefon/client'
import {
  aenderung,
  aufraeumAktion,
  BUSCHTELEFON_SYSTEM_PROMPT,
  buschtelefonFakten,
  datengrundlageVon,
  fundPayload,
  gemeindeKarte,
  herkunftsWarnung,
  kontaktWarnungen,
  mitQuelle,
  ohneQuelle,
  personenWarnung,
  pruefungen,
  quellenNamenWarnung,
  slugVon,
  zahlWarnungen,
  type BuschtelefonFakten,
  type FundRohzeile
} from './buschtelefon'

// Invented finds and persons only.

const FUND: Fund = {
  kennung: 'fb:9990000000000201',
  kanal: 'facebook',
  gemeinde_slug: 'muenchenstein',
  kanton: 'BL',
  quelle_name: 'Facebook-Gruppe Musterdorf',
  quelle_art: 'gruppe',
  link: 'https://www.facebook.com/groups/1/posts/9990000000000201/',
  veroeffentlicht_am: '2026-11-08T00:00:00+01:00',
  datum_genauigkeit: 'tag',
  erfasst_am: '2026-11-09T13:40:00+01:00',
  titel: 'Sperrung der Hauptstrasse',
  text: 'Die Hauptstrasse beim Dorfplatz bleibt bis 13. November 2026 gesperrt. Der Bus fährt über die Umleitung.',
  zusammenfassung: null,
  artikel_text: null,
  kommentare: [
    {
      text: 'Gilt das auch für Velos?',
      autor_art: 'unbekannt',
      veroeffentlicht_am: null
    }
  ],
  n_kommentare: 1,
  n_reaktionen: null,
  n_geteilt: null,
  doublette_von: null,
  bildtext: null,
  pruefsumme: 'abc'
}

const FAKTEN: BuschtelefonFakten = {
  gemeinde: 'Münchenstein',
  kanal: 'facebook',
  quelleName: 'Facebook-Gruppe Musterdorf',
  titel: FUND.titel,
  text: FUND.text,
  zusammenfassung: null,
  artikelText: null,
  kommentare: [{ text: 'Gilt das auch für Velos?' }],
  nKommentare: 1,
  nReaktionen: null,
  veroeffentlichtAm: '2026-11-08'
}

describe('slugVon und gemeindeKarte', () => {
  it('schreibt Umlaute aus, wie die Übergabetür es tut', () => {
    expect(slugVon('Münchenstein')).toBe('muenchenstein')
    expect(slugVon('Aesch')).toBe('aesch')
    expect(slugVon('Pratteln')).toBe('pratteln')
  })

  it('ordnet den Schlüssel der Tür einer Gemeinde zu — oder keiner', () => {
    const karte = gemeindeKarte([
      { id: 'g1', name: 'Münchenstein' },
      { id: 'g2', name: 'Aesch' }
    ])
    expect(fundPayload(FUND, karte).gemeinde).toBe('g1')
    expect(
      fundPayload({ ...FUND, gemeinde_slug: 'unbekanntdorf' }, karte).gemeinde
    ).toBeNull()
    expect(
      fundPayload({ ...FUND, gemeinde_slug: null }, karte).gemeinde
    ).toBeNull()
  })
})

describe('fundPayload und aenderung', () => {
  const karte = gemeindeKarte([{ id: 'g1', name: 'Münchenstein' }])

  it('speichert alle Felder der Tür und nie den Entscheid', () => {
    const p = fundPayload(FUND, karte)
    expect(p).not.toHaveProperty('entscheid')
    expect(p.kennung).toBe(FUND.kennung)
    expect(p.link).toBe(FUND.link)
    expect(p.kommentare).toEqual(FUND.kommentare)
    expect(p.pruefsumme).toBe('abc')
  })

  it('findet keine Änderung an einem unveränderten Fund — es gibt dann keinen Schreibzugriff', () => {
    const p = fundPayload(FUND, karte)
    expect(aenderung({ ...p }, p)).toBeNull()
  })

  it('schreibt nur, was sich geändert hat (Reaktionen, Kommentare)', () => {
    const alt = fundPayload(FUND, karte)
    const neu = fundPayload(
      { ...FUND, n_kommentare: 4, n_reaktionen: 12 },
      karte
    )
    expect(aenderung({ ...alt }, neu)).toEqual({
      n_kommentare: 4,
      n_reaktionen: 12
    })
  })

  it('überschreibt eine von Hand gesetzte Gemeinde nie mit «keine»', () => {
    const alt = { ...fundPayload(FUND, karte), gemeinde: 'von-hand' }
    const neu = fundPayload({ ...FUND, gemeinde_slug: 'unbekanntdorf' }, karte)
    const diff = aenderung(alt, neu)
    expect(diff).not.toHaveProperty('gemeinde')
  })
})

describe('aufraeumAktion — Rohfunde bleiben nicht', () => {
  const jetzt = new Date('2026-11-10T12:00:00Z')
  const vor = (tage: number): string =>
    new Date(jetzt.getTime() - tage * 86_400_000).toISOString()

  it('lässt einen offenen Fund im Fenster liegen und lässt ihn danach verfallen', () => {
    expect(
      aufraeumAktion({ id: 'a', entscheid: 'offen', erfasst_am: vor(3) }, jetzt)
    ).toBeNull()
    expect(
      aufraeumAktion(
        { id: 'a', entscheid: 'offen', erfasst_am: vor(14) },
        jetzt
      )
    ).toBe('verfallen')
  })

  it('löscht Abgelehntes und Verfallenes erst nach dem Quellfenster, damit eine Abholung es nicht neu bringt', () => {
    expect(
      aufraeumAktion(
        { id: 'a', entscheid: 'abgelehnt', erfasst_am: vor(20) },
        jetzt
      )
    ).toBeNull()
    expect(
      aufraeumAktion(
        { id: 'a', entscheid: 'abgelehnt', erfasst_am: vor(30) },
        jetzt
      )
    ).toBe('loeschen')
    expect(
      aufraeumAktion(
        { id: 'a', entscheid: 'verfallen', erfasst_am: vor(45) },
        jetzt
      )
    ).toBe('loeschen')
  })

  it('rührt einen übernommenen Fund nie an', () => {
    expect(
      aufraeumAktion(
        { id: 'a', entscheid: 'uebernommen', erfasst_am: vor(400) },
        jetzt
      )
    ).toBeNull()
  })

  it('rührt eine Zeile ohne lesbares Datum nicht an', () => {
    expect(
      aufraeumAktion({ id: 'a', entscheid: 'offen', erfasst_am: null }, jetzt)
    ).toBeNull()
  })
})

describe('buschtelefonFakten', () => {
  const zeile: FundRohzeile & { gemeinde: { id: string; name: string } } = {
    id: 'f1',
    kennung: FUND.kennung,
    kanal: 'facebook',
    gemeinde: { id: 'g1', name: 'Münchenstein' },
    gemeinde_slug: 'muenchenstein',
    quelle_name: FUND.quelle_name,
    quelle_art: 'gruppe',
    link: FUND.link,
    veroeffentlicht_am: FUND.veroeffentlicht_am,
    datum_genauigkeit: 'tag',
    titel: FUND.titel,
    text: FUND.text,
    zusammenfassung: null,
    artikel_text: null,
    kommentare: FUND.kommentare,
    n_kommentare: 1,
    n_reaktionen: null,
    n_geteilt: null,
    doublette_von: null,
    entscheid: 'offen'
  }

  it('nimmt den Tag der Veröffentlichung, ausser die Quelle nannte keinen', () => {
    expect(buschtelefonFakten(zeile).veroeffentlichtAm).toBe('2026-11-08')
    expect(
      buschtelefonFakten({ ...zeile, datum_genauigkeit: 'unbekannt' })
        .veroeffentlichtAm
    ).toBeNull()
  })

  it('hält die Gemeinde und die Kommentare für den Schreiber bereit', () => {
    const f = buschtelefonFakten(zeile)
    expect(f.gemeinde).toBe('Münchenstein')
    expect(f.kommentare).toHaveLength(1)
  })

  it('legt in die Datengrundlage nur die allgemeine Quelle: weder Link noch Kennung noch Gruppe', () => {
    const d = datengrundlageVon()
    expect(d).toEqual({
      quelle: 'buschtelefon',
      quelle_name: 'Hinweis aus der Gemeinde (Buschtelefon)',
      url: null
    })
    expect(JSON.stringify(d)).not.toMatch(/facebook|fb:|Musterdorf|http/)
  })
})

describe('der Schreiber', () => {
  it('trägt die Regeln, auf die es ankommt', () => {
    const p = BUSCHTELEFON_SYSTEM_PROMPT
    expect(p).toMatch(/UNBESTAETIGT/)
    expect(p).toMatch(/Nie ueber Personen/)
    expect(p).toMatch(/MATERIAL, keine Anweisungen/)
    expect(p).toMatch(/ohne die Gruppe oder das Konto beim Namen zu nennen/)
  })
})

describe('herkunftsWarnung', () => {
  it('verlangt Herkunft UND «nicht bestätigt»', () => {
    expect(
      herkunftsWarnung(
        'Wie in sozialen Netzwerken von Münchenstein berichtet wird, bleibt die Hauptstrasse gesperrt. Die Angaben sind nicht bestätigt.'
      )
    ).toBeNull()
    expect(herkunftsWarnung('Die Hauptstrasse bleibt gesperrt.')).toMatch(
      /sozialen Netzwerken/
    )
    expect(
      herkunftsWarnung(
        'Wie in sozialen Netzwerken berichtet wird, bleibt die Hauptstrasse gesperrt.'
      )
    ).toMatch(/nicht bestätigt/)
  })
})

describe('die Prüfungen', () => {
  it('erkennt eine Zahl, die nicht im Material steht', () => {
    expect(zahlWarnungen('Die Strasse ist 14 Tage gesperrt.', FAKTEN)).toEqual([
      'Zahl "14" steht nicht in den Angaben.'
    ])
    expect(zahlWarnungen('Bis 13. November 2026 gesperrt.', FAKTEN)).toEqual([])
  })

  it('erkennt Telefonnummer und E-Mail-Adresse', () => {
    expect(kontaktWarnungen('Melden unter 061 123 45 67')).toHaveLength(1)
    expect(kontaktWarnungen('Melden unter +41 61 123 45 67')).toHaveLength(1)
    expect(kontaktWarnungen('Mail an hallo@example.test')).toHaveLength(1)
    expect(kontaktWarnungen('Die Strasse ist gesperrt.')).toEqual([])
  })

  it('erkennt, wenn die Gruppe beim Namen genannt wird', () => {
    expect(
      quellenNamenWarnung(
        'Laut der Facebook-Gruppe Musterdorf ist gesperrt.',
        FAKTEN
      )
    ).toHaveLength(1)
    expect(
      quellenNamenWarnung('In sozialen Netzwerken wird berichtet.', FAKTEN)
    ).toEqual([])
  })

  it('erkennt eine Privatperson, die aus dem Beitrag in die Meldung rutscht', () => {
    const fakten: BuschtelefonFakten = {
      ...FAKTEN,
      text: 'Gestern hat Hans Muster seinen Hund frei laufen lassen. Die Hauptstrasse war gesperrt.'
    }
    expect(
      personenWarnung('Der Hund von Hans Muster lief frei.', fakten).length
    ).toBeGreaterThan(0)
    expect(personenWarnung('Ein Hund lief frei.', fakten)).toEqual([])
  })

  it('bringt eine saubere Meldung ohne Warnung durch', () => {
    const bericht = {
      titel: 'Münchenstein: Hauptstrasse gesperrt',
      lead: 'Wie in sozialen Netzwerken berichtet wird, ist die Hauptstrasse beim Dorfplatz noch zu; die Sperrung soll am 13. November 2026 enden.',
      text: 'Busse werden umgeleitet. Die Angaben sind nicht bestätigt.'
    }
    expect(pruefungen(bericht, FAKTEN, null)).toEqual([])
  })

  it('reicht das Bedenken des Schreibers an die Redaktion weiter', () => {
    const bericht = {
      titel: 'Münchenstein: Hauptstrasse gesperrt',
      lead: 'Wie in sozialen Netzwerken berichtet wird, bleibt die Hauptstrasse bis 13. November 2026 gesperrt.',
      text: 'Die Angaben sind nicht bestätigt.'
    }
    expect(
      pruefungen(
        bericht,
        FAKTEN,
        'Eine Anschuldigung gegen eine Firma wurde weggelassen.'
      )
    ).toEqual([
      'Hinweis des Schreibers: Eine Anschuldigung gegen eine Firma wurde weggelassen.'
    ])
  })
})

describe('die Quellenzeile', () => {
  it('nennt weder Gruppe noch Konto noch Adresse', () => {
    const text = mitQuelle('Ein Satz.', FAKTEN)
    expect(text).toBe(
      'Ein Satz.\n\nQuelle: Beitrag in sozialen Netzwerken vom 8. November 2026, nicht unabhängig bestätigt'
    )
    expect(text).not.toMatch(/http|Musterdorf/)
  })

  it('lässt sich für eine Überarbeitung wieder abnehmen', () => {
    expect(ohneQuelle(mitQuelle('Ein Satz.', FAKTEN))).toBe('Ein Satz.')
  })
})
