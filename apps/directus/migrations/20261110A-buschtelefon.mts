import type { Knex } from 'knex'

/**
 * The Buschtelefon desk, 10 November 2026 — indexes only. The collection
 * (`buschtelefon_funde`) and the origin field on `meldungen` live in
 * `schema/`, as every collection does.
 *
 * Two things the schema sync does not carry:
 *
 * - The find's identity, its `kennung` (fb:…, ig:…, tt:…): the hourly pick-up
 *   is an UPSERT by it, and a read that overlaps the previous one by two
 *   hours (a run stamps all its finds alike but writes them one after the
 *   other) must land on the same row, never on a second one. Without the
 *   index two overlapping pick-ups could store a find twice.
 *
 * - The desk's one-article rule on `meldungen.buschtelefon_fund`, enforced
 *   by the database like the other desks' are: one find, one Meldung, unless
 *   the first was discarded.
 *
 * No source row: the desk's configuration is the environment
 * (`BUSCHTELEFON_*`), not a table.
 */

const INDIZES: ReadonlyArray<{ tabelle: string; sql: string }> = [
  {
    tabelle: 'buschtelefon_funde',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS buschtelefon_funde_kennung_uniq ON buschtelefon_funde (kennung)'
  },
  {
    tabelle: 'meldungen',
    sql: "CREATE UNIQUE INDEX IF NOT EXISTS meldungen_buschtelefon_fund_uniq ON meldungen (buschtelefon_fund) WHERE buschtelefon_fund IS NOT NULL AND status <> 'verworfen'"
  }
]

export async function up(knex: Knex): Promise<void> {
  for (const index of INDIZES) {
    if (!(await knex.schema.hasTable(index.tabelle))) continue
    if (
      index.tabelle === 'meldungen' &&
      !(await knex.schema.hasColumn('meldungen', 'buschtelefon_fund'))
    )
      continue
    await knex.raw(index.sql)
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS buschtelefon_funde_kennung_uniq')
  await knex.raw('DROP INDEX IF EXISTS meldungen_buschtelefon_fund_uniq')
}
