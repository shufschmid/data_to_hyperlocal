import type { Knex } from 'knex'

/**
 * Widens `spiele.spielnummer` from 32 to 160 characters.
 *
 * The column was sized for the SFV's match number, which is six digits. It is
 * really "the identity of this match at its source", and not every source
 * issues one: Swiss Volley's Game Center prints no number at all, so the
 * volleyball connector composes a key from team and pairing
 * (`sv-909660-98-btv-aarau-vs-sm-aesch-pfeffingen`, 45 characters).
 *
 * Found the hard way — the inserts failed inside the per-row error handler, so
 * the run reported ten matches found and none written. The handler is right to
 * keep going on a single bad row, but a silent size limit is not a bad row.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('spiele', (table) => {
    table.string('spielnummer', 160).notNullable().alter()
  })
}

export async function down(knex: Knex): Promise<void> {
  // Only reversible while every stored key still fits. Composed keys are longer
  // than 32 characters, so drop them first rather than truncate an identity.
  await knex('spiele').whereRaw('length(spielnummer) > 32').delete()
  await knex.schema.alterTable('spiele', (table) => {
    table.string('spielnummer', 32).notNullable().alter()
  })
}
