import type { Knex } from 'knex'

/**
 * Seed: the settings rows of the two desks that grade since 22 November 2026
 * — Wochenblätter and SMD — with the standard the code also falls back to,
 * so the gear shows both dials from the first day.
 *
 * The newsroom's wish: the relevance grades 1–4 on both desks, and a dial
 * that says from which grade the run writes the Meldung itself (a draft,
 * never a publication). Both desks read the threshold alone
 * (`redaktion/tischeinstellungen.ts`, `tischFelder`). Insert-only, so a
 * threshold the newsroom moved survives a redeploy; `down` removes a row
 * only while it still carries the seeded threshold.
 *
 * The two `vorschlag_wert` columns are snapshot files, not this migration.
 */

const SCHWELLE = 3
const TISCHE = ['wochenblatt', 'smd']

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('tischeinstellungen'))) return
  for (const tisch of TISCHE) {
    const vorhanden = await knex('tischeinstellungen').where({ tisch }).first()
    if (vorhanden !== undefined) continue
    await knex('tischeinstellungen').insert({
      id: knex.raw('gen_random_uuid()'),
      tisch,
      schwelle: SCHWELLE
    })
    console.log(
      `Tischeinstellungen: ${tisch} mit Schwelle ${SCHWELLE} angelegt.`
    )
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('tischeinstellungen'))) return
  await knex('tischeinstellungen')
    .whereIn('tisch', TISCHE)
    .andWhere({ schwelle: SCHWELLE })
    .delete()
}
