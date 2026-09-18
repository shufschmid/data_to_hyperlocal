import type { Knex } from 'knex'

/**
 * Seed: which municipalities lie under the ILS-33 approach.
 *
 * `gemeinden.suedanflug` is maintained by hand for a measured reason — the
 * airport publishes ONE quota for itself and no breakdown by place, so who is
 * affected is the newsroom's judgement and not a column of the source. This
 * file only writes down the judgement the newsroom has already made.
 *
 * **Binningen and Allschwil**, because those two are what the source of the
 * whole feature names: the Binninger Wochenblatt's July 2026 piece, from which
 * the 43,7 percent came that the reader was built against. They also lie on the
 * final approach corridor through the Leimental.
 *
 * Deliberately NOT set: Bottmingen, which lies on the same corridor and is the
 * likely third, and every other municipality. A wrong entry here does not fail
 * loudly — it produces an article about a place the figure does not describe,
 * and that is the one error a reader can neither see nor check. Adding one is a
 * checkbox in the Gemeinden card, which is where that decision belongs.
 *
 * Written only where the flag is still false, so an editor who has since
 * switched one off is never overruled. Idempotent, like every migration here.
 */

const UNTER_DER_SCHNEISE: ReadonlyArray<number> = [
  2762, // Allschwil
  2765 // Binningen
]

export async function up(knex: Knex): Promise<void> {
  const hatSpalte = await knex.schema.hasColumn('gemeinden', 'suedanflug')
  if (!hatSpalte) return

  let gesetzt = 0
  for (const bfs of UNTER_DER_SCHNEISE) {
    gesetzt += await knex('gemeinden')
      .where({ bfs_nummer: bfs, suedanflug: false })
      .update({ suedanflug: true })
  }
  if (gesetzt > 0)
    console.log(`Suedanflug: ${gesetzt} Gemeinden als betroffen markiert.`)
}

export async function down(knex: Knex): Promise<void> {
  // Takes back exactly what up() set. A municipality the newsroom has since
  // added itself carries a bfs_nummer this file does not name and stays.
  const hatSpalte = await knex.schema.hasColumn('gemeinden', 'suedanflug')
  if (!hatSpalte) return

  await knex('gemeinden')
    .whereIn('bfs_nummer', UNTER_DER_SCHNEISE)
    .update({ suedanflug: false })
}
