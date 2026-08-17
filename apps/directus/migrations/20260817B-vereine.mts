import type { Knex } from 'knex'

/**
 * The sports clubs a municipality is known for.
 *
 * Match reports need to know *which* club speaks for a place before any result
 * is worth fetching. That is an editorial judgement — "Aushängeschild" versus
 * "Breitensportverein" is how the newsroom itself splits them, and it changes
 * how an article is framed: a Nationalliga result carries regional weight, a
 * village derby carries local weight.
 *
 * Two ways a club gets in, deliberately:
 *
 *   - `quelle = 'manuell'`   an editor entered it. The seed below is this kind.
 *   - `quelle = 'fvnws' | 'swissunihockey'`
 *                            proposed by a connector from the club names the
 *                            source itself publishes, matched against our own
 *                            municipality names without a model — the technique
 *                            `portal-inventur` already uses. Those arrive with
 *                            `zuordnung_geprueft = false` and stay marked as a
 *                            proposal until an editor confirms, exactly like
 *                            `ankuendigungen.zuordnung_geprueft`.
 *
 * `liga` is a SNAPSHOT, not a fact with a long life: placements change every
 * season. For football it will be overwritten from the source once ingestion
 * runs; for the other sports it is what the editor last knew. Nothing should
 * treat it as authoritative for an article without re-reading the source.
 *
 * `notiz` carries the editorial "Bedeutung" paragraph. It belongs in the USER
 * turn of an article prompt, never in the cached system prefix — it is
 * per-municipality, and interpolating it into the prefix would break the
 * byte-identical guarantee that makes the prompt cache work.
 */

const SPORTARTEN = [
  'Fussball',
  'Volleyball',
  'Basketball',
  'Handball',
  'Unihockey',
  'American Football',
  'Schwingen',
  'Curling',
  'Schach',
  'Turnen',
  'Anderer'
]

const BEDEUTUNG = [
  { text: 'Aushängeschild', value: 'aushaengeschild' },
  { text: 'Breitensport', value: 'breitensport' }
]

const QUELLEN = [
  { text: 'Von Hand erfasst', value: 'manuell' },
  { text: 'FVNWS (Fussball)', value: 'fvnws' },
  { text: 'swissunihockey', value: 'swissunihockey' }
]

interface Saat {
  bfs: number
  name: string
  sportart: string
  bedeutung: string
  liga: string | null
  spielort: string | null
  notiz: string
}

