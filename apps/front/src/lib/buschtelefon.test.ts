import type { BuschtelefonFundFelder } from '@/graphql/redaktion'
import {
  anzahlOffen,
  bleibtAufDemTisch,
  einrichtungText,
  fundTitel,
  laufText,
  meldungJeFund,
  passt,
  tisch,
  zahlenText
} from './buschtelefon'

function fund(ueber: Partial<BuschtelefonFundFelder> = {}): BuschtelefonFundFelder {
  return {
    id: 'f1',
    kennung: 'fb:1',
    kanal: 'facebook',
    gemeinde_slug: 'aesch',
    kanton: 'BL',
    quelle_name: 'Du bisch vo Aesch',
    quelle_art: 'gruppe',
    link: 'https://example.org/post/1',
    veroeffentlicht_am: '2026-11-09T10:00:00Z',
    datum_genauigkeit: 'exakt',
    erfasst_am: '2026-11-09T12:00:00Z',
    titel: null,
    text: 'Seit heute Morgen ist die Hauptstrasse gesperrt.',
    zusammenfassung: null,
    artikel_text: null,
    kommentare: null,
    n_kommentare: 3,
    n_reaktionen: 12,
    n_geteilt: null,
    doublette_von: null,
    entscheid: 'offen',
    ablehnungsgrund: null,
    gemeinde: { id: 'g1', name: 'Aesch' },
    ...ueber
  }
}

const KEIN_FILTER = { gemeinde: null, kanal: null, suche: '' }

describe('Buschtelefon-Tisch', () => {
  it('offene bleiben, uebernommene nur bis die Meldung fertig ist, abgelehnte nie', () => {
    expect(bleibtAufDemTisch(fund())).toBe(true)
    expect(bleibtAufDemTisch(fund({ entscheid: 'abgelehnt' }))).toBe(false)
    expect(bleibtAufDemTisch(fund({ entscheid: 'uebernommen' }))).toBe(false)
    expect(bleibtAufDemTisch(fund({ entscheid: 'uebernommen' }), 'entwurf')).toBe(true)
    expect(bleibtAufDemTisch(fund({ entscheid: 'uebernommen' }), 'publiziert')).toBe(false)
  })

  it('sortiert neu zuerst und filtert nach Gemeinde, Kanal und Suche', () => {
    const a = fund({ id: 'a', veroeffentlicht_am: '2026-11-01T00:00:00Z' })
    const b = fund({ id: 'b', veroeffentlicht_am: '2026-11-05T00:00:00Z', kanal: 'instagram' })
    expect(tisch([a, b], KEIN_FILTER).map((f) => f.id)).toEqual(['b', 'a'])
    expect(tisch([a, b], { ...KEIN_FILTER, kanal: 'instagram' }).map((f) => f.id)).toEqual(['b'])
    expect(passt(a, { ...KEIN_FILTER, gemeinde: 'andere' })).toBe(false)
    expect(passt(a, { ...KEIN_FILTER, suche: 'HAUPTSTRASSE' })).toBe(true)
  })

  it('zaehlt das Abzeichen aus Offenen und unfertigen Meldungen', () => {
    const funde = [
      fund({ id: 'a' }),
      fund({ id: 'b', entscheid: 'uebernommen' }),
      fund({ id: 'c', entscheid: 'abgelehnt' })
    ]
    expect(anzahlOffen(funde, new Map([['b', 'entwurf']]))).toBe(2)
  })

  it('ordnet Meldungen dem Fund zu', () => {
    const m = { buschtelefon_fund: { id: 'f1' } }
    expect(meldungJeFund([m, {}]).get('f1')).toBe(m)
  })
})

describe('Texte', () => {
  it('Zahlen nennen nur, was der Abnehmer kennt', () => {
    expect(zahlenText(fund())).toBe('3 Kommentare · 12 Reaktionen')
    expect(zahlenText(fund({ n_kommentare: 1, n_reaktionen: null, n_geteilt: 4 }))).toBe(
      '1 Kommentar · 4 geteilt'
    )
  })

  it('Titel faellt auf den Anfang des Textes zurueck', () => {
    expect(fundTitel(fund({ titel: 'Sperrung' }))).toBe('Sperrung')
    expect(fundTitel(fund())).toMatch(/^Seit heute Morgen/)
    expect(fundTitel(fund({ text: 'x'.repeat(200) })).length).toBe(88)
    expect(fundTitel(fund({ text: null }))).toBe('(ohne Text)')
  })

  it('nennt fehlende Einrichtung beim Namen', () => {
    expect(einrichtungText(null)).toBeNull()
    expect(
      einrichtungText({
        laeuft: false,
        gestartet_um: null,
        beendet_um: null,
        ergebnis: null,
        fehler: null,
        eingerichtet: false,
        fehlend: ['BUSCHTELEFON_SCHLUESSEL']
      })
    ).toBe('Der Abnehmer ist nicht eingerichtet, es fehlt: BUSCHTELEFON_SCHLUESSEL.')
  })

  it('Lauftext: unterwegs, Ergebnis, nichts', () => {
    const basis = { laeuft: false, gestartet_um: null, beendet_um: null, ergebnis: null, fehler: null }
    expect(laufText({ ...basis, laeuft: true })).toMatch(/unterwegs/)
    expect(laufText(basis)).toBeNull()
    expect(
      laufText({
        ...basis,
        beendet_um: '2026-11-10T10:20:00Z',
        ergebnis: { gelesen: 5, neu: 2, aktualisiert: 1, ohneGemeinde: 1, fehler: [] }
      })
    ).toMatch(/5 gelesen, 2 neu, 1 aktualisiert, 1 ohne Gemeinde/)
  })
})
