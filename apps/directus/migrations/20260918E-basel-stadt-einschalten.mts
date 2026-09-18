import type { Knex } from 'knex'

/**
 * The switch: Basel-Stadt's statistics portal goes live.
 *
 * `20260917A` registered `data.bs.ch` INACTIVE and said why: switching a new
 * host on is an operator's decision, not a migration's. The decision has been
 * taken on 18 September 2026, and what made it urgent is the vote of the 27th.
 * Riehen is the one covered municipality outside Basel-Landschaft, and the
 * statistics portals are cantonal — so it gets sport, waste, the press review,
 * the gazette and its own website, and nothing at all from the data desk.
 * Basel-Stadt carries both the statistics and the vote results, with Riehen as
 * a municipality row of its own beside Basel and Bettingen.
 *
 * **What this starts.** One more catalogue read in the daily 06:00 check: plain
 * JSON over the same Opendatasoft paths `data.bl.ch` already answers on, no
 * key, no model call. The portal was measured on 17 September 2026 — same
 * response shape, 361 datasets against 188.
 *
 * **What it does NOT do, and cannot.** Dataset 100059 needs
 * `datensaetze.gemeindefeld = 'gemeindename'`, because Basel-Stadt ships no
 * field descriptions and its own `gemeinde` column carries the CANTON's code
 * (Basel 10, Riehen 20, Bettingen 30) rather than the BFS number. That is a
 * field on the dataset ROW, and the row does not exist until the catalogue has
 * been read once. It is therefore one click in the admin UI after the first
 * run, or a second migration once the row is there — not something this file
 * can reach.
 */

const BASIS_URL = 'https://data.bs.ch'

export async function up(knex: Knex): Promise<void> {
  const hatQuellen = await knex.schema.hasTable('quellen')
  if (!hatQuellen) return

  const gesetzt = await knex('quellen')
    .where({ typ: 'ods', basis_url: BASIS_URL, aktiv: false })
    .update({ aktiv: true })
  if (gesetzt > 0) console.log('Statistik: Basel-Stadt eingeschaltet.')
}

export async function down(knex: Knex): Promise<void> {
  // Back to the state `20260917A` left behind. A newsroom that has switched the
  // portal off itself is already there, and this changes nothing for it.
  const hatQuellen = await knex.schema.hasTable('quellen')
  if (!hatQuellen) return

  await knex('quellen')
    .where({ typ: 'ods', basis_url: BASIS_URL })
    .update({ aktiv: false })
}
