import { describe, expect, it } from 'vitest'
import {
  ausschlussKalender,
  baueAntwort,
  eckdatenText,
  fuehreZusammen,
  parseAbfrage,
  plusTage,
  pruefeZugang,
  statusVon,
  vorschauLink,
  type GemeindeZeile,
  type KalenderQuelle,
  type KalenderZeile,
  type VorschauZeile
} from './tuer'

// 17 November 2026, 15:00 in Zurich.
const JETZT = new Date('2026-11-17T14:00:00Z')
const HEUTE = '2026-11-17'
const BIS = plusTage(HEUTE, 60)

const REINACH: GemeindeZeile = {
  id: 'g-reinach',
  name: 'Reinach',
  bfs_nummer: 2773
}
const MUENCHENSTEIN: GemeindeZeile = {
  id: 'g-mst',
  name: 'Münchenstein',
  bfs_nummer: 2769
}

const KALENDER: KalenderQuelle = {
  id: 'q-reinach',
  name: 'Veranstaltungskalender Reinach',
  art: 'gemeinde',
  aktiv: true,
  letzte_pruefung: '2026-11-17T12:03:00Z',
  letzter_fehler: null,
  letzter_hinweis: null
}

function anlass(ueber: Partial<KalenderZeile> = {}): KalenderZeile {
  return {
    id: 'a1',
    gemeinde: REINACH.id,
    quelle: KALENDER,
    titel: 'Adventskonzert Musikverein',
    termine: ['2026-11-29'],
    von: '2026-11-29',
    bis: null,
    zeit: '17:00',
    lokalitaet: 'Gemeindesaal',
    adresse: null,
    ort: 'Reinach',
    ort_ausserhalb: false,
    veranstalter: 'Musikverein Reinach',
    rhythmus: 'einmalig',
    anker: 'einmalig',
    anker_am: '2026-11-29',
    anker_grund: null,
    entscheid: 'offen',
    ablehnungsgrund: null,
    url: 'https://www.reinach-bl.ch/anlass/1',
    zuletzt_gesehen_am: HEUTE,
    ...ueber
  }
}

function vorschau(ueber: Partial<VorschauZeile> = {}): VorschauZeile {
  return {
    id: 'k1',
    titel: 'Der Musikverein lädt zum Advent',
    seite: 5,
    zusammenfassung:
      'Der Musikverein Reinach gibt am 29. November ein Adventskonzert im Gemeindesaal.',
    zeitbezug: 'vorschau',
    typ: 'veranstaltung',
    anlass_am: '2026-11-29',
    entscheid: 'offen',
    ablehnungsgrund: null,
    gemeinde: null,
    ausgabe: {
      nummer: '47',
      pdf_url: 'https://blatt.example/kw47.pdf',
      seite_url: null,
      wochenblatt: { name: 'Wochenblatt für das Birseck', gemeinde: REINACH.id }
    },
    ...ueber
  }
}

function antwort(
  kalender: KalenderZeile[],
  vorschauen: VorschauZeile[] = [],
  gemeinde: string | null = null
) {
  return baueAntwort({
    jetzt: JETZT,
    gemeinden: [REINACH, MUENCHENSTEIN],
    kalender,
    vorschauen,
    gemeinde
  })
}

describe('Schlüssel', () => {
  it('kennt die drei Zustände', () => {
    expect(pruefeZugang('x', '')).toBe('nicht_konfiguriert')
    expect(pruefeZugang(undefined, 'geheim')).toBe('verweigert')
    expect(pruefeZugang('falsch', 'geheim')).toBe('verweigert')
    expect(pruefeZugang('geheim', 'geheim')).toBe('ok')
  })
})

