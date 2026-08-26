import type { Knex } from 'knex'

/**
 * Multi-municipality papers: what Postgres has to enforce, plus the backfill a
 * database that predates the junction needs. The collections themselves live
 * in ../schema and arrive through `schema:load`.
 *
 * - **One coverage row per paper and municipality.** The daily run and the
 *   registration both write coverage; reading the same archive twice must not
 *   list Muttenz twice.
 * - **Backfill**: papers registered before the junction existed cover exactly
 *   their own `gemeinde` — insert-only and idempotent, so re-running on every
 *   boot never duplicates or undoes an editor's later changes.
 *
 * `wochenblaetter.gemeinde` stays what it was: the paper's main municipality
 * (and the seed's conflict key). The junction is the full coverage.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS wochenblattgemeinden_eindeutig ON wochenblattgemeinden (wochenblatt, gemeinde)'
  )

  const blaetter = await knex('wochenblaetter')
    .whereNotNull('gemeinde')
    .select('id', 'gemeinde')
  for (const blatt of blaetter) {
    await knex('wochenblattgemeinden')
      .insert({
        id: knex.raw('gen_random_uuid()'),
        wochenblatt: blatt.id,
        gemeinde: blatt.gemeinde
      })
      .onConflict(['wochenblatt', 'gemeinde'])
      .ignore()
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS wochenblattgemeinden_eindeutig')
}
