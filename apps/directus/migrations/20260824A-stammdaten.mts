import type { Knex } from 'knex'

/**
 * Reference data, and the constraints Directus does not manage.
 *
 * The data model itself lives in ../schema (directus-sync) and reaches every
 * database through `schema:load` — never through a migration. This file holds
 * exactly the two things that mechanism cannot carry:
 *
 * 1. **Row data a fresh install needs without a human clicking.** The
 *    municipalities the newsroom can write about (all 86 of Basel-Landschaft
 *    plus Riehen, keyed by BFS number because dataset labels are unreliable —
 *    six arrive as "Aesch (BL)"), the three watched sources, and the clubs the
 *    newsroom registered, with the editor's reasoning kept in `notiz`.
 * 2. **Indexes and constraints the schema snapshot cannot express.** Composite
 *    uniques, the two partial unique indexes on `meldungen` (one article per
 *    run and municipality, one per match — each kind ignoring the other's
 *    NULLs), the composite index for the Sportresultate tab, and the CHECK
 *    that a chat message points at a run or a Meldung but never both.
 *    Single-column uniques and indexes live in the snapshot (`is_unique`,
 *    `is_indexed`) and are deliberately absent here.
 *
 * Everything is idempotent (ON CONFLICT DO NOTHING, IF NOT EXISTS, guarded
 * ADD CONSTRAINT): on a database built by the pre-schema-sync migrations this
 * is a no-op; on a fresh database it runs after `schema:load` has built the
 * tables — docker/entrypoint.sh runs migrations after the schema push, which
 * is why a migration here may assume the model but never create it.
 *
 * Seeds are insert-only. An editor flips `gemeinden.aktiv`, corrects a club's
 * `liga` or adds new clubs in the workspace; re-running this migration (or a
 * redeploy) must never undo that, so existing rows are left untouched.
 */

const QUELLEN: ReadonlyArray<{
  name: string
  typ: string
  basis_url: string
  konfiguration: null
  aktiv: boolean
}> = [
  {
    name: 'Statistik Basel-Landschaft (data.bl.ch)',
    typ: 'ods',
    basis_url: 'https://data.bl.ch',
    konfiguration: null,
    aktiv: true
  },
  {
    name: 'Publikationsagenda Statistik BL',
    typ: 'agenda',
    basis_url:
      'https://www.baselland.ch/politik-und-behorden/direktionen/finanz-und-kirchendirektion/daten-statistik/abteilung-statistik/agenda-2026/',
    konfiguration: null,
    aktiv: true
  },
  {
    name: 'Statistik BL — Tabellen',
    typ: 'statbl',
    basis_url: 'https://statistik.bl.ch/web_portal/',
    konfiguration: null,
    aktiv: true
  }
]

