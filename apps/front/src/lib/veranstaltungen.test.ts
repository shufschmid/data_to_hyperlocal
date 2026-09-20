import type { GemeindeFelder, VeranstaltungFelder, VeranstaltungsquelleFelder } from '@/graphql/redaktion'
import {
  abgelaufen,
  ankerFarbe,
  ankerText,
  anzahlOffen,
  bleibtAufDemTisch,
  dringlichkeit,
  gemeindenOhneKalender,
  laufText,
  meldungJeAnlass,
  naechsterTermin,
  passt,
  quellenMitFehler,
  quellenMitHinweis,
  quellenOhneLeser,
  seitenLink,
  termineText,
  tisch
} from './veranstaltungen'

function anlass(ueber: Partial<VeranstaltungFelder> = {}): VeranstaltungFelder {
  return {
    id: 'a',
    schluessel: 'markt des alterns|kuspo',
    titel: 'Markt des Alterns',
    termine: ['2026-09-25'],
    von: '2026-09-25',
    bis: null,
    zeit: '13:00–18:00',
    rhythmus: 'einmalig',
    zugang: 'offen',
    anker: 'einmalig',
    anker_am: '2026-09-25',
    anker_grund: 'Einmaliger Anlass im Vorschlagsfenster.',
    frist_am: null,
    lokalitaet: 'KUSPO',
    adresse: null,
    ort: 'Pratteln',
    ort_ausserhalb: false,
    veranstalter: 'Gemeinde Pratteln',
    kategorie: null,
    preis: null,
    anmeldung: null,
    beschreibung: 'Ein Markt.',
    text_abgeschnitten: false,
    dokumente: null,
    traktanden: null,
    traktanden_url: null,
    url: 'https://www.pratteln.ch/_rte/anlass/7353004',
    url_kanonisch: null,
    plattform: 'iweb_termine',
    hinweise: null,
    gelesen_am: '2026-09-20T11:00:00Z',
    zuletzt_gesehen_am: '2026-09-20',
    vorschlag: true,
    vorschlag_begruendung: 'Anlass der Gemeinde, offen für alle.',
    entscheid: 'offen',
    ablehnungsgrund: null,
    dauerangebot: null,
    zuletzt_vorgelegt_am: null,
    zuletzt_gemeldet_am: null,
    date_created: '2026-09-20T11:00:00Z',
    gemeinde: { id: 'g1', name: 'Pratteln' },
    quelle: {
      id: 'q1',
      name: 'Veranstaltungskalender der Gemeinde Pratteln',
      url: 'https://www.pratteln.ch/anlaesseaktuelles'
    },
    ...ueber
  }
}

function quelle(ueber: Partial<VeranstaltungsquelleFelder> = {}): VeranstaltungsquelleFelder {
  return {
    id: 'q1',
    name: 'Veranstaltungskalender der Gemeinde Pratteln',
    url: 'https://www.pratteln.ch/anlaesseaktuelles',
    art: 'gemeinde',
    plattform: 'iweb_termine',
    aktiv: true,
    letzte_pruefung: '2026-09-20T11:00:00Z',
    letzter_fehler: null,
    letzter_hinweis: null,
    gemeinde: { id: 'g1', name: 'Pratteln' },
    ...ueber
  }
}

function gemeinde(ueber: Partial<GemeindeFelder> = {}): GemeindeFelder {
  return {
    id: 'g1',
    name: 'Pratteln',
    bezirk: 'Liestal',
    bfs_nummer: 2831,
    plz: ['4133'],
    aktiv: true,
    news_url: null,
    news_letzte_pruefung: null,
    news_letzter_fehler: null,
    news_letzter_hinweis: null,
    suedanflug: false,
    ...ueber
  }
}

const HEUTE = '2026-09-20'
const OHNE_FILTER = { gemeinde: null, suche: '' }

describe('bleibtAufDemTisch', () => {
  it('haelt Offenes und Uebernommenes in Arbeit, laesst Entschiedenes und Fertiges los', () => {
    expect(bleibtAufDemTisch(anlass())).toBe(true)
    expect(bleibtAufDemTisch(anlass({ entscheid: 'abgelehnt' }))).toBe(false)
    expect(bleibtAufDemTisch(anlass({ entscheid: 'weitergereicht' }))).toBe(false)
    expect(bleibtAufDemTisch(anlass({ entscheid: 'uebernommen' }), 'entwurf')).toBe(true)
    expect(bleibtAufDemTisch(anlass({ entscheid: 'uebernommen' }), 'publiziert')).toBe(false)
    expect(bleibtAufDemTisch(anlass({ entscheid: 'uebernommen' }), null)).toBe(false)
  })
})

