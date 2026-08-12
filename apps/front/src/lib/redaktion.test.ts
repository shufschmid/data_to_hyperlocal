import type { AnkuendigungFelder, MeldungFelder } from '@/graphql/redaktion'
import {
  absaetze,
  formatiereDatum,
  fortschritt,
  istBeschaeftigt,
  laufStatusText,
  nachBezirk,
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

describe('nachBezirk', () => {
  const gemeinden = [
    { bezirk: 'Liestal', name: 'Liestal' },
    { bezirk: 'Arlesheim', name: 'Therwil' },
    { bezirk: 'Arlesheim', name: 'Aesch' },
    { bezirk: 'Waldenburg', name: 'Oberdorf' }
  ]

  // 86 switches in one flat list is a wall, not a control.
  it('gruppiert nach Bezirk', () => {
    const gruppen = nachBezirk(gemeinden)

    expect(gruppen.map((g) => g.bezirk)).toEqual(['Arlesheim', 'Liestal', 'Waldenburg'])
    expect(gruppen.at(0)?.gemeinden.map((g) => g.name)).toEqual(['Aesch', 'Therwil'])
  })

  it('sortiert nach Schweizer Gepflogenheit', () => {
    const mitUmlaut = [
      { bezirk: 'A', name: 'Zwingen' },
      { bezirk: 'A', name: 'Ärgerlich' },
      { bezirk: 'A', name: 'Aesch' }
    ]
    expect(
      nachBezirk(mitUmlaut)
        .at(0)
        ?.gemeinden.map((g) => g.name)
    ).toEqual(['Aesch', 'Ärgerlich', 'Zwingen'])
  })

  it('vertraegt eine leere Liste', () => {
    expect(nachBezirk([])).toEqual([])
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