const GEMEINDEN: ReadonlyArray<{
  bfs_nummer: number
  name: string
  bezirk: string
  aktiv: boolean
}> = [
  { bfs_nummer: 2703, name: 'Riehen', bezirk: 'Basel-Stadt', aktiv: false },
  { bfs_nummer: 2761, name: 'Aesch', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2762, name: 'Allschwil', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2763, name: 'Arlesheim', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2764, name: 'Biel-Benken', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2765, name: 'Binningen', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2766, name: 'Birsfelden', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2767, name: 'Bottmingen', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2768, name: 'Ettingen', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2769, name: 'Münchenstein', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2770, name: 'Muttenz', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2771, name: 'Oberwil', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2772, name: 'Pfeffingen', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2773, name: 'Reinach', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2774, name: 'Schönenbuch', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2775, name: 'Therwil', bezirk: 'Arlesheim', aktiv: false },
  { bfs_nummer: 2781, name: 'Blauen', bezirk: 'Laufen', aktiv: false },
  { bfs_nummer: 2782, name: 'Brislach', bezirk: 'Laufen', aktiv: false },
  {
    bfs_nummer: 2783,
    name: 'Burg im Leimental',
    bezirk: 'Laufen',
    aktiv: false
  },
  { bfs_nummer: 2784, name: 'Dittingen', bezirk: 'Laufen', aktiv: false },
  { bfs_nummer: 2785, name: 'Duggingen', bezirk: 'Laufen', aktiv: false },
  { bfs_nummer: 2786, name: 'Grellingen', bezirk: 'Laufen', aktiv: false },
  { bfs_nummer: 2787, name: 'Laufen', bezirk: 'Laufen', aktiv: false },
  { bfs_nummer: 2788, name: 'Liesberg', bezirk: 'Laufen', aktiv: false },
  { bfs_nummer: 2789, name: 'Nenzlingen', bezirk: 'Laufen', aktiv: false },
  { bfs_nummer: 2790, name: 'Roggenburg', bezirk: 'Laufen', aktiv: false },
  { bfs_nummer: 2791, name: 'Röschenz', bezirk: 'Laufen', aktiv: false },
  { bfs_nummer: 2792, name: 'Wahlen', bezirk: 'Laufen', aktiv: false },
  { bfs_nummer: 2793, name: 'Zwingen', bezirk: 'Laufen', aktiv: false },
  { bfs_nummer: 2821, name: 'Arisdorf', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2822, name: 'Augst', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2823, name: 'Bubendorf', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2824, name: 'Frenkendorf', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2825, name: 'Füllinsdorf', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2826, name: 'Giebenach', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2827, name: 'Hersberg', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2828, name: 'Lausen', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2829, name: 'Liestal', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2830, name: 'Lupsingen', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2831, name: 'Pratteln', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2832, name: 'Ramlinsburg', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2833, name: 'Seltisberg', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2834, name: 'Ziefen', bezirk: 'Liestal', aktiv: false },
  { bfs_nummer: 2841, name: 'Anwil', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2842, name: 'Böckten', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2843, name: 'Buckten', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2844, name: 'Buus', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2845, name: 'Diepflingen', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2846, name: 'Gelterkinden', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2847, name: 'Häfelfingen', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2848, name: 'Hemmiken', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2849, name: 'Itingen', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2850, name: 'Känerkinden', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2851, name: 'Kilchberg', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2852, name: 'Läufelfingen', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2853, name: 'Maisprach', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2854, name: 'Nusshof', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2855, name: 'Oltingen', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2856, name: 'Ormalingen', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2857, name: 'Rickenbach', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2858, name: 'Rothenfluh', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2859, name: 'Rümlingen', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2860, name: 'Rünenberg', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2861, name: 'Sissach', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2862, name: 'Tecknau', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2863, name: 'Tenniken', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2864, name: 'Thürnen', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2865, name: 'Wenslingen', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2866, name: 'Wintersingen', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2867, name: 'Wittinsburg', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2868, name: 'Zeglingen', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2869, name: 'Zunzgen', bezirk: 'Sissach', aktiv: false },
  { bfs_nummer: 2881, name: 'Arboldswil', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2882, name: 'Bennwil', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2883, name: 'Bretzwil', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2884, name: 'Diegten', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2885, name: 'Eptingen', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2886, name: 'Hölstein', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2887, name: 'Lampenberg', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2888, name: 'Langenbruck', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2889, name: 'Lauwil', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2890, name: 'Liedertswil', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2891, name: 'Niederdorf', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2892, name: 'Oberdorf', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2893, name: 'Reigoldswil', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2894, name: 'Titterten', bezirk: 'Waldenburg', aktiv: false },
  { bfs_nummer: 2895, name: 'Waldenburg', bezirk: 'Waldenburg', aktiv: false }
]

