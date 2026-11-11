import type { Knex } from 'knex'

/**
 * The Buschtelefon desk: one index Directus does not manage, and the desk's
 * settings row.
 *
 * The three collections (`buschtelefon_funde`, `buschtelefon_quellen`,
 * `buschtelefon_stand`) and the two origin fields are the snapshot's — a
 * migration never creates structure. The identity of a find, `kennung`, is a
 * single-column unique and therefore `is_unique` in the snapshot too.
 *
 * What is left for here: the partial unique on `meldungen(buschtelefon_fund)`,
 * the desk's one-article rule enforced by the database like the Kanton
 * desk's. Its predicate matches the endpoint's own guard (`status <>
 * 'verworfen'`), so a discarded draft never blocks the next one.
 *
 * And the settings row of the third grading desk, with the standard the code
 * also falls back to (threshold 3 — the newsroom's decision of 11 November
 * 2026: the run writes a draft for every proposal, from grade 3 of 4). The
 * lead and Dauerangebote columns belong to the events desk and carry their
 * standard here only because the columns are not nullable; this desk ignores
 * them. Insert-only: a threshold the newsroom has since moved survives a
 * redeploy.
 */

const INDEX =
  "CREATE UNIQUE INDEX IF NOT EXISTS meldungen_buschtelefon_fund_uniq ON meldungen (buschtelefon_fund) WHERE buschtelefon_fund IS NOT NULL AND status <> 'verworfen'"

const TISCH = {
  tisch: 'buschtelefon',
  schwelle: 3,
  vorlauf_stufe4: 30,
  vorlauf_stufe3: 10,
  vorlauf_stufe2: 5,
  dauerangebote_je_woche: 1
}

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('meldungen', 'buschtelefon_fund')) {
    await knex.raw(INDEX)
  }

  if (!(await knex.schema.hasTable('tischeinstellungen'))) return
  const vorhanden = await knex('tischeinstellungen')
    .where({ tisch: TISCH.tisch })
    .first('id')
  if (vorhanden !== undefined) return
  await knex('tischeinstellungen').insert({
    id: knex.raw('gen_random_uuid()'),
    ...TISCH
  })
  console.log(
    `Tischeinstellungen: ${TISCH.tisch} mit dem Standard angelegt (Schwelle ${TISCH.schwelle}).`
  )
}

export async function down(knex: Knex): Promise<void> {
  // The index goes. The settings row goes only while it still carries the
  // seeded threshold — a value the newsroom has set is its decision, and a
  // rollback must not lose it.
  await knex.raw('DROP INDEX IF EXISTS meldungen_buschtelefon_fund_uniq')
  if (!(await knex.schema.hasTable('tischeinstellungen'))) return
  await knex('tischeinstellungen')
    .where({ tisch: TISCH.tisch, schwelle: TISCH.schwelle })
    .delete()
}