describe('Kalender-Anlässe', () => {
  it('liefert einen kommenden Anlass mit Eckdaten-Text und Quelle', () => {
    const a = antwort([anlass()])
    expect(a.anzahl).toBe(1)
    const e = a.anlaesse[0]!
    expect(e.kennung).toBe('kalender:a1')
    expect(e.gemeinde).toEqual({ name: 'Reinach', slug: 'reinach', bfs: 2773 })
    expect(e.text).toBe(
      'Sonntag, 29. November 2026, 17:00, Gemeindesaal, Reinach.'
    )
    expect(e.quelle).toEqual({
      art: 'gemeinde',
      name: 'Veranstaltungskalender Reinach',
      url: 'https://www.reinach-bl.ch/anlass/1'
    })
    expect(a.fenster).toEqual({ von: HEUTE, bis: '2027-01-16' })
  })

  it('schneidet vergangene Termine ab und lässt Anlässe ganz ausserhalb des Fensters weg', () => {
    const serie = anlass({
      termine: ['2026-11-10', '2026-11-24', '2026-12-01'],
      von: '2026-11-10'
    })
    expect(antwort([serie]).anlaesse[0]!.termine).toEqual([
      '2026-11-24',
      '2026-12-01'
    ])
    expect(
      ausschlussKalender(
        anlass({ termine: ['2026-11-10'], von: '2026-11-10' }),
        HEUTE,
        BIS
      )
    ).toBe('ausserhalb')
    expect(
      ausschlussKalender(
        anlass({ termine: ['2027-03-01'], von: '2027-03-01' }),
        HEUTE,
        BIS
      )
    ).toBe('ausserhalb')
  })

  it('behält eine laufende Ausstellung und nennt ihren letzten Tag', () => {
    const z = anlass({
      termine: null,
      von: '2026-10-01',
      bis: '2026-12-20',
      rhythmus: 'laufend',
      zeit: null
    })
    const e = antwort([z]).anlaesse[0]!
    expect(e.termine).toEqual([])
    expect(e.text).toBe(
      'Bis Sonntag, 20. Dezember 2026, Gemeindesaal, Reinach.'
    )
  })

  it('liest eine Serie, von der nur Anfang und Ende bekannt sind, nicht als Spanne', () => {
    // Münchenstein's „Suppentopf" as stored on 17.11.2026.
    const z = anlass({
      titel: 'Suppentopf',
      termine: ['2026-11-03', '2027-04-06'],
      von: '2026-11-03',
      bis: '2027-04-06',
      rhythmus: 'monatlich',
      zeit: '11:50–13:00',
      lokalitaet: 'Ref. Kirchgemeindehaus',
      ort: 'Münchenstein'
    })
    expect(antwort([z]).anlaesse[0]!.text).toBe(
      'Monatlich bis Dienstag, 6. April 2027, 11:50–13:00, Ref. Kirchgemeindehaus, Münchenstein.'
    )
  })

  it('hält einen Anlass, dessen Tag der Kalender nicht lesen liess, und sagt es', () => {
    // Riehen, 17.11.2026: one day of the day-by-day read answered 500.
    const teilweise = {
      ...KALENDER,
      letzter_hinweis: '2026-12-12: Seite antwortete mit 500.'
    }
    const amTag = anlass({
      quelle: teilweise,
      termine: ['2026-12-12'],
      von: '2026-12-12',
      zuletzt_gesehen_am: '2026-10-31'
    })
    const andererTag = anlass({
      id: 'a2',
      quelle: teilweise,
      zuletzt_gesehen_am: '2026-10-31'
    })
    const a = antwort([amTag, andererTag])
    expect(a.anlaesse.map((e) => e.kennung)).toEqual(['kalender:a1'])
    expect(a.hinweise).toContain(
      'Kalender «Veranstaltungskalender Reinach» nur teilweise gelesen: 2026-12-12: Seite antwortete mit 500. Anlässe dieser Tage bleiben im zuletzt gelesenen Stand.'
    )
  })

  it('zählt einen vergangenen Anlass nicht als «verschwunden»', () => {
    const vorbei = anlass({
      termine: ['2026-11-15'],
      von: '2026-11-15',
      zuletzt_gesehen_am: '2026-11-15'
    })
    expect(ausschlussKalender(vorbei, HEUTE, BIS)).toBe('ausserhalb')
    expect(antwort([vorbei]).hinweise).toEqual([])
  })

  it('lässt Platzhalter und als falsch abgelehnte Zeilen weg, nicht aber «nicht relevant»', () => {
    expect(
      ausschlussKalender(anlass({ anker: 'platzhalter' }), HEUTE, BIS)
    ).toBe('platzhalter')
    expect(
      ausschlussKalender(
        anlass({ entscheid: 'abgelehnt', ablehnungsgrund: 'doublette' }),
        HEUTE,
        BIS
      )
    ).toBe('abgelehnt')
    expect(
      ausschlussKalender(
        anlass({ entscheid: 'abgelehnt', ablehnungsgrund: 'nicht_relevant' }),
        HEUTE,
        BIS
      )
    ).toBeNull()
  })

  it('liefert nicht, was nach einer erfolgreichen Lesung nicht mehr im Kalender steht, und sagt es', () => {
    const weg = anlass({ id: 'weg', zuletzt_gesehen_am: '2026-11-15' })
    const a = antwort([anlass(), weg])
    expect(a.anlaesse.map((e) => e.kennung)).toEqual(['kalender:a1'])
    expect(a.hinweise).toContain(
      '1 Anlässe stehen nicht mehr in ihrem Kalender und sind nicht geliefert.'
    )
  })

  it('behält bei einem unlesbaren Kalender den letzten Stand und deklariert es', () => {
    const kaputt = { ...KALENDER, letzter_fehler: 'Zeitüberschreitung' }
    const a = antwort([
      anlass({ quelle: kaputt, zuletzt_gesehen_am: '2026-11-15' })
    ])
    expect(a.anzahl).toBe(1)
    expect(a.hinweise[0]).toContain(
      'zuletzt nicht lesbar (Versuch vom 17. November 2026)'
    )
  })

  it('nennt einen abgeschalteten Kalender statt still zu schweigen', () => {
    const a = antwort([anlass({ quelle: { ...KALENDER, aktiv: false } })])
    expect(a.anzahl).toBe(0)
    expect(a.hinweise).toContain(
      'Kalender «Veranstaltungskalender Reinach» ist abgeschaltet — 1 Anlässe daraus nicht geliefert.'
    )
  })

  it('nennt weitere Termine einer Serie im Text, höchstens drei', () => {
    const tage = [
      '2026-11-20',
      '2026-11-27',
      '2026-12-04',
      '2026-12-11',
      '2026-12-18'
    ]
    expect(
      eckdatenText(
        anlass({ zeit: null, lokalitaet: null, ort: null }),
        tage,
        HEUTE
      )
    ).toBe(
      'Freitag, 20. November 2026. Weitere Termine: 27. November 2026, 4. Dezember 2026, 11. Dezember 2026 und 1 weitere.'
    )
  })
})