const VEREINE: ReadonlyArray<{
  bfs_nummer: number
  name: string
  sportart: string
  bedeutung: string
  liga: string | null
  spielort: string | null
  notiz: string
  quelle: string
  externe_id: string | null
  ergebnis_url: string | null
  zuordnung_geprueft: boolean
  aktiv: boolean
}> = [
  {
    bfs_nummer: 2703,
    name: 'FC Amicitia Riehen',
    sportart: 'Fussball',
    bedeutung: 'breitensport',
    liga: null,
    spielort: 'Sportplatz Grendelmatte, Riehen',
    notiz:
      'Der grösste Fussballverein der Gemeinde. Mit zahlreichen Junioren-, Herren- und Frauenteams bildet er das sportliche und soziale Rückgrat des lokalen Amateursports.',
    quelle: 'fvnws',
    externe_id: '478',
    ergebnis_url: 'https://matchcenter.fvnws.ch/default.aspx?oid=8&lng=1&v=478',
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2703,
    name: 'SG Riehen',
    sportart: 'Schach',
    bedeutung: 'aushaengeschild',
    liga: 'Nationalliga A',
    spielort: null,
    notiz:
      'Schweizer Spitzensport im Denksport: Riehen stellt eines der stärksten Schachteams des Landes. Mehrfacher Schweizer Meister und regelmässiger Teilnehmer am europäischen Club-Cup.',
    quelle: 'manuell',
    externe_id: null,
    ergebnis_url: null,
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2703,
    name: 'VBC Riehen',
    sportart: 'Volleyball',
    bedeutung: 'aushaengeschild',
    liga: null,
    spielort: 'Sporthalle Niederholz, Riehen',
    notiz:
      'Das sportliche Aushängeschild der Gemeinde im Ballsport. Beruecksichtigt wird die Herrenmannschaft in der Nationalliga A; die Damen spielen in der 1. Liga. Heimspiele in der Sporthalle Niederholz.',
    quelle: 'manuell',
    externe_id: null,
    ergebnis_url: null,
    zuordnung_geprueft: true,
    aktiv: false
  },
  {
    bfs_nummer: 2761,
    name: 'FC Aesch',
    sportart: 'Fussball',
    bedeutung: 'breitensport',
    liga: '2. und 3. Liga',
    spielort: 'Sportplatz Löhrenacker, Aesch',
    notiz:
      'Der grösste Fussballclub des Ortes stellt Teams in der 2. und 3. Liga sowie eine sehr starke Nachwuchsabteilung. Ausrichter bekannter regionaler Jugendturniere.',
    quelle: 'fvnws',
    externe_id: '482',
    ergebnis_url: 'https://matchcenter.fvnws.ch/default.aspx?oid=8&lng=1&v=482',
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2761,
    name: "Sm'Aesch Pfeffingen",
    sportart: 'Volleyball',
    bedeutung: 'aushaengeschild',
    liga: 'Nationalliga A (Damen)',
    spielort: 'Mehrzweckhalle Löhrenacker, Aesch',
    notiz:
      'Das sportliche Aushängeschild der gesamten Region. Die 1. Mannschaft spielt seit über zwei Jahrzehnten durchgehend in der Nationalliga A. Mehrfacher Schweizer Vize-Meister, Cup-Finalist und Supercup-Sieger sowie regelmässiger Teilnehmer an europäischen Wettbewerben. Der Verein traegt Aesch und Pfeffingen im Namen; das Sportareal Löhrenacker liegt in Aesch.',
    quelle: 'swissvolley',
    externe_id: '909660/98',
    ergebnis_url:
      'https://www.volleyball.ch/de/game-center/club/909660/team/98',
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2763,
    name: 'BC Arlesheim',
    sportart: 'Basketball',
    bedeutung: 'aushaengeschild',
    liga: 'Damen 1: Nationalliga B — Herren 1: 1. Liga National',
    spielort: 'Sporthalle Hagenbuchen, Arlesheim',
    notiz:
      'Der 1976 gegründete BCA ist einer der grössten und erfolgreichsten Basketballvereine der Nordwestschweiz mit über 20 Teams im Spielbetrieb. Bei Spieltagen ist das Publikumsinteresse im regionalen Vergleich sehr hoch.',
    quelle: 'manuell',
    externe_id: null,
    ergebnis_url: null,
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2763,
    name: 'Curlingzentrum Region Basel',
    sportart: 'Curling',
    bedeutung: 'aushaengeschild',
    liga: null,
    spielort: 'Schwimmbadweg, Arlesheim',
    notiz:
      'Arlesheim ist das Zentrum für Curlingsport in der Region Basel. Die Anlage ist Heimstätte mehrerer Curlingclubs und Austragungsort regionaler wie nationaler Turniere. ACHTUNG: Dies ist eine Anlage, kein Verein — fuer Resultate muss der einzelne Curlingclub erfasst werden.',
    quelle: 'manuell',
    externe_id: null,
    ergebnis_url: null,
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2763,
    name: 'FC Arlesheim',
    sportart: 'Fussball',
    bedeutung: 'breitensport',
    liga: '3. und 4. Liga',
    spielort: 'Sportanlage In den Widen, Arlesheim',
    notiz:
      'Der FCA bildet das fussballerische Rückgrat des Dorfes mit einer breiten Juniorenabteilung sowie mehreren Herren- und Frauenteams.',
    quelle: 'fvnws',
    externe_id: '484',
    ergebnis_url: 'https://matchcenter.fvnws.ch/default.aspx?oid=8&lng=1&v=484',
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2765,
    name: 'Handball Blau Boys Binningen',
    sportart: 'Handball',
    bedeutung: 'aushaengeschild',
    liga: '1. Liga',
    spielort: 'Spiegelfeld-Halle, Binningen',
    notiz:
      'Das Aushängeschild im lokalen Hallensport. Die «Blau Boys» ziehen bei ihren Heimspielen in der Spiegelfeld-Halle das engagierteste Hallensport-Publikum an.',
    quelle: 'handball',
    externe_id: '41538',
    ergebnis_url: 'https://www.handball.ch/de/matchcenter/teams/41538#/games',
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2765,
    name: 'SC Binningen',
    sportart: 'Fussball',
    bedeutung: 'aushaengeschild',
    liga: '2. Liga interregional',
    spielort: 'Sportplatz Spiegelfeld, Binningen',
    notiz:
      'Der 1920 gegründete SCB ist der grösste und zuschauerstärkste Sportverein des Ortes. Die 1. Mannschaft spielt in der überregionalen 2. Liga interregional. Mit einer riesigen Juniorenabteilung sorgt der Club bei Heimspielen und Derbys für die grösste Kulisse in der Gemeinde.',
    quelle: 'fvnws',
    externe_id: '487',
    ergebnis_url: 'https://matchcenter.fvnws.ch/default.aspx?oid=8&lng=1&v=487',
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2767,
    name: 'Schwimmclub Bottmingen-Oberwil',
    sportart: 'Schwimmen',
    bedeutung: 'aushaengeschild',
    liga: null,
    spielort: 'Hallenbad und Gartenbad beim Schloss Bottmingen',
    notiz:
      'Der SBO ist das sportliche Aushängeschild der Gemeinde mit hoher regionaler Präsenz. Der Club vertritt die Region erfolgreich an nationalen und regionalen Schwimm-Meetings. Traegt Bottmingen und Oberwil im Namen; gefuehrt wird er hier unter Bottmingen.',
    quelle: 'manuell',
    externe_id: null,
    ergebnis_url: null,
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2769,
    name: 'FC Münchenstein',
    sportart: 'Fussball',
    bedeutung: 'breitensport',
    liga: null,
    spielort: 'Sportplatz Au, Münchenstein',
    notiz:
      'Gegründet 1920 (FCM 1920), der grösste und traditionsreichste lokale Fussballclub der Gemeinde. Mit über 200 Junioren und mehreren Aktiv- und Seniorenteams sorgt der Verein bei Lokalderbys und Nachwuchsturnieren für das grösste lokale Zuschauerinteresse.',
    quelle: 'fvnws',
    externe_id: '497',
    ergebnis_url: 'https://matchcenter.fvnws.ch/default.aspx?oid=8&lng=1&v=497',
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2831,
    name: 'FC Pratteln',
    sportart: 'Fussball',
    bedeutung: 'breitensport',
    liga: '2. Liga',
    spielort: 'Sportanlage In den Sandgruben, Pratteln',
    notiz:
      'Der 1929 gegründete Dorfclub stellt zahlreiche Aktiv- und Juniorenteams. Highlight der Vereinsgeschichte bleibt ein 4:0-Cupsieg gegen den FC Basel im Jahr 1990.',
    quelle: 'fvnws',
    externe_id: '501',
    ergebnis_url: 'https://matchcenter.fvnws.ch/default.aspx?oid=8&lng=1&v=501',
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2831,
    name: 'Gladiators beider Basel',
    sportart: 'American Football',
    bedeutung: 'aushaengeschild',
    liga: 'Nationalliga A',
    spielort: null,
    notiz:
      'Der Verein ist in Pratteln verankert und vertritt die Region Basel in der höchsten Schweizer Football-Klasse.',
    quelle: 'manuell',
    externe_id: null,
    ergebnis_url: null,
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2831,
    name: 'Schwingklub Pratteln',
    sportart: 'Schwingen',
    bedeutung: 'aushaengeschild',
    liga: null,
    spielort: null,
    notiz:
      'Als Austragungsort des ESAF 2022 (Eidgenössisches Schwing- und Älplerfest) schrieb Pratteln Schweizer Sportgeschichte. Der lokale Schwingklub geniesst seither enormen Zulauf und hohes Ansehen in der Region.',
    quelle: 'manuell',
    externe_id: null,
    ergebnis_url: null,
    zuordnung_geprueft: true,
    aktiv: true
  },
  {
    bfs_nummer: 2831,
    name: 'TV Pratteln NS',
    sportart: 'Handball',
    bedeutung: 'aushaengeschild',
    liga: '1. Liga (Herren)',
    spielort: null,
    notiz:
      'Das unangefochtene Aushängeschild im lokalen Hallensport. Die «Neue Sektion» blickt auf eine lange Tradition zurück und betreibt eine der grössten Handball-Nachwuchsabteilungen der Nordwestschweiz.',
    quelle: 'handball',
    externe_id: '41131',
    ergebnis_url: 'https://www.handball.ch/de/matchcenter/teams/41131#/games',
    zuordnung_geprueft: true,
    aktiv: true
  }
]

