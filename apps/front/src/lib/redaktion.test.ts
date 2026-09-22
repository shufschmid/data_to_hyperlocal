import type { AnkuendigungFelder, MeldungFelder } from '@/graphql/redaktion'
import {
  absaetze,
  anzahlBeschaeftigt,
  berichtenswerteSpiele,
  blattJeGemeinde,
  kalenderJeGemeinde,
  bleibtAufDemTisch,
  formatiereDatum,
  fortschritt,
  istBeschaeftigt,
  laufStatusText,
  blogDatum,
  blogNachGemeinde,
  filterGemeinden,
  gemeindeSlug,
  meldungenNachLauf,
  pruefsiegelText,
  quellenLaufText,
  resultat,
  seitenLink,
  datensatzLink,
  statistikPortaleFuer,
  ordneSpiele,
  reinerText,
  vereineNachGemeinde,
  nachQuartal,
  statusFarbe,
  statusText,
  textStuecke,
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
    publiziert_durch: null,
    termin: null,
    termin_vorschlag: null,
    wichtig: null,
    wichtig_vorschlag: null,
    revision_hinweis: null,
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

describe('ordneSpiele', () => {
  const jetzt = new Date('2026-08-20T12:00:00Z')
  const spiel = (datum: string, tore: [number, number] | null = null) => ({
    datum,
    tore_heim: tore === null ? null : tore[0],
    tore_gast: tore === null ? null : tore[1]
  })

  it('legt frische Resultate zuoberst, das neueste zuerst', () => {
    const { aktuelle } = ordneSpiele(
      [spiel('2026-08-18T18:00:00Z', [1, 0]), spiel('2026-08-19T18:00:00Z', [2, 2])],
      jetzt
    )
    expect(aktuelle.map((s) => s.datum)).toEqual(['2026-08-19T18:00:00Z', '2026-08-18T18:00:00Z'])
  })

  // Ein gespieltes Match ohne publiziertes Resultat ist genau das, worauf die
  // Redaktion wartet — es steht bei den offenen Partien, nicht bei den News.
  it('stellt Gespieltes ohne Resultat zu den anstehenden Partien, zuoberst', () => {
    const { aktuelle, anstehend } = ordneSpiele(
      [spiel('2026-08-25T18:00:00Z'), spiel('2026-08-19T18:00:00Z'), spiel('2026-08-21T18:00:00Z')],
      jetzt
    )
    expect(aktuelle).toEqual([])
    expect(anstehend.map((s) => s.datum)).toEqual([
      '2026-08-19T18:00:00Z',
      '2026-08-21T18:00:00Z',
      '2026-08-25T18:00:00Z'
    ])
  })

  // Fuenf Tage, dann ist ein Resultat Geschichte — und ein Spiel, dessen
  // Resultat nie kam, ebenso.
  it('verschiebt Aelteres als fuenf Tage ins Archiv, das neueste zuerst', () => {
    const { aktuelle, anstehend, archiv } = ordneSpiele(
      [
        spiel('2026-08-10T18:00:00Z', [3, 1]),
        spiel('2026-08-14T18:00:00Z'),
        spiel('2026-08-19T18:00:00Z', [2, 2])
      ],
      jetzt
    )
    expect(aktuelle.map((s) => s.datum)).toEqual(['2026-08-19T18:00:00Z'])
    expect(anstehend).toEqual([])
    expect(archiv.map((s) => s.datum)).toEqual(['2026-08-14T18:00:00Z', '2026-08-10T18:00:00Z'])
  })

  it('wirft kaputte Daten weg, statt zu raten', () => {
    expect(ordneSpiele([spiel('kein datum')], jetzt)).toEqual({
      aktuelle: [],
      anstehend: [],
      archiv: []
    })
  })

  it('vertraegt eine leere Liste', () => {
    expect(ordneSpiele([], jetzt)).toEqual({ aktuelle: [], anstehend: [], archiv: [] })
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

describe('reinerText', () => {
  // data.bl.ch liefert Katalogbeschreibungen als HTML; abgeschnitten nach 220
  // Zeichen stand "<p>" wortwoertlich im Reiter.
  it('entfernt Tags und loest Entitaeten auf', () => {
    expect(reinerText('<p>Radondaten &amp; Messwerte<br/>je Geb&auml;ude</p>'.replace('&auml;', 'ä'))).toBe(
      'Radondaten & Messwerte je Gebäude'
    )
  })

  it('macht aus leerem HTML null statt eines leeren Strings', () => {
    expect(reinerText('<p>  </p>')).toBeNull()
    expect(reinerText(null)).toBeNull()
  })
})

describe('datensatzLink', () => {
  // Dieselbe Regel wie redaktion/quelle.ts im Backend — nur der Datenteil.
  it('kennt beide Portale', () => {
    expect(datensatzLink('ods', '12410')).toBe('https://data.bl.ch/explore/dataset/12410/')
    expect(datensatzLink('statbl', '10_3')).toBe('https://statistik.bl.ch/web_portal/10_3')
  })

  it('nimmt das Portal der Quelle, wo eines mitkommt', () => {
    expect(datensatzLink('ods', '100059', 'https://data.bs.ch')).toBe(
      'https://data.bs.ch/explore/dataset/100059/'
    )
    expect(datensatzLink('statbl', '10_3', 'https://statistik.bl.ch/web_portal/')).toBe(
      'https://statistik.bl.ch/web_portal/10_3'
    )
  })

  it('erfindet keine Adresse', () => {
    expect(datensatzLink('ods', '')).toBeNull()
    expect(datensatzLink(null, '12410')).toBeNull()
    expect(datensatzLink('agenda', '12410')).toBeNull()
  })
})

describe('statistikPortaleFuer', () => {
  const portale = [
    {
      id: 'q-bl',
      name: 'Statistik Basel-Landschaft (data.bl.ch)',
      typ: 'ods',
      konfiguration: { bezirke: ['Arlesheim', 'Liestal'] }
    },
    {
      id: 'q-bs',
      name: 'Statistik Basel-Stadt (data.bs.ch)',
      typ: 'ods',
      konfiguration: { bezirke: ['Basel-Stadt'] }
    },
    { id: 'q-agenda', name: 'Publikationsagenda', typ: 'agenda', konfiguration: null }
  ]

  it('nennt das Portal, das den Bezirk der Gemeinde fuehrt', () => {
    expect(statistikPortaleFuer('Arlesheim', portale).map((p) => p.id)).toEqual(['q-bl'])
    expect(statistikPortaleFuer('Basel-Stadt', portale).map((p) => p.id)).toEqual(['q-bs'])
  })

  // Ehrlicher als Schweigen: sagt kein Portal etwas ueber diesen Bezirk,
  // wartet die Redaktion sonst auf Meldungen, die nicht kommen koennen.
  it('antwortet leer, wo kein Portal den Bezirk fuehrt', () => {
    expect(statistikPortaleFuer('Dorneck', portale)).toEqual([])
    expect(statistikPortaleFuer('Arlesheim', [])).toEqual([])
  })

  it('nimmt nur Statistikquellen, nicht die Agenda', () => {
    const nurAgenda = [
      { id: 'q-a', name: 'Agenda', typ: 'agenda', konfiguration: { bezirke: ['Arlesheim'] } }
    ]
    expect(statistikPortaleFuer('Arlesheim', nurAgenda)).toEqual([])
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

  // Der Link zu den Daten gehoert auf die Zeile, bevor irgendeine Meldung
  // existiert — und die Katalogbeschreibung ohne ihr rohes HTML.
  it('verlinkt den Datensatz und bereinigt die Beschreibung', () => {
    const { datiert } = zeitleiste(
      quellen({
        datensaetze: [
          datensatz({
            externe_id: '12410',
            quelle: { typ: 'ods' },
            beschreibung: '<p>Radondaten je Gebäude</p>'
          })
        ]
      })
    )
    expect(datiert[0]?.link).toBe('https://data.bl.ch/explore/dataset/12410/')
    expect(datiert[0]?.beschreibung).toBe('Radondaten je Gebäude')
  })

  it('verlinkt beim Agenda-Eintrag den Artikel des Amts vor den Daten', () => {
    const { datiert } = zeitleiste(
      quellen({
        ankuendigungen: [
          agenda({
            link: 'https://www.baselland.ch/artikel',
            datensatz: { id: 'd1', hat_gemeinde: true, externe_id: '12410', quelle: { typ: 'ods' } }
          })
        ]
      })
    )
    expect(datiert[0]?.link).toBe('https://www.baselland.ch/artikel')
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

  // Ein Agenda-Thema umfasst oft mehrere Datensaetze — „Bau- und
  // Wohnbaustatistik“ sind die neu erstellten Wohnungen UND der
  // Wohnungsbestand. Alle zeigen auf die Ankuendigung, die Leiste zeigt das
  // Thema einmal.
  it('versteckt auch die weiteren Datensaetze eines Agenda-Themas', () => {
    const { datiert } = zeitleiste(
      quellen({
        ankuendigungen: [agenda({ id: 'a1', datensatz: { id: 'd1', hat_gemeinde: true } })],
        datensaetze: [
          datensatz({ id: 'd1', ankuendigung: { id: 'a1' } }),
          datensatz({ id: 'd2', titel: 'Wohnungsbestand', ankuendigung: { id: 'a1' } }),
          // Ohne Agenda-Thema — und juenger, damit die Reihenfolge eindeutig ist.
          datensatz({ id: 'd3', titel: 'Gemeindekennzahlen', portal_modified: '2026-08-20' })
        ]
      })
    )

    expect(datiert.map((e) => e.titel)).toEqual(['Gemeindekennzahlen', 'Abfallstatistik 2025'])
  })

  // Der Abfall-Fall: Ankuendigung vom 7. Juli, Zahlen vom 13. August. Ohne
  // Anhebung stuende die Ankuendigung weit unten, die Zahlen oben.
  it('hebt den Agenda-Eintrag auf den Stand seiner Zahlen', () => {
    const { datiert } = zeitleiste(
      quellen({
        ankuendigungen: [agenda({ id: 'a1', datum: '2026-07-07' })],
        datensaetze: [datensatz({ id: 'd1', ankuendigung: { id: 'a1' }, daten_stand: '2026-08-13' })]
      })
    )

    expect(datiert).toHaveLength(1)
    expect(datiert[0]?.datum).toBe('2026-08-13')
  })

  it('haelt das Datum der Ankuendigung, wenn es das juengere ist', () => {
    const { datiert } = zeitleiste(
      quellen({
        ankuendigungen: [agenda({ id: 'a1', datum: '2026-08-21' })],
        datensaetze: [datensatz({ id: 'd1', ankuendigung: { id: 'a1' }, daten_stand: '2026-08-13' })]
      })
    )

    expect(datiert[0]?.datum).toBe('2026-08-21')
  })

  // Angekuendigt ohne Termin, aber die Zahlen sind schon da: das ist der
  // Moment, in dem der Eintrag von unten nach oben gehoert.
  it('datiert einen undatierten Eintrag ueber seine Zahlen', () => {
    const ergebnis = zeitleiste(
      quellen({
        ankuendigungen: [agenda({ id: 'a1', datum: null })],
        datensaetze: [datensatz({ id: 'd1', ankuendigung: { id: 'a1' }, daten_stand: '2026-08-13' })]
      })
    )

    expect(ergebnis.ohneDatum).toHaveLength(0)
    expect(ergebnis.datiert[0]?.datum).toBe('2026-08-13')
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

describe('meldungenNachLauf', () => {
  const m = (id: string, lauf: string | null) => ({ id, lauf: lauf === null ? null : { id: lauf } })

  it('buendelt nach Lauf', () => {
    const nach = meldungenNachLauf([m('a', 'L1'), m('b', 'L2'), m('c', 'L1')])
    expect(nach.get('L1')?.map((x) => x.id)).toEqual(['a', 'c'])
    expect(nach.get('L2')?.map((x) => x.id)).toEqual(['b'])
  })

  // Ein Spielbericht gehoert zu keinem Lauf und darf keinen erfinden.
  it('laesst Meldungen ohne Lauf weg', () => {
    expect(meldungenNachLauf([m('sport', null)]).size).toBe(0)
  })
})

describe('blogDatum', () => {
  it('nimmt das Publikationsdatum, wenn es eines gibt', () => {
    expect(blogDatum({ publiziert_am: '2026-08-19T10:00:00Z', date_created: '2026-08-01T10:00:00Z' })).toBe(
      '2026-08-19T10:00:00Z'
    )
  })

  // Ein Entwurf faellt sonst ans Ende der Liste, obwohl er der neuste ist.
  it('faellt auf die Entstehung zurueck', () => {
    expect(blogDatum({ publiziert_am: null, date_created: '2026-08-01T10:00:00Z' })).toBe(
      '2026-08-01T10:00:00Z'
    )
  })
})

describe('blogNachGemeinde', () => {
  const beitrag = (id: string, gemeinde: string | null, datum: string | null) => ({
    id,
    publiziert_am: datum,
    date_created: '2026-01-01T00:00:00Z',
    gemeinde: gemeinde === null ? null : { id: gemeinde, name: gemeinde }
  })

  it('gruppiert je Gemeinde, neueste zuerst', () => {
    const blogs = blogNachGemeinde([
      beitrag('alt', 'Riehen', '2026-08-01T10:00:00Z'),
      beitrag('neu', 'Riehen', '2026-08-20T10:00:00Z'),
      beitrag('aesch', 'Aesch', '2026-08-10T10:00:00Z')
    ])

    expect(blogs.map((b) => b.gemeinde.name)).toEqual(['Aesch', 'Riehen'])
    expect(blogs[1]?.beitraege.map((x) => x.id)).toEqual(['neu', 'alt'])
  })

  // Statistik und Sport stehen im selben Blog — die Herkunft ist eine Frage der
  // Produktion, nicht der Lektuere.
  it('mischt die Herkuenfte ohne Unterschied', () => {
    const blogs = blogNachGemeinde([
      beitrag('statistik', 'Riehen', '2026-08-05T10:00:00Z'),
      beitrag('sport', 'Riehen', '2026-08-19T10:00:00Z')
    ])
    expect(blogs[0]?.beitraege.map((x) => x.id)).toEqual(['sport', 'statistik'])
  })

  it('sortiert Undatiertes ans Ende, statt es zu verlieren', () => {
    const ohne = {
      id: 'x',
      publiziert_am: null,
      date_created: null,
      gemeinde: { id: 'Riehen', name: 'Riehen' }
    }
    const blogs = blogNachGemeinde([ohne, beitrag('mit', 'Riehen', '2026-08-01T10:00:00Z')])
    expect(blogs[0]?.beitraege.map((x) => x.id)).toEqual(['mit', 'x'])
  })

  it('laesst Meldungen ohne Gemeinde weg', () => {
    expect(blogNachGemeinde([beitrag('heimatlos', null, '2026-08-01T10:00:00Z')])).toEqual([])
  })
})

describe('gemeindeSlug', () => {
  it('schreibt Umlaute aus, wie Schweizer Ortsnamen in URLs', () => {
    expect(gemeindeSlug('Münchenstein')).toBe('muenchenstein')
    expect(gemeindeSlug('Läufelfingen')).toBe('laeufelfingen')
  })

  it('macht aus Sonderzeichen Bindestriche', () => {
    expect(gemeindeSlug('Burg im Leimental')).toBe('burg-im-leimental')
    expect(gemeindeSlug('Biel-Benken')).toBe('biel-benken')
  })

  it('bleibt bei einfachen Namen einfach', () => {
    expect(gemeindeSlug('Riehen')).toBe('riehen')
  })
})

describe('quellenLaufText', () => {
  const leer = {
    laeuft: false,
    gestartet_um: null,
    beendet_um: null,
    quellen: null,
    sport: null,
    fehler: null
  }

  it('schweigt, solange nie ein Lauf stattfand', () => {
    expect(quellenLaufText(leer)).toBeNull()
  })

  it('sagt waehrend des Laufs, dass man nicht warten muss', () => {
    expect(quellenLaufText({ ...leer, laeuft: true })).toContain('dauert einige Minuten')
  })

  it('fasst die Zaehler beider Haelften zusammen', () => {
    const text = quellenLaufText({
      ...leer,
      beendet_um: '2026-08-25T06:05:00Z',
      quellen: { neu: 2, geaendert: 1, bewertet: 5, fehler: ['x'] },
      sport: { neu: 4, aktualisiert: 3 }
    })

    expect(text).toContain('Datenquellen: 2 neu, 1 geändert, 5 bewertet')
    expect(text).toContain('1 Quelle(n) mit Fehler')
    expect(text).toContain('Sport: 4 neu, 3 aktualisiert')
  })
})

describe('seitenLink', () => {
  it('haengt bei PDFs das Viewer-Fragment an', () => {
    expect(seitenLink('https://files.localpoint.ch/pdf/bib/2026/x.pdf', 4)).toBe(
      'https://files.localpoint.ch/pdf/bib/2026/x.pdf#page=4'
    )
  })

  it('haengt beim issuu-Reader die Seite als Pfadsegment an', () => {
    expect(seitenLink('https://issuu.com/az-anzeiger/docs/35_20260827_woz_wobanz', 19)).toBe(
      'https://issuu.com/az-anzeiger/docs/35_20260827_woz_wobanz/19'
    )
  })

  it('gibt ohne Seite die Adresse unveraendert zurueck', () => {
    expect(seitenLink('https://example.ch/zeitung.pdf', null)).toBe('https://example.ch/zeitung.pdf')
  })
})

describe('bleibtAufDemTisch', () => {
  it('blendet Verfallenes aus — liegen gelassen ist kein offener Vorschlag mehr', () => {
    expect(bleibtAufDemTisch('verfallen', null)).toBe(false)
  })

  it('laesst Offenes und laufendes Redigat liegen', () => {
    expect(bleibtAufDemTisch('offen', null)).toBe(true)
    expect(bleibtAufDemTisch('uebernommen', 'entwurf')).toBe(true)
    expect(bleibtAufDemTisch('uebernommen', 'in_pruefung')).toBe(true)
    expect(bleibtAufDemTisch('uebernommen', 'freigegeben')).toBe(true)
  })

  it('raeumt Erledigtes ab — publiziert, verworfen, abgelehnt, weitergereicht', () => {
    expect(bleibtAufDemTisch('uebernommen', 'publiziert')).toBe(false)
    expect(bleibtAufDemTisch('uebernommen', 'verworfen')).toBe(false)
    expect(bleibtAufDemTisch('abgelehnt', null)).toBe(false)
    expect(bleibtAufDemTisch('weitergereicht', null)).toBe(false)
  })

  it('zeigt eine uebernommene Meldung nicht mehr, wenn sie verschwunden ist', () => {
    // Ein Admin-Delete der Meldung laesst nichts zu tun uebrig.
    expect(bleibtAufDemTisch('uebernommen', null)).toBe(false)
  })
})

describe('anzahlBeschaeftigt', () => {
  // Der Grund, warum es das gibt: nach „alle neu formulieren" laufen die
  // Meldungen im Hintergrund weiter. Ohne dieses Signal pollte die Ansicht
  // nicht — der Redaktor sah minutenlang den alten Text und hielt es fuer
  // einen haengenden Lauf. Die Zahl steht jetzt im Banner.
  const m = (verarbeitung: string) => ({ verarbeitung })

  it('zaehlt, wie viele noch unterwegs sind', () => {
    expect(anzahlBeschaeftigt([m('geplant'), m('laeuft'), m('idle')])).toBe(2)
    expect(anzahlBeschaeftigt([m('idle')])).toBe(0)
    expect(anzahlBeschaeftigt([])).toBe(0)
  })

  // Strukturell getypt, damit beide Meldungsformen der Oberflaeche passen.
  it('nimmt jede Form mit einem Verarbeitungsstand', () => {
    expect(istBeschaeftigt([{ verarbeitung: 'laeuft' }])).toBe(true)
  })
})

describe('textStuecke', () => {
  // Der Quellen-Link kommt vom Backend und zeigt auf die geprueste Adresse.
  // Gerendert wird er, indem GENAU diese Form geparst und alles andere als
  // Text behandelt wird — nie ueber dangerouslySetInnerHTML.
  it('trennt Prosa und Quellen-Link', () => {
    const absatz =
      'In Pratteln entstanden 22 Wohnungen, wie das <a href="https://data.bl.ch/explore/dataset/10230/">Statistische Amt meldet</a>.'
    expect(textStuecke(absatz)).toEqual([
      { art: 'text', inhalt: 'In Pratteln entstanden 22 Wohnungen, wie das ' },
      {
        art: 'link',
        inhalt: 'Statistische Amt meldet',
        url: 'https://data.bl.ch/explore/dataset/10230/'
      },
      { art: 'text', inhalt: '.' }
    ])
  })

  it('laesst einen Absatz ohne Link unangetastet', () => {
    expect(textStuecke('Ein Satz ohne alles.')).toEqual([{ art: 'text', inhalt: 'Ein Satz ohne alles.' }])
  })

  // Der Sicherheitspunkt: alles ausser der einen erlaubten Form bleibt Text,
  // und weil der Aufrufer nur Daten bekommt, kann nichts als Auszeichnung enden.
  it('macht aus fremden Tags keine Auszeichnung', () => {
    const boese = 'Hallo <script>alert(1)</script> und <a href="javascript:x">klick</a>'
    expect(textStuecke(boese)).toEqual([{ art: 'text', inhalt: boese }])
  })

  it('vertraegt einen leeren Absatz', () => {
    expect(textStuecke('')).toEqual([])
  })
})

describe('berichtenswerteSpiele', () => {
  // Spiegelt redaktion/mannschaft.ts im Backend — der Zaehler im Sport-Reiter
  // muss dieselbe Antwort geben wie der Schreiber, sonst zeigt der Knopf
  // dauerhaft offene Spiele an und meldet beim Druecken „nichts zu tun".
  const spiel = (id: string, wettbewerb: string, vereinId: string, liga: string | null) => ({
    id,
    wettbewerb,
    verein: { id: vereinId, name: 'Verein', liga }
  })

  it('nimmt vom Verein nur die erste Mannschaft', () => {
    const alle = [
      spiel('a', 'Meisterschaft - 2. Liga interregional / Gruppe 3', 'v1', '2. Liga interregional'),
      spiel('b', 'Meisterschaft - 2. Liga (FAEW)', 'v1', '2. Liga interregional'),
      spiel('c', 'Meisterschaft - 5. Liga / Vorrunde / Gruppe 2', 'v1', '2. Liga interregional')
    ]
    const behalten = berichtenswerteSpiele(alle)
    expect([...behalten].map((s) => s.id)).toEqual(['a'])
  })

  // Sm'Aesch Pfeffingen ist eine Damenmannschaft und das Aushaengeschild.
  it('behaelt einen Verein, dessen eigene Mannschaft eine Damenmannschaft ist', () => {
    const alle = [spiel('a', 'Nationalliga A (Damen)', 'v2', 'Nationalliga A (Damen)')]
    expect(berichtenswerteSpiele(alle).size).toBe(1)
  })

  it('kommt ohne Liga-Angabe aus', () => {
    const alle = [
      spiel('a', 'Meisterschaft - 3. Liga / Gruppe 2', 'v3', null),
      spiel('b', 'Meisterschaft - 4. Liga / Gruppe 3', 'v3', null)
    ]
    expect([...berichtenswerteSpiele(alle)].map((s) => s.id)).toEqual(['a'])
  })

  it('vertraegt eine leere Liste', () => {
    expect(berichtenswerteSpiele([]).size).toBe(0)
  })
})

describe('blattJeGemeinde / kalenderJeGemeinde', () => {
  // Ein Blatt deckt mehrere Gemeinden ab; gesucht wird von der Gemeinde aus.
  it('findet das Blatt fuer Haupt- und Nebengemeinde', () => {
    const blatt = {
      id: 'w1',
      gemeinde: { id: 'g-muttenz' },
      abdeckungen: [{ gemeinde: { id: 'g-muttenz' } }, { gemeinde: { id: 'g-pratteln' } }]
    }
    const nach = blattJeGemeinde([blatt])
    expect(nach.get('g-muttenz')).toBe(blatt)
    expect(nach.get('g-pratteln')).toBe(blatt)
    expect(nach.has('g-aesch')).toBe(false)
  })

  it('nimmt den Kalender des gefragten Jahres', () => {
    const alt = { jahr: 2025, gemeinde: { id: 'g1' } }
    const neu = { jahr: 2026, gemeinde: { id: 'g1' } }
    expect(kalenderJeGemeinde([alt, neu], 2026).get('g1')).toBe(neu)
    expect(kalenderJeGemeinde([alt], 2026).has('g1')).toBe(false)
  })
})

// Das Siegel steht nur auf publizierten Karten: vorher ist nichts
// unterschrieben, und ein Chip auf jedem Entwurf waere Raumverbrauch ohne
// Aussage.
describe('pruefsiegelText', () => {
  it('schweigt, solange nichts publiziert ist', () => {
    expect(pruefsiegelText(meldung({ status: 'entwurf' }))).toBeNull()
    expect(pruefsiegelText(meldung({ status: 'freigegeben' }))).toBeNull()
  })

  it('nennt die Redaktorin und die saubere Pruefung', () => {
    expect(pruefsiegelText(meldung({ status: 'publiziert', publiziert_durch: 'redaktion' }))).toBe(
      'publiziert von der Redaktion, keine Warnung'
    )
  })

  it('nennt den Zeitlauf und zaehlt die Warnungen', () => {
    expect(
      pruefsiegelText(
        meldung({
          status: 'publiziert',
          publiziert_durch: 'zeitlauf',
          revision_hinweis: null,
          zeit_warnungen: ['Vorjahr']
        })
      )
    ).toBe('publiziert vom Zeitlauf, 1 Warnung')
    expect(
      pruefsiegelText(
        meldung({
          status: 'publiziert',
          publiziert_durch: 'zeitlauf',
          revision_hinweis: null,
          zeit_warnungen: ['Vorjahr', 'ungepruefte Prozentangabe: 12%']
        })
      )
    ).toBe('publiziert vom Zeitlauf, 2 Warnungen')
  })

  // Altbestand: publiziert, bevor es die Markierung gab.
  it('sagt unbekannt, statt eine Unterschrift zu erfinden', () => {
    expect(pruefsiegelText(meldung({ status: 'publiziert', publiziert_durch: null }))).toBe(
      'publiziert, Unterschrift unbekannt, keine Warnung'
    )
  })
})