describe('Status', () => {
  it('meldet eine Absage, wenn der Kalender sie sagt', () => {
    expect(
      statusVon({
        anker: 'ausfall',
        anker_am: '2026-11-29',
        anker_grund: 'abgesagt',
        termine: ['2026-11-29'],
        von: '2026-11-29'
      }).status
    ).toBe('abgesagt')
  })

  it('macht aus einem fehlenden Serientermin keine Absage der ganzen Serie', () => {
    const s = statusVon({
      anker: 'ausfall',
      anker_am: '2026-11-24',
      anker_grund:
        'Wöchentlich, der erwartete 24. November 2026 fehlt im Kalender.',
      termine: ['2026-11-17', '2026-12-01'],
      von: '2026-11-17'
    })
    expect(s).toEqual({
      status: 'findet_statt',
      status_hinweis:
        'Wöchentlich, der erwartete 24. November 2026 fehlt im Kalender.'
    })
  })

  it('meldet eine Verschiebung', () => {
    expect(
      statusVon({
        anker: 'verschoben',
        anker_am: null,
        anker_grund: 'verschoben',
        termine: null,
        von: HEUTE
      }).status
    ).toBe('verschoben')
  })
})

describe('Wochenblatt-Vorschauen', () => {
  it('liefert eine Vorschau ohne Kalendereintrag mit Seitenlink und Zusammenfassung', () => {
    const a = antwort(
      [],
      [
        vorschau({
          titel: 'Lichterfest im Dorfkern',
          zusammenfassung: 'Lichterfest.'
        })
      ]
    )
    const e = a.anlaesse[0]!
    expect(e.kennung).toBe('wochenblatt:k1')
    expect(e.herkunft).toBe('wochenblatt')
    expect(e.zeit).toBeNull()
    expect(e.text_herkunft).toBe('zusammenfassung_ki')
    expect(e.quelle).toEqual({
      art: 'wochenblatt',
      name: 'Wochenblatt für das Birseck Nr. 47',
      url: 'https://blatt.example/kw47.pdf#page=5'
    })
  })

  it('nimmt die Gemeinde des Beitrags vor der des Blatts', () => {
    const a = antwort([], [vorschau({ gemeinde: MUENCHENSTEIN.id })])
    expect(a.anlaesse[0]!.gemeinde.slug).toBe('muenchenstein')
  })

  it('lässt Rückschauen und vergangene Vorschauen weg', () => {
    expect(antwort([], [vorschau({ zeitbezug: 'rueckschau' })]).anzahl).toBe(0)
    expect(antwort([], [vorschau({ anlass_am: '2026-11-10' })]).anzahl).toBe(0)
  })

  it('nimmt nur Stücke, deren Vorschau ein Anlass ist — kein Interview über eine Abstimmung', () => {
    expect(
      antwort(
        [],
        [
          vorschau({
            typ: 'hintergrund',
            titel: 'Abstimmungskampf nimmt Fahrt auf'
          })
        ]
      ).anzahl
    ).toBe(0)
    expect(antwort([], [vorschau({ typ: 'service' })]).anzahl).toBe(1)
    expect(antwort([], [vorschau({ typ: 'vereinsleben' })]).anzahl).toBe(1)
  })

  it('verlinkt ohne Seite die Ausgabe, auf issuu die Seite als Pfad', () => {
    const ausgabe = {
      nummer: '1',
      pdf_url: 'https://issuu.com/x/docs/kw47',
      seite_url: null,
      wochenblatt: null
    }
    expect(vorschauLink(ausgabe, 3)).toBe('https://issuu.com/x/docs/kw47/3')
    expect(vorschauLink(ausgabe, null)).toBe('https://issuu.com/x/docs/kw47')
    expect(vorschauLink({ ...ausgabe, pdf_url: null }, 3)).toBeNull()
  })
})