describe('dringlichkeit', () => {
  // Die Frist liegt VOR dem Anlass, und sie ist es, die auf den Tisch drängt:
  // ein Bastelnachmittag mit Anmeldeschluss am Montag gehoert am Freitag
  // davor nach oben, nicht am Mittwoch danach.
  it('misst den Anker, nicht den Termin', () => {
    const mitFrist = anlass({ von: '2026-09-30', termine: ['2026-09-30'], anker_am: '2026-09-22' })
    expect(dringlichkeit(mitFrist, HEUTE)).toBe(2)
    expect(dringlichkeit(anlass({ anker_am: null }), HEUTE)).toBe(5)
  })

  it('ohne Anker zaehlt der naechste kuenftige Termin, nicht der erste der Serie', () => {
    const serie = anlass({
      anker_am: null,
      von: '2026-08-07',
      termine: ['2026-08-07', '2026-09-04', '2026-10-02']
    })
    expect(naechsterTermin(serie, HEUTE)).toBe('2026-10-02')
    expect(dringlichkeit(serie, HEUTE)).toBe(12)
  })

  it('eine laufende Spanne ist heute dran', () => {
    const ausstellung = anlass({
      anker: 'endet',
      anker_am: null,
      von: '2026-06-01',
      bis: '2026-09-27',
      termine: ['2026-06-01']
    })
    expect(naechsterTermin(ausstellung, HEUTE)).toBe(HEUTE)
  })
})

describe('tisch', () => {
  it('teilt in Vorschlaege, Verankertes und Routine — und sortiert nach Abstand zu heute', () => {
    const { vorschlaege, verankert, routine } = tisch(
      [
        anlass({ id: 'fern', anker_am: '2026-09-28', vorschlag: true }),
        anlass({ id: 'nah', anker_am: '2026-09-22', vorschlag: true }),
        anlass({ id: 'gremium', anker: 'gremium', anker_am: '2026-09-24', vorschlag: null }),
        anlass({ id: 'jass', anker: 'routine', anker_am: null, vorschlag: null }),
        anlass({ id: 'abfuhr', anker: 'abfuhr', anker_am: null, vorschlag: null })
      ],
      OHNE_FILTER,
      new Map(),
      HEUTE
    )
    expect(vorschlaege.map((a) => a.id)).toEqual(['nah', 'fern'])
    expect(verankert.map((a) => a.id)).toEqual(['gremium'])
    expect(routine.map((a) => a.id).sort()).toEqual(['abfuhr', 'jass'])
  })

  it('filtert nach Gemeinde und sucht ueber Titel, Ort und Veranstalter', () => {
    expect(passt(anlass(), { gemeinde: 'g2', suche: '' })).toBe(false)
    expect(passt(anlass(), { gemeinde: 'g1', suche: 'kuspo' })).toBe(true)
    expect(passt(anlass(), { gemeinde: null, suche: 'GEMEINDE PRATTELN' })).toBe(true)
    expect(passt(anlass(), { gemeinde: null, suche: 'Fasnacht' })).toBe(false)
  })
})

describe('abgelaufen', () => {
  it('laesst einen Vorschlag nach seinem Anker verfallen', () => {
    expect(abgelaufen(anlass({ anker_am: '2026-09-19' }), HEUTE)).toBe(true)
    expect(abgelaufen(anlass({ anker_am: '2026-09-20' }), HEUTE)).toBe(false)
  })

  it('raeumt eine ruhende Zeile nach drei Wochen weg — aber nie eine mit Schalter', () => {
    const ruhend = anlass({ vorschlag: null, anker: 'routine', zuletzt_gesehen_am: '2026-08-25' })
    expect(abgelaufen(ruhend, HEUTE)).toBe(true)
    expect(abgelaufen({ ...ruhend, dauerangebot: 'nie' }, HEUTE)).toBe(false)
    expect(abgelaufen({ ...ruhend, zuletzt_gesehen_am: '2026-09-05' }, HEUTE)).toBe(false)
  })

  it('ruehrt Entschiedenes nicht an', () => {
    expect(abgelaufen(anlass({ entscheid: 'uebernommen', anker_am: '2026-01-01' }), HEUTE)).toBe(false)
  })
})

describe('anzahlOffen', () => {
  it('zaehlt Vorschlaege und uebernommene Arbeit, nicht den ganzen Tisch', () => {
    const zeilen = [
      anlass({ id: '1', vorschlag: true }),
      anlass({ id: '2', vorschlag: null, anker: 'routine' }),
      anlass({ id: '3', vorschlag: false }),
      anlass({ id: '4', vorschlag: true, entscheid: 'uebernommen' })
    ]
    expect(anzahlOffen(zeilen, new Map([['4', 'entwurf']]))).toBe(2)
    expect(anzahlOffen(zeilen, new Map([['4', 'publiziert']]))).toBe(1)
  })
})

