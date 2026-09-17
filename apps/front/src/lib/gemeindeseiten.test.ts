import type { GemeindeFelder, GemeindemitteilungFelder } from '@/graphql/redaktion'
import {
  abgelaufen,
  anhangHinweis,
  anzahlOffen,
  bleibtAufDemTisch,
  laufText,
  lesefehler,
  meldungJeMitteilung,
  ohneNewsseite,
  passt,
  seitenLink,
  sortiere,
  tisch
} from './gemeindeseiten'

function eintrag(ueber: Partial<GemeindemitteilungFelder> = {}): GemeindemitteilungFelder {
  return {
    id: 'm',
    url: 'https://www.aesch.bl.ch/_rte/information/1',
    url_kanonisch: 'https://www.aesch.bl.ch/aktuellesinformationen/1',
    quelle_seite: 'https://www.aesch.bl.ch/aktuellesinformationen',
    titel: 'Aus der Gemeinderatssitzung',
    teaser: 'Traktanden beschlossen.',
    publiziert_am: '2026-09-11',
    kategorie: 'politik_info',
    inhalt_typ: 'html',
    text: 'Der Gemeinderat …',
    text_abgeschnitten: false,
    anhaenge: null,
    hinweise: null,
    gelesen_am: '2026-09-11T11:00:00Z',
    vorschlag: null,
    vorschlag_begruendung: null,
    entscheid: 'offen',
    ablehnungsgrund: null,
    date_created: '2026-09-11T11:00:00Z',
    gemeinde: { id: 'g1', name: 'Aesch' },
    ...ueber
  }
}

function gemeinde(ueber: Partial<GemeindeFelder> = {}): GemeindeFelder {
  return {
    id: 'g1',
    name: 'Aesch',
    bezirk: 'Arlesheim',
    bfs_nummer: 2761,
    plz: ['4147'],
    aktiv: true,
    news_url: 'https://www.aesch.bl.ch/aktuellesinformationen',
    news_letzte_pruefung: null,
    news_letzter_fehler: null,
    ...ueber
  }
}

const OHNE_FILTER = { gemeinde: null, suche: '' }

describe('bleibtAufDemTisch', () => {
  it('haelt Offenes und Uebernommenes in Arbeit, laesst Entschiedenes und Fertiges los', () => {
    expect(bleibtAufDemTisch(eintrag())).toBe(true)
    expect(bleibtAufDemTisch(eintrag({ entscheid: 'abgelehnt' }))).toBe(false)
    expect(bleibtAufDemTisch(eintrag({ entscheid: 'weitergereicht' }))).toBe(false)
    expect(bleibtAufDemTisch(eintrag({ entscheid: 'uebernommen' }), 'entwurf')).toBe(true)
    expect(bleibtAufDemTisch(eintrag({ entscheid: 'uebernommen' }), 'publiziert')).toBe(false)
    expect(bleibtAufDemTisch(eintrag({ entscheid: 'uebernommen' }), null)).toBe(false)
  })
})

describe('tisch', () => {
  it('teilt in Vorschlaege und Uebrige, neueste zuerst, und laesst Abgelaufenes weg', () => {
    const { vorschlaege, uebrige } = tisch(
      [
        eintrag({ id: 'alt', publiziert_am: '2026-09-01', vorschlag: null }),
        eintrag({ id: 'v1', publiziert_am: '2026-09-10', vorschlag: true }),
        eintrag({ id: 'v2', publiziert_am: '2026-09-12', vorschlag: true }),
        eintrag({ id: 'u', publiziert_am: '2026-09-12', vorschlag: false }),
        eintrag({ id: 'n', publiziert_am: '2026-09-13', vorschlag: null })
      ],
      OHNE_FILTER,
      new Map(),
      '2026-09-14'
    )
    expect(vorschlaege.map((e) => e.id)).toEqual(['v2', 'v1'])
    expect(uebrige.map((e) => e.id)).toEqual(['n', 'u'])
  })

  it('filtert nach Gemeinde und Suche ueber Titel, Anriss und Kategorie', () => {
    expect(passt(eintrag(), { gemeinde: 'g2', suche: '' })).toBe(false)
    expect(passt(eintrag(), { gemeinde: 'g1', suche: 'traktanden' })).toBe(true)
    expect(passt(eintrag(), { gemeinde: null, suche: 'POLITIK' })).toBe(true)
    expect(passt(eintrag(), { gemeinde: null, suche: 'Fasnacht' })).toBe(false)
  })

  it('sortiert bei gleichem Tag nach dem Lesezeitpunkt', () => {
    const sortiert = sortiere([
      eintrag({ id: 'a', date_created: '2026-09-11T08:00:00Z' }),
      eintrag({ id: 'b', date_created: '2026-09-11T12:00:00Z' })
    ])
    expect(sortiert.map((e) => e.id)).toEqual(['b', 'a'])
  })
})