describe('Doubletten', () => {
  it('führt Kalender und Wochenblatt zu einem Eintrag zusammen, der Kalender bleibt', () => {
    const a = antwort([anlass()], [vorschau()])
    expect(a.anzahl).toBe(1)
    expect(a.zusammengefuehrt).toBe(1)
    const e = a.anlaesse[0]!
    expect(e.kennung).toBe('kalender:a1')
    expect(e.weitere_quellen).toEqual([
      {
        art: 'wochenblatt',
        kennung: 'wochenblatt:k1',
        name: 'Wochenblatt für das Birseck Nr. 47',
        titel: 'Der Musikverein lädt zum Advent',
        url: 'https://blatt.example/kw47.pdf#page=5'
      }
    ])
  })

  it('erkennt eine Doublette über den gleichen Titel, auch ohne Zusammenfassung', () => {
    const a = antwort(
      [anlass({ titel: 'Weihnachtsmarkt' })],
      [vorschau({ titel: 'Weihnachtsmarkt im Dorf', zusammenfassung: null })]
    )
    expect(a.anzahl).toBe(1)
  })

  it('führt am selben Tag verschiedene Anlässe nicht zusammen', () => {
    const a = antwort(
      [anlass()],
      [
        vorschau({
          titel: 'Flohmarkt auf dem Schulhausplatz',
          zusammenfassung: 'Ein Flohmarkt für Kinder.'
        })
      ]
    )
    expect(a.anzahl).toBe(2)
    expect(a.zusammengefuehrt).toBe(0)
  })

  it('führt denselben Titel an einem anderen Tag oder in einer anderen Gemeinde nicht zusammen', () => {
    expect(
      antwort([anlass()], [vorschau({ anlass_am: '2026-11-30' })]).anzahl
    ).toBe(2)
    expect(
      antwort([anlass()], [vorschau({ gemeinde: MUENCHENSTEIN.id })]).anzahl
    ).toBe(2)
  })

  it('führt zwei Einträge desselben Kalenders nie zusammen', () => {
    const a = antwort([anlass(), anlass({ id: 'a2', zeit: '20:00' })])
    expect(a.anzahl).toBe(2)
  })

  it('gibt dem Gemeindekalender den Vorrang vor einer Organisation, unabhängig von der Reihenfolge', () => {
    const org: KalenderQuelle = {
      ...KALENDER,
      id: 'q-org',
      name: 'Blutspende SRK',
      art: 'organisation'
    }
    const a = antwort([anlass({ id: 'b', quelle: org }), anlass({ id: 'a' })])
    expect(a.anlaesse.map((e) => e.kennung)).toEqual(['kalender:a'])
    expect(a.anlaesse[0]!.weitere_quellen.map((q) => q.kennung)).toEqual([
      'kalender:b'
    ])
    expect(fuehreZusammen([]).anlaesse).toEqual([])
  })
})

describe('Abfrage', () => {
  it('filtert nach Gemeinde nach dem Zusammenführen und weist Unbekanntes ab', () => {
    const a = antwort(
      [
        anlass(),
        anlass({
          id: 'm',
          gemeinde: MUENCHENSTEIN.id,
          titel: 'Räbeliechtliumzug'
        })
      ],
      [],
      'reinach'
    )
    expect(a.anlaesse.map((e) => e.kennung)).toEqual(['kalender:a1'])
    expect(
      parseAbfrage({ gemeinde: 'muenchenstein' }, [REINACH, MUENCHENSTEIN])
    ).toEqual({
      gemeinde: 'muenchenstein'
    })
    expect(parseAbfrage({}, [REINACH])).toEqual({ gemeinde: null })
    expect('fehler' in parseAbfrage({ gemeinde: 'basel' }, [REINACH])).toBe(
      true
    )
    expect('fehler' in parseAbfrage({ gemeinde: ['a', 'b'] }, [REINACH])).toBe(
      true
    )
  })

  it('sortiert nach dem ersten Tag', () => {
    const a = antwort([
      anlass({ id: 'spaet' }),
      anlass({
        id: 'frueh',
        titel: 'Lottomatch',
        termine: ['2026-11-20'],
        von: '2026-11-20'
      })
    ])
    expect(a.anlaesse.map((e) => e.kennung)).toEqual([
      'kalender:frueh',
      'kalender:spaet'
    ])
  })
})
