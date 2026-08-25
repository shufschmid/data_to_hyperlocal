import type { Knex } from 'knex'

/**
 * One document per calendar and zone — the Riehen rule.
 *
 * Municipalities like Riehen print a separate PDF per collection zone, so a
 * calendar owns several documents. Re-registering a zone's PDF has to update
 * the document an editor already worked with, never open a competing second
 * one — and `COALESCE(zone, '')` is what makes that hold for the single-PDF
 * municipalities too, where `zone` is NULL and NULLs would not collide in a
 * unique index.
 *
 * A separate file rather than an addition to 20260824B: that migration has run
 * on databases, and a migration that has run somewhere is never edited.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    "CREATE UNIQUE INDEX IF NOT EXISTS entsorgungsdokumente_eindeutig ON entsorgungsdokumente (kalender, COALESCE(zone, ''))"
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS entsorgungsdokumente_eindeutig')
}