// Supplied by the newsroom, one municipality at a time. Kept verbatim rather
// than summarised: the wording is the editor's own judgement about why the club
// matters, and that is the part an article needs.
const SAAT: readonly Saat[] = [
  {
    bfs: 2761,
    name: "Sm'Aesch Pfeffingen",
    sportart: 'Volleyball',
    bedeutung: 'aushaengeschild',
    liga: 'Nationalliga A (Damen)',
    spielort: 'Mehrzweckhalle Löhrenacker, Aesch',
    notiz:
      'Das sportliche Aushängeschild der gesamten Region. Die 1. Mannschaft spielt seit über zwei Jahrzehnten durchgehend in der Nationalliga A. Mehrfacher Schweizer Vize-Meister, Cup-Finalist und Supercup-Sieger sowie regelmässiger Teilnehmer an europäischen Wettbewerben. Der Verein traegt Aesch und Pfeffingen im Namen; das Sportareal Löhrenacker liegt in Aesch.'
  },
  {
    bfs: 2761,
    name: 'FC Aesch',
    sportart: 'Fussball',
    bedeutung: 'breitensport',
    liga: '2. und 3. Liga',
    spielort: 'Sportplatz Löhrenacker, Aesch',
    notiz:
      'Der grösste Fussballclub des Ortes stellt Teams in der 2. und 3. Liga sowie eine sehr starke Nachwuchsabteilung. Ausrichter bekannter regionaler Jugendturniere.'
  },
  {
    bfs: 2763,
    name: 'BC Arlesheim',
    sportart: 'Basketball',
    bedeutung: 'aushaengeschild',
    liga: 'Damen 1: Nationalliga B — Herren 1: 1. Liga National',
    spielort: 'Sporthalle Hagenbuchen, Arlesheim',
    notiz:
      'Der 1976 gegründete BCA ist einer der grössten und erfolgreichsten Basketballvereine der Nordwestschweiz mit über 20 Teams im Spielbetrieb. Bei Spieltagen ist das Publikumsinteresse im regionalen Vergleich sehr hoch.'
  },
  {
    bfs: 2763,
    name: 'Curlingzentrum Region Basel',
    sportart: 'Curling',
    bedeutung: 'aushaengeschild',
    liga: null,
    spielort: 'Schwimmbadweg, Arlesheim',
    notiz:
      'Arlesheim ist das Zentrum für Curlingsport in der Region Basel. Die Anlage ist Heimstätte mehrerer Curlingclubs und Austragungsort regionaler wie nationaler Turniere. ACHTUNG: Dies ist eine Anlage, kein Verein — fuer Resultate muss der einzelne Curlingclub erfasst werden.'
  },
  {
    bfs: 2763,
    name: 'FC Arlesheim',
    sportart: 'Fussball',
    bedeutung: 'breitensport',
    liga: '3. und 4. Liga',
    spielort: 'Sportanlage In den Widen, Arlesheim',
    notiz:
      'Der FCA bildet das fussballerische Rückgrat des Dorfes mit einer breiten Juniorenabteilung sowie mehreren Herren- und Frauenteams.'
  },
  {
    bfs: 2769,
    name: 'FC Münchenstein',
    sportart: 'Fussball',
    bedeutung: 'breitensport',
    liga: null,
    spielort: 'Sportplatz Au, Münchenstein',
    notiz:
      'Gegründet 1920 (FCM 1920), der grösste und traditionsreichste lokale Fussballclub der Gemeinde. Mit über 200 Junioren und mehreren Aktiv- und Seniorenteams sorgt der Verein bei Lokalderbys und Nachwuchsturnieren für das grösste lokale Zuschauerinteresse.'
  },
  {
    bfs: 2831,
    name: 'TV Pratteln NS',
    sportart: 'Handball',
    bedeutung: 'aushaengeschild',
    liga: '1. Liga (Herren)',
    spielort: null,
    notiz:
      'Das unangefochtene Aushängeschild im lokalen Hallensport. Die «Neue Sektion» blickt auf eine lange Tradition zurück und betreibt eine der grössten Handball-Nachwuchsabteilungen der Nordwestschweiz.'
  },
  {
    bfs: 2831,
    name: 'Gladiators beider Basel',
    sportart: 'American Football',
    bedeutung: 'aushaengeschild',
    liga: 'Nationalliga A',
    spielort: null,
    notiz:
      'Der Verein ist in Pratteln verankert und vertritt die Region Basel in der höchsten Schweizer Football-Klasse.'
  },
  {
    bfs: 2831,
    name: 'Schwingklub Pratteln',
    sportart: 'Schwingen',
    bedeutung: 'aushaengeschild',
    liga: null,
    spielort: null,
    notiz:
      'Als Austragungsort des ESAF 2022 (Eidgenössisches Schwing- und Älplerfest) schrieb Pratteln Schweizer Sportgeschichte. Der lokale Schwingklub geniesst seither enormen Zulauf und hohes Ansehen in der Region.'
  },
  {
    bfs: 2831,
    name: 'FC Pratteln',
    sportart: 'Fussball',
    bedeutung: 'breitensport',
    liga: '2. Liga',
    spielort: 'Sportanlage In den Sandgruben, Pratteln',
    notiz:
      'Der 1929 gegründete Dorfclub stellt zahlreiche Aktiv- und Juniorenteams. Highlight der Vereinsgeschichte bleibt ein 4:0-Cupsieg gegen den FC Basel im Jahr 1990.'
  },
  {
    bfs: 2703,
    name: 'VBC Riehen',
    sportart: 'Volleyball',
    bedeutung: 'aushaengeschild',
    liga: 'Nationalliga B bzw. 1. Liga (Damen) — zu bestaetigen',
    spielort: 'Sporthalle Niederholz, Riehen',
    notiz:
      'Das sportliche Aushängeschild der Gemeinde im Ballsport. Die Damen 1 ziehen bei ihren Heimspielen das grösste Hallensport-Publikum in Riehen an.'
  },
  {
    bfs: 2703,
    name: 'SG Riehen',
    sportart: 'Schach',
    bedeutung: 'aushaengeschild',
    liga: 'Nationalliga A',
    spielort: null,
    notiz:
      'Schweizer Spitzensport im Denksport: Riehen stellt eines der stärksten Schachteams des Landes. Mehrfacher Schweizer Meister und regelmässiger Teilnehmer am europäischen Club-Cup.'
  },
  {
    bfs: 2703,
    name: 'FC Amicitia Riehen',
    sportart: 'Fussball',
    bedeutung: 'breitensport',
    liga: null,
    spielort: 'Sportplatz Grendelmatte, Riehen',
    notiz:
      'Der grösste Fussballverein der Gemeinde. Mit zahlreichen Junioren-, Herren- und Frauenteams bildet er das sportliche und soziale Rückgrat des lokalen Amateursports.'
  }
]

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('vereine', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.string('name', 160).notNullable()
    // RESTRICT for the same reason as `meldungen.gemeinde`: municipalities are
    // seeded reference data, and a club without a place is meaningless.
    table
      .uuid('gemeinde')
      .notNullable()
      .references('id')
      .inTable('gemeinden')
      .onDelete('RESTRICT')
    table.string('sportart', 40).notNullable()
    table.string('bedeutung', 20).notNullable().defaultTo('breitensport')
    table.string('liga', 120)
    table.string('spielort', 160)
    table.text('notiz')
    table.string('quelle', 20).notNullable().defaultTo('manuell')
    // Identifies the club at its source (Match-Center team id, swissunihockey
    // club_id). Null while nothing has been matched yet.
    table.string('externe_id', 60)
    table.string('ergebnis_url', 500)
    table.boolean('zuordnung_geprueft').notNullable().defaultTo(false)
    table.boolean('aktiv').notNullable().defaultTo(true)
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })

    // One club appears once per municipality. This is also what makes the seed
    // re-runnable and what stops a connector proposing a duplicate of a club an
    // editor already entered by hand.
    table.unique(['gemeinde', 'name'])
  })

  await knex('directus_collections').insert({
    collection: 'vereine',
    icon: 'sports_soccer',
    note: 'Sportvereine der Gemeinden. "Aushaengeschild" oder "Breitensport" steuert, wie stark eine Meldung gewichtet wird.',
    display_template: '{{ name }} ({{ sportart }})',
    sort_field: 'name',
    archive_field: null,
    archive_value: null,
    unarchive_value: null,
    archive_app_filter: true,
    accountability: 'all',
    singleton: false,
    hidden: false,
    collapse: 'open',
    versioning: false
  })

  await knex('directus_relations').insert([
    {
      many_collection: 'vereine',
      many_field: 'gemeinde',
      one_collection: 'gemeinden',
      one_field: null,
      one_collection_field: null,
      one_allowed_collections: null,
      junction_field: null,
      sort_field: null,
      one_deselect_action: 'nullify'
    }
  ])

  await knex('directus_fields').insert([
    {
      collection: 'vereine',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'vereine',
      field: 'name',
      interface: 'input',
      required: true,
      sort: 2,
      width: 'half'
    },
    {
      collection: 'vereine',
      field: 'gemeinde',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ name }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ name }}' }),
      required: true,
      sort: 3,
      width: 'half'
    },
    {
      collection: 'vereine',
      field: 'sportart',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: SPORTARTEN.map((sportart) => ({
          text: sportart,
          value: sportart
        }))
      }),
      display: 'labels',
      required: true,
      sort: 4,
      width: 'half'
    },
    {
      collection: 'vereine',
      field: 'bedeutung',
      interface: 'select-dropdown',
      options: JSON.stringify({ choices: BEDEUTUNG }),
      display: 'labels',
      note: 'Aushaengeschild = ueberregionale Ausstrahlung. Breitensport = das Dorf selbst.',
      required: true,
      sort: 5,
      width: 'half'
    },
    {
      collection: 'vereine',
      field: 'liga',
      interface: 'input',
      note: 'Momentaufnahme — Ligazugehoerigkeit aendert jede Saison und wird fuer Fussball aus der Quelle nachgefuehrt.',
      sort: 6,
      width: 'half'
    },
    {
      collection: 'vereine',
      field: 'spielort',
      interface: 'input',
      sort: 7,
      width: 'half'
    },
    {
      collection: 'vereine',
      field: 'notiz',
      interface: 'input-multiline',
      note: 'Warum der Verein fuer die Gemeinde zaehlt. Fliesst als Kontext in die Meldung ein.',
      sort: 8,
      width: 'full'
    },
    {
      collection: 'vereine',
      field: 'quelle',
      interface: 'select-dropdown',
      options: JSON.stringify({ choices: QUELLEN }),
      display: 'labels',
      required: true,
      sort: 9,
      width: 'half'
    },
    {
      collection: 'vereine',
      field: 'externe_id',
      interface: 'input',
      note: 'Kennung des Vereins bei der Quelle. Leer, solange nichts zugeordnet ist.',
      sort: 10,
      width: 'half'
    },
    {
      collection: 'vereine',
      field: 'ergebnis_url',
      interface: 'input',
      note: 'Seite mit den Resultaten — noetig fuer Sportarten ohne zentrale Quelle.',
      sort: 11,
      width: 'full'
    },
    {
      collection: 'vereine',
      field: 'zuordnung_geprueft',
      interface: 'boolean',
      options: JSON.stringify({ label: 'Zuordnung bestaetigt' }),
      display: 'boolean',
      note: 'Solange nicht gesetzt, ist der Verein ein Vorschlag der Quelle.',
      sort: 12,
      width: 'half'
    },
    {
      collection: 'vereine',
      field: 'aktiv',
      interface: 'boolean',
      options: JSON.stringify({ label: 'Wird bespielt' }),
      display: 'boolean',
      sort: 13,
      width: 'half'
    },
    {
      collection: 'vereine',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 14,
      width: 'half'
    },
    {
      collection: 'vereine',
      field: 'date_updated',
      special: 'date-updated',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 15,
      width: 'half'
    }
  ])

  const gemeinden = (await knex('gemeinden').select(
    'id',
    'bfs_nummer'
  )) as ReadonlyArray<{
    id: string
    bfs_nummer: number
  }>
  const nachBfs = new Map(
    gemeinden.map((gemeinde) => [gemeinde.bfs_nummer, gemeinde.id])
  )

  const zeilen = SAAT.map((verein) => {
    const gemeindeId = nachBfs.get(verein.bfs)
    if (gemeindeId === undefined) {
      throw new Error(
        `No municipality with BFS number ${verein.bfs} for club ${verein.name}`
      )
    }
    return {
      name: verein.name,
      gemeinde: gemeindeId,
      sportart: verein.sportart,
      bedeutung: verein.bedeutung,
      liga: verein.liga,
      spielort: verein.spielort,
      notiz: verein.notiz,
      quelle: 'manuell',
      // Entered by a person from the newsroom's own list, so the link between
      // club and municipality is confirmed by construction.
      zuordnung_geprueft: true,
      aktiv: true
    }
  })

  await knex('vereine').insert(zeilen).onConflict(['gemeinde', 'name']).ignore()
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_relations')
    .where({ many_collection: 'vereine' })
    .delete()
  await knex('directus_fields').where({ collection: 'vereine' }).delete()
  await knex('directus_collections').where({ collection: 'vereine' }).delete()
  await knex.schema.dropTableIfExists('vereine')
}
