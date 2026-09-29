import type { Knex } from 'knex'

/**
 * Seed: one settings row per grading desk, with the standard the code also
 * falls back to — so the gear shows the dial from the first day instead of
 * an empty list.
 *
 * The newsroom on 29 September 2026: a yes/no Sichtung had no dial, and in a
 * quiet week the desk should take more. The Sichtung now grades 1–4, the
 * threshold and the lead per grade are these rows (`redaktion/
 * tischeinstellungen.ts`). Insert-only; `down` removes the two rows.
 */

const TISCHE = [
  {
    tisch: 'gemeinde',
    schwelle: 3,
    vorlauf_stufe4: 30,
    vorlauf_stufe3: 10,
    vorlauf_stufe2: 5,
    dauerangebote_je_woche: 1
  },
  {
    tisch: 'veranstaltung',
    schwelle: 3,
    vorlauf_stufe4: 30,
    vorlauf_stufe3: 10,
    vorlauf_stufe2: 5,
    dauerangebote_je_woche: 1
  }
]

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('tischeinstellungen'))) return
  for (const zeile of TISCHE) {
    const vorhanden = await knex('tischeinstellungen')
      .where({ tisch: zeile.tisch })
      .first()
    if (vorhanden !== undefined) continue
    await knex('tischeinstellungen').insert({
      id: knex.raw('gen_random_uuid()'),
      ...zeile
    })
    console.log(`Tischeinstellungen: ${zeile.tisch} mit dem Standard angelegt.`)
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('tischeinstellungen'))) return
  await knex('tischeinstellungen')
    .whereIn(
      'tisch',
      TISCHE.map((t) => t.tisch)
    )
    .delete()
}