// Index names match what knex's .unique()/.index() generated in the original
// migrations, so IF NOT EXISTS recognises them on an already-migrated database.
const INDEXE: ReadonlyArray<string> = [
  'CREATE UNIQUE INDEX IF NOT EXISTS datensaetze_quelle_externe_id_unique ON datensaetze (quelle, externe_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS laeufe_datensatz_periode_unique ON laeufe (datensatz, periode)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ankuendigungen_quelle_schluessel_unique ON ankuendigungen (quelle, schluessel)',
  'CREATE UNIQUE INDEX IF NOT EXISTS vereine_gemeinde_name_unique ON vereine (gemeinde, name)',
  'CREATE INDEX IF NOT EXISTS spiele_gemeinde_sportart_index ON spiele (gemeinde, sportart)',
  // Partial uniques: one article per run and municipality, one per match —
  // each kind of Meldung keeps its own uniqueness without the other's NULLs.
  'CREATE UNIQUE INDEX IF NOT EXISTS meldungen_lauf_gemeinde_uniq ON meldungen (lauf, gemeinde) WHERE lauf IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS meldungen_spiel_uniq ON meldungen (spiel) WHERE spiel IS NOT NULL'
]

export async function up(knex: Knex): Promise<void> {
  for (const anweisung of INDEXE) {
    await knex.raw(anweisung)
  }

  // ADD CONSTRAINT has no IF NOT EXISTS, so guard via the catalogue.
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chat_nachrichten_genau_ein_bezug'
      ) THEN
        ALTER TABLE chat_nachrichten
        ADD CONSTRAINT chat_nachrichten_genau_ein_bezug
        CHECK ((lauf IS NOT NULL) <> (meldung IS NOT NULL));
      END IF;
    END
    $$
  `)

  await knex('gemeinden').insert(GEMEINDEN).onConflict('bfs_nummer').ignore()

  // `quellen` has no natural unique column, so guard by `typ` — one source row
  // per adapter is the invariant the connectors dispatch on.
  const vorhandeneTypen: string[] = await knex('quellen')
    .whereIn(
      'typ',
      QUELLEN.map((quelle) => quelle.typ)
    )
    .pluck('typ')
  const fehlende = QUELLEN.filter(
    (quelle) => !vorhandeneTypen.includes(quelle.typ)
  )
  if (fehlende.length > 0) {
    await knex('quellen').insert(fehlende)
  }

  const gemeinden: Array<{ id: string; bfs_nummer: number }> = await knex(
    'gemeinden'
  ).select('id', 'bfs_nummer')
  const nachNummer = new Map(
    gemeinden.map((gemeinde) => [gemeinde.bfs_nummer, gemeinde.id])
  )
  const vereinsZeilen = VEREINE.map(({ bfs_nummer, ...verein }) => {
    const gemeinde = nachNummer.get(bfs_nummer)
    if (!gemeinde)
      throw new Error(`Gemeinde mit BFS-Nummer ${bfs_nummer} fehlt`)
    return { ...verein, gemeinde }
  })
  await knex('vereine')
    .insert(vereinsZeilen)
    .onConflict(['gemeinde', 'name'])
    .ignore()
}

export async function down(knex: Knex): Promise<void> {
  // Remove only what up() seeded, by natural key — rows an editor added stay.
  const gemeinden: Array<{ id: string; bfs_nummer: number }> = await knex(
    'gemeinden'
  ).select('id', 'bfs_nummer')
  const nachNummer = new Map(
    gemeinden.map((gemeinde) => [gemeinde.bfs_nummer, gemeinde.id])
  )
  for (const verein of VEREINE) {
    const gemeinde = nachNummer.get(verein.bfs_nummer)
    if (gemeinde) {
      await knex('vereine').where({ gemeinde, name: verein.name }).delete()
    }
  }
  await knex('quellen')
    .whereIn(
      'typ',
      QUELLEN.map((quelle) => quelle.typ)
    )
    .delete()
  await knex('gemeinden')
    .whereIn(
      'bfs_nummer',
      GEMEINDEN.map((gemeinde) => gemeinde.bfs_nummer)
    )
    .delete()

  await knex.raw(
    'ALTER TABLE chat_nachrichten DROP CONSTRAINT IF EXISTS chat_nachrichten_genau_ein_bezug'
  )
  await knex.raw('DROP INDEX IF EXISTS meldungen_spiel_uniq')
  await knex.raw('DROP INDEX IF EXISTS meldungen_lauf_gemeinde_uniq')
  await knex.raw('DROP INDEX IF EXISTS spiele_gemeinde_sportart_index')
  // On a database migrated before schema sync these uniques exist as
  // constraints (knex .unique()), on a fresh one as plain indexes from up() —
  // drop whichever form is present.
  await knex.raw(
    'ALTER TABLE vereine DROP CONSTRAINT IF EXISTS vereine_gemeinde_name_unique'
  )
  await knex.raw('DROP INDEX IF EXISTS vereine_gemeinde_name_unique')
  await knex.raw(
    'ALTER TABLE ankuendigungen DROP CONSTRAINT IF EXISTS ankuendigungen_quelle_schluessel_unique'
  )
  await knex.raw('DROP INDEX IF EXISTS ankuendigungen_quelle_schluessel_unique')
  await knex.raw(
    'ALTER TABLE laeufe DROP CONSTRAINT IF EXISTS laeufe_datensatz_periode_unique'
  )
  await knex.raw('DROP INDEX IF EXISTS laeufe_datensatz_periode_unique')
  await knex.raw(
    'ALTER TABLE datensaetze DROP CONSTRAINT IF EXISTS datensaetze_quelle_externe_id_unique'
  )
  await knex.raw('DROP INDEX IF EXISTS datensaetze_quelle_externe_id_unique')
}
