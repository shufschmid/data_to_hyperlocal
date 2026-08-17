import type { AnkuendigungFelder, MeldungFelder } from '@/graphql/redaktion'
import {
  absaetze,
  formatiereDatum,
  fortschritt,
  istBeschaeftigt,
  laufStatusText,
  filterGemeinden,
  resultat,
  teileSpiele,
  vereineNachGemeinde,
  nachQuartal,
  statusFarbe,
  statusText,
  warnungen,
  zeitleiste,
  type ZeitleistenQuellen
} from './redaktion'

function meldung(ueber: Partial<MeldungFelder> = {}): MeldungFelder {
  return {
    id: 'm1',
    titel: 'Ein Titel',
    lead: 'Ein Lead.',
    text: 'Absatz eins.\n\nAbsatz zwei.',
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: null,
    fehler: null,
    publiziert_am: null,
    gemeinde: { id: 'g1', name: 'Aesch', bezirk: 'Arlesheim' },
    ...ueber
  }
}

describe('statusText / statusFarbe', () => {
  it('uebersetzt die Zustaende ins Deutsche', () => {
    expect(statusText('in_pruefung')).toBe('In Gegenprüfung')
    expect(statusText('publiziert')).toBe('Publiziert')
  })

  it('faellt auf den Rohwert zurueck, statt leer zu bleiben', () => {
    expect(statusText('etwas_neues')).toBe('etwas_neues')
    expect(statusFarbe('etwas_neues')).toBe('default')
  })

  it('hebt Publiziert und Gegenpruefung farblich ab', () => {
    expect(statusFarbe('publiziert')).toBe('success')
    expect(statusFarbe('in_pruefung')).toBe('warning')
  })
})

describe('laufStatusText', () => {
  it('erklaert, was gerade passiert', () => {
    expect(laufStatusText('schreibt')).toBe('Meldungen werden geschrieben')
    expect(laufStatusText('bereit')).toBe('Bereit zur Durchsicht')
  })
})

describe('istBeschaeftigt', () => {
  // Drives the polling: while something is queued or running, the workspace
  // keeps refreshing; otherwise it stops asking.
  it('erkennt laufende Arbeit', () => {
    expect(istBeschaeftigt([meldung({ verarbeitung: 'geplant' })])).toBe(true)
    expect(istBeschaeftigt([meldung({ verarbeitung: 'laeuft' })])).toBe(true)
  })

  it('ist ruhig, wenn nichts ansteht', () => {
    expect(istBeschaeftigt([meldung(), meldung({ verarbeitung: 'fehler' })])).toBe(false)
    expect(istBeschaeftigt([])).toBe(false)
  })
})

describe('fortschritt', () => {
  it('zaehlt nur fertige Meldungen', () => {
    const werte = fortschritt([
      meldung(),
      meldung({ titel: null, verarbeitung: 'geplant' }),
      meldung({ verarbeitung: 'laeuft' })
    ])

    expect(werte).toEqual({ fertig: 1, gesamt: 3, prozent: 33 })
  })

  it('bricht nicht an einem leeren Lauf', () => {
    expect(fortschritt([])).toEqual({ fertig: 0, gesamt: 0, prozent: 0 })
  })
})

describe('warnungen', () => {
  it('sammelt Zeit-Warnungen und Fehler', () => {
    expect(warnungen(meldung({ zeit_warnungen: ['Vorjahr'], fehler: 'Etwas ging schief' }))).toEqual([
      'Vorjahr',
      'Etwas ging schief'
    ])
  })

  // An empty list is what keeps the ones that matter visible.
  it('meldet nichts, wenn nichts zu melden ist', () => {
    expect(warnungen(meldung())).toEqual([])
    expect(warnungen(meldung({ fehler: '   ' }))).toEqual([])
  })
})

describe('formatiereDatum', () => {
  it('schreibt Schweizer Datumsformat', () => {
    expect(formatiereDatum('2026-07-07T00:00:00Z')).toMatch(/07\.07\.2026/)
  })

  it('vertraegt fehlende und kaputte Werte', () => {
    expect(formatiereDatum(null)).toBe('—')
    expect(formatiereDatum('kein datum')).toBe('—')
  })
})

describe('absaetze', () => {
  it('trennt an Leerzeilen', () => {
    expect(absaetze('Eins.\n\nZwei.')).toEqual(['Eins.', 'Zwei.'])
  })

  it('wirft leere Absaetze weg', () => {
    expect(absaetze('Eins.\n\n\n\n  \n\nZwei.')).toEqual(['Eins.', 'Zwei.'])
  })

  it('vertraegt fehlenden Text', () => {
    expect(absaetze(null)).toEqual([])
  })
})

