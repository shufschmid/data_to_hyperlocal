import type { KantonsmitteilungFelder } from '@/graphql/redaktion'
import {
  abgelaufen,
  anzahlOffen,
  bleibtAufDemTisch,
  laufText,
  meldungJeMitteilung,
  passt,
  publizierbare,
  quelleText,
  sortiere,
  tisch,
  weitereGemeinden
} from './kanton'

function eintrag(ueber: Partial<KantonsmitteilungFelder> = {}): KantonsmitteilungFelder {
  return {
    id: 'k',
    url: 'https://www.baselland.ch/politik-und-behorden/direktionen/sicherheitsdirektion/medienmitteilungen/tempo-30',
    quelle: 'medienmitteilung',
    behoerde: 'Sicherheitsdirektion',
    titel: 'Tempo-30-Anträgen in Münchenstein und Birsfelden wird teilweise zugestimmt',
    teaser: null,
    text: 'Die Sicherheitsdirektion hat die Anträge geprüft.',
    text_abgeschnitten: false,
    publiziert_am: '2026-09-02',
    gelesen_am: '2026-09-02T12:00:00Z',
    hinweise: null,
    gemeinden_genannt: ['Münchenstein', 'Bottmingen'],
    vorschlag: null,
    vorschlag_begruendung: null,
    entscheid: 'offen',
    ablehnungsgrund: null,
    date_created: '2026-09-02T12:00:00Z',
    gemeinde: { id: 'g1', name: 'Münchenstein' },
    ...ueber
  }
}

describe('bleibtAufDemTisch', () => {
  it('haelt Offenes und Uebernommenes in Arbeit, laesst Entschiedenes und Publiziertes los', () => {
    expect(bleibtAufDemTisch(eintrag())).toBe(true)
    expect(bleibtAufDemTisch(eintrag({ entscheid: 'uebernommen' }), 'entwurf')).toBe(true)
    expect(bleibtAufDemTisch(eintrag({ entscheid: 'uebernommen' }), 'publiziert')).toBe(false)
    expect(bleibtAufDemTisch(eintrag({ entscheid: 'uebernommen' }), null)).toBe(false)
    expect(bleibtAufDemTisch(eintrag({ entscheid: 'abgelehnt' }))).toBe(false)
    expect(bleibtAufDemTisch(eintrag({ entscheid: 'weitergereicht' }))).toBe(false)
  })
})

describe('weitereGemeinden und quelleText', () => {
  it('nennt die anderen Gemeinden der Mitteilung, nie die eigene', () => {
    expect(weitereGemeinden(eintrag())).toEqual(['Bottmingen'])
    expect(weitereGemeinden(eintrag({ gemeinden_genannt: null }))).toEqual([])
  })
  it('sagt, ob Medienmitteilung oder Polizeimeldung', () => {
    expect(quelleText('polizeimeldung')).toBe('Polizeimeldung')
    expect(quelleText('medienmitteilung')).toBe('Medienmitteilung')
  })
})

describe('sortiere und passt', () => {
  it('stellt die neueste Mitteilung zuoberst', () => {
    const s = sortiere([
      eintrag({ id: 'a', publiziert_am: '2026-09-01' }),
      eintrag({ id: 'b', publiziert_am: '2026-09-22' })
    ])
    expect(s.map((e) => e.id)).toEqual(['b', 'a'])
  })
  it('filtert nach Gemeinde und sucht in Titel, Anriss und Behoerde', () => {
    expect(passt(eintrag(), { gemeinde: 'g1', suche: '' })).toBe(true)
    expect(passt(eintrag(), { gemeinde: 'g2', suche: '' })).toBe(false)
    expect(passt(eintrag(), { gemeinde: null, suche: 'sicherheits' })).toBe(true)
    expect(passt(eintrag(), { gemeinde: null, suche: 'Polizei' })).toBe(false)
  })
})

