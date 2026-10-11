import type { Knex } from 'knex'

/**
 * The Verkehr desk, 11 October 2026 — rows and indexes only. The two
 * collections themselves (`radarstandorte`, `geschwindigkeitskontrollen`) and
 * the two origin fields on `meldungen` live in `schema/`, as every collection
 * does.
 *
 * Two things the schema sync does not carry:
 *
 * - The composite identity of a month of speed controls, `(gemeinde, jahr,
 *   monat)`: a re-upload of a month must land on its row, not beside it. The
 *   radar locations need none — their `schluessel` is unique on its own.
 *
 * - The two SOURCE rows, both on doors this house already uses. The canton's
 *   radar locations come through the Plone data door (`bl-api.webcloud7.ch`,
 *   the Kanton desk's), the public page is what an article links. Reinach's
 *   monthly sheets sit on the municipality's own site, which the
 *   Gemeindeseiten desk reads daily. Seeded ACTIVE, because the newsroom
 *   asked for both on 11 October 2026; the switch stays in the admin UI.
 */

const INDIZES: ReadonlyArray<string> = [
  'CREATE UNIQUE INDEX IF NOT EXISTS geschwindigkeitskontrollen_monat_uniq ON geschwindigkeitskontrollen (gemeinde, jahr, monat)'
]

const QUELLEN = [
  {
    name: 'Polizei Basel-Landschaft — Standorte Radaranlagen',
    typ: 'radar_bl',
    basis_url:
      'https://bl-api.webcloud7.ch/politik-und-behorden/direktionen/sicherheitsdirektion/polizei/standorte-radaranlagen',
    konfiguration: JSON.stringify({
      seite:
        'https://www.baselland.ch/politik-und-behorden/direktionen/sicherheitsdirektion/polizei/standorte-radaranlagen'
    }),
    aktiv: true
  },
  {
    name: 'Gemeindepolizei Reinach — Geschwindigkeitskontrollen',
    typ: 'geschwindigkeitskontrollen',
    basis_url:
      'https://www.reinach-bl.ch/de/aktuell/news/meldungen-projekte/mobilitaet/Geschwindigkeitskontrollen.php',
    konfiguration: JSON.stringify({
      gemeinde_bfs: 2773,
      polizei: 'Gemeindepolizei Reinach'
    }),
    aktiv: true
  }
]

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('geschwindigkeitskontrollen')) {
    for (const anweisung of INDIZES) await knex.raw(anweisung)
  }

  if (!(await knex.schema.hasTable('quellen'))) return
  for (const quelle of QUELLEN) {
    const vorhanden = await knex('quellen')
      .where({ typ: quelle.typ })
      .first('id')
    if (vorhanden === undefined) {
      await knex('quellen').insert(quelle)
      console.log(`Verkehr: Quellenzeile «${quelle.name}» angelegt.`)
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS geschwindigkeitskontrollen_monat_uniq')
}