describe('filterGemeinden', () => {
  const gemeinden = [
    { name: 'Liestal', bezirk: 'Liestal', bfs_nummer: 2829, aktiv: true },
    { name: 'Therwil', bezirk: 'Arlesheim', bfs_nummer: 2775, aktiv: false },
    { name: 'Münchenstein', bezirk: 'Arlesheim', bfs_nummer: 2769, aktiv: true },
    { name: 'Riehen', bezirk: 'Basel-Stadt', bfs_nummer: 2703, aktiv: true }
  ]

  it('sortiert alphabetisch nach Schweizer Gepflogenheit', () => {
    expect(filterGemeinden(gemeinden, '', false).map((g) => g.name)).toEqual([
      'Liestal',
      'Münchenstein',
      'Riehen',
      'Therwil'
    ])
  })

  it('findet auch ohne Umlaut', () => {
    expect(filterGemeinden(gemeinden, 'munchenstein', false).map((g) => g.name)).toEqual(['Münchenstein'])
  })

  it('sucht nach BFS-Nummer und Bezirk', () => {
    expect(filterGemeinden(gemeinden, '2703', false).map((g) => g.name)).toEqual(['Riehen'])
    expect(filterGemeinden(gemeinden, 'arlesheim', false).map((g) => g.name)).toEqual([
      'Münchenstein',
      'Therwil'
    ])
  })

  // Riehen is the reason the district accordions went: outside the five
  // Basel-Landschaft districts it arrived as its own collapsed one-item group.
  it('zeigt eine Gemeinde ausserhalb der BL-Bezirke gleichberechtigt', () => {
    expect(filterGemeinden(gemeinden, '', true).map((g) => g.name)).toContain('Riehen')
  })

  it('filtert auf aktive Gemeinden', () => {
    expect(filterGemeinden(gemeinden, '', true).map((g) => g.name)).toEqual([
      'Liestal',
      'Münchenstein',
      'Riehen'
    ])
  })

  it('vertraegt eine leere Liste', () => {
    expect(filterGemeinden([], 'x', false)).toEqual([])
  })
})

describe('teileSpiele', () => {
  const jetzt = new Date('2026-08-20T12:00:00Z')
  const spiel = (datum: string) => ({ datum })

  it('trennt an der Uhr und sortiert von der Gegenwart weg', () => {
    const { vergangen, kommend } = teileSpiele(
      [
        spiel('2026-08-18T18:00:00Z'),
        spiel('2026-08-25T18:00:00Z'),
        spiel('2026-08-19T18:00:00Z'),
        spiel('2026-08-21T18:00:00Z')
      ],
      jetzt
    )

    expect(vergangen.map((s) => s.datum)).toEqual(['2026-08-19T18:00:00Z', '2026-08-18T18:00:00Z'])
    expect(kommend.map((s) => s.datum)).toEqual(['2026-08-21T18:00:00Z', '2026-08-25T18:00:00Z'])
  })

  // A finished match whose result the source has not published yet still
  // belongs to the past — otherwise the fixture an editor is waiting for hides
  // among the upcoming ones.
  it('richtet sich nach dem Datum, nicht nach dem Resultat', () => {
    const { vergangen } = teileSpiele([spiel('2026-08-20T09:00:00Z')], jetzt)
    expect(vergangen).toHaveLength(1)
  })

  it('wirft kaputte Daten weg, statt zu raten', () => {
    const { vergangen, kommend } = teileSpiele([spiel('kein datum')], jetzt)
    expect(vergangen).toEqual([])
    expect(kommend).toEqual([])
  })

  it('vertraegt eine leere Liste', () => {
    expect(teileSpiele([], jetzt)).toEqual({ vergangen: [], kommend: [] })
  })
})

describe('resultat', () => {
  it('schreibt das Resultat in Spielrichtung', () => {
    expect(resultat(3, 1)).toBe('3:1')
    expect(resultat(0, 0)).toBe('0:0')
  })

  // Half a score is not a score — inventing the other half is how a reversed
  // scoreline reaches an article.
  it('zeigt nichts, solange nicht beide Zahlen dastehen', () => {
    expect(resultat(null, null)).toBe('–')
    expect(resultat(3, null)).toBe('–')
    expect(resultat(null, 1)).toBe('–')
  })
})