describe('abgelaufen', () => {
  it('spiegelt die Regel des Laufs: sieben Tage ohne Vorschlag, vierzehn mit', () => {
    expect(abgelaufen(eintrag({ publiziert_am: '2026-09-08' }), '2026-09-14')).toBe(false)
    expect(abgelaufen(eintrag({ publiziert_am: '2026-09-07' }), '2026-09-14')).toBe(true)
    expect(abgelaufen(eintrag({ publiziert_am: '2026-09-01', vorschlag: true }), '2026-09-14')).toBe(false)
    expect(abgelaufen(eintrag({ publiziert_am: '2026-08-31', vorschlag: true }), '2026-09-14')).toBe(true)
    expect(
      abgelaufen(eintrag({ publiziert_am: null, date_created: '2026-09-01T00:00:00Z' }), '2026-09-14')
    ).toBe(true)
    expect(abgelaufen(eintrag({ entscheid: 'abgelehnt', publiziert_am: '2026-01-01' }), '2026-09-14')).toBe(
      false
    )
  })
})

describe('anzahlOffen', () => {
  it('zaehlt Vorschlaege und Uebernommenes in Arbeit — nicht den ganzen Tisch', () => {
    const status = new Map([
      ['u', 'entwurf'],
      ['fertig', 'publiziert']
    ])
    expect(
      anzahlOffen(
        [
          eintrag({ id: 'v', vorschlag: true }),
          eintrag({ id: 'n', vorschlag: null }),
          eintrag({ id: 'u', entscheid: 'uebernommen' }),
          eintrag({ id: 'fertig', entscheid: 'uebernommen' }),
          eintrag({ id: 'weg', entscheid: 'abgelehnt', vorschlag: true })
        ],
        status
      )
    ).toBe(2)
  })
})

describe('Helfer', () => {
  it('ordnet Meldungen ihrer Mitteilung zu und nimmt den kanonischen Link zuerst', () => {
    const karte = meldungJeMitteilung([
      { id: 'm1', gemeindemitteilung: { id: 'a' } },
      { id: 'm2', gemeindemitteilung: null }
    ])
    expect([...karte.keys()]).toEqual(['a'])
    expect(seitenLink(eintrag())).toBe('https://www.aesch.bl.ch/aktuellesinformationen/1')
    expect(seitenLink(eintrag({ url_kanonisch: null }))).toBe('https://www.aesch.bl.ch/_rte/information/1')
  })

  it('nennt aktive Gemeinden ohne Newsseite und solche mit Lesefehler', () => {
    const liste = [
      gemeinde(),
      gemeinde({ id: 'g2', name: 'Dornach', news_url: null }),
      gemeinde({ id: 'g3', name: 'Riehen', news_letzter_fehler: 'Seitenaufbau nicht erkannt' }),
      gemeinde({ id: 'g4', name: 'Inaktiv', aktiv: false, news_url: null, news_letzter_fehler: 'x' })
    ]
    expect(ohneNewsseite(liste).map((g) => g.name)).toEqual(['Dornach'])
    expect(lesefehler(liste).map((g) => g.name)).toEqual(['Riehen'])
  })

  it('uebersetzt den Grund eines ungelesenen Anhangs', () => {
    expect(anhangHinweis('fremde_site')).toBe('nicht gelesen — fremde Website')
    expect(anhangHinweis(null)).toBeNull()
    expect(anhangHinweis('neu')).toBe('neu')
  })
})

describe('laufText', () => {
  it('sagt, dass der Lauf unterwegs ist, und fasst den letzten zusammen', () => {
    const leer = { laeuft: false, gestartet_um: null, beendet_um: null, ergebnis: null, fehler: null }
    expect(laufText(leer)).toBeNull()
    expect(laufText({ ...leer, laeuft: true })).toMatch(/unterwegs/)
    expect(laufText({ ...leer, beendet_um: '2026-09-17T11:02:00Z' })).toBe(
      'Der letzte Lauf hat nichts zurückgemeldet.'
    )
    expect(
      laufText({
        ...leer,
        beendet_um: '2026-09-17T11:02:00Z',
        ergebnis: { gemeinden: 10, neu: 3, vorschlaege: 1, fehler: ['Pratteln: robots.txt nicht erreichbar'] }
      })
    ).toMatch(
      /^Letzter Lauf um \d\d:\d\d Uhr — 10 Gemeinden gelesen, 3 neue Mitteilungen, 1 Vorschläge, 1 Fehler\.$/
    )
  })
})