describe('abgelaufen und tisch', () => {
  it('spiegelt den Lauf: Unvorgeschlagenes nach sieben Tagen, Vorschlaege nach vierzehn', () => {
    expect(abgelaufen(eintrag({ publiziert_am: '2026-09-10' }), '2026-09-16')).toBe(false)
    expect(abgelaufen(eintrag({ publiziert_am: '2026-09-10' }), '2026-09-17')).toBe(true)
    expect(abgelaufen(eintrag({ vorschlag: true, publiziert_am: '2026-09-10' }), '2026-09-17')).toBe(false)
    expect(abgelaufen(eintrag({ vorschlag: true, publiziert_am: '2026-09-10' }), '2026-09-24')).toBe(true)
    expect(abgelaufen(eintrag({ entscheid: 'uebernommen', publiziert_am: '2026-01-01' }), '2026-09-24')).toBe(
      false
    )
  })
  it('legt die Vorschlaege oben hin und faltet die Uebrigen', () => {
    const t = tisch(
      [
        eintrag({ id: 'a', vorschlag: true }),
        eintrag({ id: 'b', vorschlag: false }),
        eintrag({ id: 'c', entscheid: 'abgelehnt' })
      ],
      { gemeinde: null, suche: '' },
      new Map(),
      '2026-09-03'
    )
    expect(t.vorschlaege.map((e) => e.id)).toEqual(['a'])
    expect(t.uebrige.map((e) => e.id)).toEqual(['b'])
  })
})

describe('Meldungen des Tischs', () => {
  const m = (ueber: { id: string; status: string; kantonsmitteilung?: { id: string } | null }) => ueber
  it('zaehlt Vorschlaege und Uebernommenes in Arbeit', () => {
    expect(
      anzahlOffen(
        [
          eintrag({ id: 'a', vorschlag: true }),
          eintrag({ id: 'b' }),
          eintrag({ id: 'c', entscheid: 'uebernommen' })
        ],
        new Map([['c', 'entwurf']])
      )
    ).toBe(2)
  })
  it('publiziert nur Entwuerfe und Freigegebenes dieses Tischs', () => {
    expect(
      publizierbare([
        m({ id: '1', status: 'entwurf', kantonsmitteilung: { id: 'a' } }),
        m({ id: '2', status: 'freigegeben', kantonsmitteilung: { id: 'b' } }),
        m({ id: '3', status: 'in_pruefung', kantonsmitteilung: { id: 'c' } }),
        m({ id: '4', status: 'entwurf', kantonsmitteilung: null }),
        m({ id: '5', status: 'entwurf' })
      ]).map((x) => x.id)
    ).toEqual(['1', '2'])
  })
  it('ordnet die Meldung ihrer Zeile zu, auch wenn das Feld fehlt', () => {
    const karte = meldungJeMitteilung([
      m({ id: '1', status: 'entwurf', kantonsmitteilung: { id: 'a' } }),
      m({ id: '2', status: 'entwurf' })
    ])
    expect([...karte.keys()]).toEqual(['a'])
  })
})

describe('laufText', () => {
  const leer = { laeuft: false, gestartet_um: null, beendet_um: null, ergebnis: null, fehler: null }
  it('sagt, was der letzte Lauf brachte', () => {
    expect(
      laufText({
        ...leer,
        beendet_um: '2026-09-29T12:02:00Z',
        ergebnis: { geoeffnet: 4, neu: 2, vorschlaege: 1, meldungenGeschrieben: 1, fehler: ['x'] }
      })
    ).toMatch(
      /Letzter Lauf um .* — 4 Einträge geöffnet, 2 mit Gemeindebezug, 1 Vorschläge, 1 Meldungen geschrieben, 1 Fehler\./
    )
    expect(laufText({ ...leer, laeuft: true })).toMatch(/unterwegs/)
    expect(laufText(leer)).toBeNull()
  })
})