describe('vereineNachGemeinde', () => {
  const verein = (name: string, bedeutung: string, gemeinde: string | null) => ({
    name,
    bedeutung,
    gemeinde: gemeinde === null ? null : { id: gemeinde }
  })

  it('gruppiert nach Gemeinde, Aushaengeschild zuerst', () => {
    const nach = vereineNachGemeinde([
      verein('FC Aesch', 'breitensport', 'g1'),
      verein("Sm'Aesch Pfeffingen", 'aushaengeschild', 'g1'),
      verein('FC Pratteln', 'breitensport', 'g2')
    ])

    expect(nach.get('g1')?.map((v) => v.name)).toEqual(["Sm'Aesch Pfeffingen", 'FC Aesch'])
    expect(nach.get('g2')?.map((v) => v.name)).toEqual(['FC Pratteln'])
  })

  it('sortiert gleichrangige Vereine alphabetisch', () => {
    const nach = vereineNachGemeinde([
      verein('TV Pratteln NS', 'aushaengeschild', 'g1'),
      verein('Gladiators beider Basel', 'aushaengeschild', 'g1')
    ])

    expect(nach.get('g1')?.map((v) => v.name)).toEqual(['Gladiators beider Basel', 'TV Pratteln NS'])
  })

  it('ueberspringt Vereine ohne Gemeinde', () => {
    expect(vereineNachGemeinde([verein('Heimatlos', 'breitensport', null)]).size).toBe(0)
  })
})

describe('nachQuartal', () => {
  const eintrag = (ueber: Partial<AnkuendigungFelder>): AnkuendigungFelder => ({
    id: 'a',
    titel: 'Etwas 2025',
    status: 'geplant',
    datum: null,
    quartal: '3. Quartal: Juli–September',
    link: null,
    datensatz: null,
    zuordnung_hinweis: null,
    ...ueber
  })

  it('ordnet die Quartale wie die Agenda, nicht alphabetisch', () => {
    const gruppen = nachQuartal([
      eintrag({ id: 'c', quartal: '4. Quartal: Oktober–Dezember' }),
      eintrag({ id: 'a', quartal: '1. Quartal: Januar–März' }),
      eintrag({ id: 'b', quartal: '3. Quartal: Juli–September' })
    ])

    expect(gruppen.map((g) => g.quartal)).toEqual([
      '1. Quartal: Januar–März',
      '3. Quartal: Juli–September',
      '4. Quartal: Oktober–Dezember'
    ])
  })

  it('sortiert datierte Eintraege chronologisch', () => {
    const [gruppe] = nachQuartal([
      eintrag({ id: 'spaet', datum: '2026-07-07', status: 'publiziert' }),
      eintrag({ id: 'frueh', datum: '2026-07-01', status: 'publiziert' })
    ])

    expect(gruppe?.eintraege.map((e) => e.id)).toEqual(['frueh', 'spaet'])
  })

  // Angekündigte Eintraege haben kein Datum. Sie hinter die datierten zu
  // stellen bildet die Seite ab; sie umzusortieren wuerde eine Reihenfolge
  // behaupten, die die Quelle nie genannt hat.
  it('haengt undatierte Eintraege in Eingangsreihenfolge hinten an', () => {
    const [gruppe] = nachQuartal([
      eintrag({ id: 'geplant-1' }),
      eintrag({ id: 'publiziert', datum: '2026-07-07', status: 'publiziert' }),
      eintrag({ id: 'geplant-2' })
    ])

    expect(gruppe?.eintraege.map((e) => e.id)).toEqual(['publiziert', 'geplant-1', 'geplant-2'])
  })

  it('stellt Eintraege ohne Quartalsangabe ans Ende', () => {
    const gruppen = nachQuartal([
      eintrag({ id: 'ohne', quartal: null }),
      eintrag({ id: 'mit', quartal: '2. Quartal: April–Juni' })
    ])

    expect(gruppen.map((g) => g.quartal)).toEqual(['2. Quartal: April–Juni', 'Ohne Quartalsangabe'])
  })
})

