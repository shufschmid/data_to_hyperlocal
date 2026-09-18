import type { Knex } from 'knex'

/**
 * The switch: the EuroAirport source goes live.
 *
 * `20260917B` deliberately laid the row down INACTIVE — a source that reads a
 * host the newsroom has never asked before is a decision, not a deploy. The
 * decision has been taken: Saemi proposed the feature and asked for it on the
 * data desk, Jolanda gave the word on 18 September 2026, and the two affected
 * municipalities were marked the same day (`20260918C`).
 *
 * **What this starts.** The daily 06:00 check gains one more branch: one GET on
 * the overview page, plus one PDF per month that is new or whose address moved.
 * A year in which nothing changed costs one request a day. No model is called
 * at all — the quota is read off the sheet's own TOTAL line — and a crossed
 * threshold marks the row as a proposal. No Meldung is written without a
 * person's click.
 *
 * **Why it is still only a flag.** Switching it off again is the same edit in
 * the Gemeinden card, and the thresholds sit in `konfiguration` next to it. The
 * newsroom owns this row; this file only flips it once, and only while it is
 * still the state the seed left behind.
 */

const TYP = 'euroairport'

export async function up(knex: Knex): Promise<void> {
  const hatQuellen = await knex.schema.hasTable('quellen')
  if (!hatQuellen) return

  const gesetzt = await knex('quellen')
    .where({ typ: TYP, aktiv: false })
    .update({ aktiv: true })
  if (gesetzt > 0) console.log('Suedanflug: Quelle eingeschaltet.')
}

export async function down(knex: Knex): Promise<void> {
  // Back to the state the seed left behind. A newsroom that has since switched
  // the source off itself is already there, and this changes nothing for it.
  const hatQuellen = await knex.schema.hasTable('quellen')
  if (!hatQuellen) return

  await knex('quellen').where({ typ: TYP }).update({ aktiv: false })
}