describe('termineText', () => {
  it('nennt den Monat einmal, wo alle Termine in ihm liegen', () => {
    expect(termineText(['2026-10-03', '2026-10-10', '2026-10-17'])).toBe('3., 10., 17. Oktober 2026')
  })

  it('deklariert, was der Deckel wegliess', () => {
    expect(termineText(['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31'])).toBe(
      '3., 10., 17. Oktober 2026 (+2 weitere)'
    )
  })

  it('schreibt den Monat aus, wo die Termine ihn wechseln', () => {
    expect(termineText(['2026-09-25', '2026-10-30'])).toBe('25. September 2026, 30. Oktober 2026')
    expect(termineText([])).toBe('')
    expect(termineText(null)).toBe('')
  })
})

describe('Anker-Beschriftung', () => {
  it('benennt jeden Anker und zeigt einen unbekannten, statt ihn zu verschlucken', () => {
    expect(ankerText('endet')).toBe('Letzte Gelegenheit')
    expect(ankerText(null)).toBe('Ohne Anker')
    expect(ankerText('kuenftiger_anker')).toBe('kuenftiger_anker')
  })

  it('faerbt eine Aenderung rot und die Routine grau', () => {
    expect(ankerFarbe('ausfall')).toBe('error')
    expect(ankerFarbe('frist')).toBe('warning')
    expect(ankerFarbe('routine')).toBe('default')
    expect(ankerFarbe(null)).toBe('default')
  })
})

describe('meldungJeAnlass', () => {
  it('schluesselt am Anlass, nicht am Datum', () => {
    const karte = meldungJeAnlass([
      { id: 'm1', veranstaltung: { id: 'a' } },
      { id: 'm2', veranstaltung: null }
    ])
    expect(karte.get('a')?.id).toBe('m1')
    expect(karte.size).toBe(1)
  })
})

describe('seitenLink', () => {
  it('nimmt die kanonische Adresse, wo der Kalender eine nennt', () => {
    expect(seitenLink(anlass())).toBe('https://www.pratteln.ch/_rte/anlass/7353004')
    expect(seitenLink(anlass({ url_kanonisch: 'https://www.pratteln.ch/k' }))).toBe(
      'https://www.pratteln.ch/k'
    )
  })
})

describe('die Kalender', () => {
  it('nennt aktive Gemeinden ohne lesbaren Kalender', () => {
    const gemeinden = [
      gemeinde(),
      gemeinde({ id: 'g2', name: 'Riehen' }),
      gemeinde({ id: 'g3', aktiv: false })
    ]
    expect(gemeindenOhneKalender(gemeinden, [quelle()]).map((g) => g.name)).toEqual(['Riehen'])
  })

  // Ein Kalender, der nur auf „plattform" steht, ist nicht kaputt — er hat
  // bloss noch keinen Leser, und das ist eine eigene Aussage.
  it('haelt Fehler, Hinweise und fehlende Leser auseinander', () => {
    const quellen = [
      quelle({ id: 'ok' }),
      quelle({ id: 'kaputt', letzter_fehler: 'Bot-Pruefung' }),
      quelle({ id: 'deckel', letzter_hinweis: '12 weitere Anlässe nicht gelesen' }),
      quelle({ id: 'beides', letzter_fehler: 'Zeitueberschreitung', letzter_hinweis: 'Deckel' }),
      quelle({ id: 'z7', art: 'ort', aktiv: false, letzter_hinweis: 'noch kein Leser' })
    ]
    expect(quellenMitFehler(quellen).map((q) => q.id)).toEqual(['kaputt', 'beides'])
    expect(quellenMitHinweis(quellen).map((q) => q.id)).toEqual(['deckel'])
    expect(quellenOhneLeser(quellen).map((q) => q.id)).toEqual(['z7'])
  })
})

describe('laufText', () => {
  const leer = { laeuft: false, gestartet_um: null, beendet_um: null, ergebnis: null, fehler: null }

  it('schweigt vor dem ersten Lauf und spricht, solange einer unterwegs ist', () => {
    expect(laufText(leer)).toBeNull()
    expect(laufText({ ...leer, laeuft: true })).toMatch(/unterwegs/)
  })

  it('zaehlt Kalender, Anlaesse, Vorschlaege und die wartenden Dauerangebote', () => {
    const text = laufText({
      ...leer,
      beendet_um: '2026-09-20T11:04:00Z',
      ergebnis: {
        quellen: 9,
        anlaesse: 214,
        anlaesseVorschlaege: 7,
        dauerangeboteWarten: 23,
        fehler: ['Muttenz: Zeitueberschreitung']
      }
    })
    expect(text).toContain('9 Kalender gelesen')
    expect(text).toContain('214 Anlässe')
    expect(text).toContain('7 Vorschläge')
    expect(text).toContain('23 Dauerangebote warten')
    expect(text).toContain('1 Fehler')
  })
})