describe('zeitleiste', () => {
  const quellen = (ueber: Partial<ZeitleistenQuellen> = {}): ZeitleistenQuellen => ({
    ankuendigungen: [],
    bereiche: [],
    datensaetze: [],
    laeufe: [],
    ...ueber
  })

  const agenda = (ueber: Partial<ZeitleistenQuellen['ankuendigungen'][number]> = {}) => ({
    id: 'a1',
    titel: 'Abfallstatistik 2025',
    datum: '2026-07-07',
    quartal: '3. Quartal: Juli–September',
    zuordnung_hinweis: null,
    datensatz: null,
    ...ueber
  })

  const datensatz = (ueber: Partial<ZeitleistenQuellen['datensaetze'][number]> = {}) => ({
    id: 'd1',
    titel: 'Firmen nach Zweck, Rechtsform und Standort',
    status: 'relevant',
    hat_gemeinde: true,
    portal_modified: '2026-08-12',
    bewertung: 'Relevant: …',
    ...ueber
  })

  it('mischt die drei Quellen und sortiert neueste zuerst', () => {
    const { datiert } = zeitleiste(
      quellen({
        ankuendigungen: [agenda({ datum: '2026-07-07' })],
        bereiche: [{ id: 'b1', pfad: '18_4', titel: 'Gebühren', stand: '2026-06-11', beobachten: true }],
        datensaetze: [datensatz({ portal_modified: '2026-08-12' })]
      })
    )

    expect(datiert.map((e) => e.herkunft)).toEqual(['datensatz', 'agenda', 'portal'])
  })

  // Ein Zweig, den niemand prueft, hat sich fuer uns nicht gemeldet.
  it('zeigt nur beobachtete Portal-Zweige', () => {
    const { datiert } = zeitleiste(
      quellen({
        bereiche: [
          { id: 'b1', pfad: '5_1', titel: '', stand: '2026-05-19', beobachten: false },
          { id: 'b2', pfad: '18_4', titel: '', stand: '2026-06-11', beobachten: true }
        ]
      })
    )

    expect(datiert).toHaveLength(1)
    expect(datiert[0]?.pfad).toBe('18_4')
  })

  // Sonst stuende dieselbe Statistik zweimal untereinander — einmal mit dem
  // Titel des Amts, einmal mit dem des Portals.
  it('zeigt einen Datensatz nicht doppelt, wenn er an einer Agenda-Zeile haengt', () => {
    const { datiert } = zeitleiste(
      quellen({
        ankuendigungen: [agenda({ datensatz: { id: 'd1', hat_gemeinde: true } })],
        datensaetze: [datensatz({ id: 'd1' })]
      })
    )

    expect(datiert).toHaveLength(1)
    expect(datiert[0]?.herkunft).toBe('agenda')
  })

  it('verknuepft die Zeile mit einem bestehenden Lauf', () => {
    const { datiert } = zeitleiste(
      quellen({
        datensaetze: [datensatz({ id: 'd1' })],
        laeufe: [{ id: 'lauf-1', datensatz: { id: 'd1' } }]
      })
    )

    expect(datiert[0]?.laufId).toBe('lauf-1')
  })

  it('laesst Datensaetze ohne Gemeindespalte weg', () => {
    const { datiert } = zeitleiste(quellen({ datensaetze: [datensatz({ hat_gemeinde: false })] }))

    expect(datiert).toHaveLength(0)
  })

  // Angekuendigt, aber noch ohne Termin: unten, nach Quartal — und sobald das
  // Amt ein Datum nennt, oben in der Leiste.
  it('haengt undatierte Agenda-Eintraege hinten an', () => {
    const ohneTermin = agenda({ id: 'a2', titel: 'Leerstandserhebung 2026', datum: null })
    const ergebnis = zeitleiste(quellen({ ankuendigungen: [agenda(), ohneTermin] }))

    expect(ergebnis.datiert.map((e) => e.titel)).toEqual(['Abfallstatistik 2025'])
    expect(ergebnis.ohneDatum.map((e) => e.titel)).toEqual(['Leerstandserhebung 2026'])
    expect(ergebnis.ohneDatum[0]?.quartal).toBe('3. Quartal: Juli–September')
  })

  it('rueckt einen Eintrag in die Leiste, sobald er ein Datum hat', () => {
    const vorher = zeitleiste(quellen({ ankuendigungen: [agenda({ datum: null })] }))
    const nachher = zeitleiste(quellen({ ankuendigungen: [agenda({ datum: '2026-08-13' })] }))

    expect(vorher.datiert).toHaveLength(0)
    expect(nachher.datiert).toHaveLength(1)
    expect(nachher.ohneDatum).toHaveLength(0)
  })

  it('deckelt die Liste und sagt, wie viele fehlen', () => {
    const viele = Array.from({ length: 10 }, (_, i) =>
      datensatz({ id: `d${i}`, portal_modified: `2026-08-${String(i + 1).padStart(2, '0')}` })
    )
    const ergebnis = zeitleiste(quellen({ datensaetze: viele }), 4)

    expect(ergebnis.datiert).toHaveLength(4)
    expect(ergebnis.weitere).toBe(6)
    // Der Deckel schneidet die aeltesten weg, nicht die neuesten.
    expect(ergebnis.datiert[0]?.datum).toBe('2026-08-10')
  })
})
