import type { Knex } from 'knex'

/**
 * The three rules about Entsorgung rows that Postgres has to enforce, because
 * the schema snapshot cannot express them.
 *
 * The collections themselves live in ../schema and arrive through
 * `schema:load` — this file adds only what a composite or partial index can say
 * and a field definition cannot:
 *
 * - **One calendar per municipality and year.** Uploading a corrected PDF has
 *   to update the calendar an editor already confirmed dates on, not open a
 *   second one that silently competes with it.
 * - **One reminder per municipality and newsletter day.** This is the
 *   newsroom's merge rule as a constraint: two reminders in the same edition
 *   read as noise, so several collection dates that fall on one day become one
 *   article. The `status <> 'verworfen'` clause is load-bearing — a reminder
 *   invalidated by a corrected date stays in the table as a discarded row, and
 *   without the clause it would block the replacement from ever being written.
 * - **One termin per calendar, category, zone and date.** Re-reading the same
 *   PDF must not clone the year. `COALESCE(zone, '')` is what makes that hold
 *   for municipalities without zones, where every `zone` is NULL and NULLs do
 *   not collide in a unique index.
 *
 * Idempotent (`IF NOT EXISTS`), like every migration here: it runs after the
 * schema push on every boot, against databases that already have all of it.
 */

const INDIZES: ReadonlyArray<string> = [
  'CREATE UNIQUE INDEX IF NOT EXISTS entsorgungskalender_gemeinde_jahr_uniq ON entsorgungskalender (gemeinde, jahr)',
  "CREATE UNIQUE INDEX IF NOT EXISTS meldungen_gemeinde_erscheint_uniq ON meldungen (gemeinde, erscheint_am) WHERE erscheint_am IS NOT NULL AND status <> 'verworfen'",
  "CREATE UNIQUE INDEX IF NOT EXISTS entsorgungstermine_eindeutig ON entsorgungstermine (kalender, kategorie, COALESCE(zone, ''), datum)"
]

export async function up(knex: Knex): Promise<void> {
  for (const anweisung of INDIZES) {
    await knex.raw(anweisung)
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS entsorgungstermine_eindeutig')
  await knex.raw('DROP INDEX IF EXISTS meldungen_gemeinde_erscheint_uniq')
  await knex.raw('DROP INDEX IF EXISTS entsorgungskalender_gemeinde_jahr_uniq')
}
