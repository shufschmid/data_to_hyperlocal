import type { Knex } from 'knex'

/**
 * Riehen — the first municipality outside Basel-Landschaft.
 *
 * The newsroom covers it for sport: it plays in the same regional football
 * association as the Basel-Landschaft clubs (FVNWS spans BS and BL), so its
 * results arrive through exactly the same source as everyone else's.
 *
 * Two things make this more than one INSERT:
 *
 * - `bezirk` is NOT NULL and the seed derives it from contiguous blocks of BFS
 *   numbers (20260804A). Riehen's 2703 falls outside every Basel-Landschaft
 *   block, and Basel-Stadt has no districts at all. `Basel-Stadt` is therefore
 *   the canton standing in for a district — it is what the workspace groups the
 *   switches by, so it has to read sensibly as a heading.
 * - The `bezirk` dropdown lists the five Basel-Landschaft districts. Without the
 *   sixth choice the admin UI shows Riehen's district as an unknown raw value.
 *
 * `gemeinden` is otherwise reference data seeded once; this is the documented
 * kind of migration — a backfill that must happen without a human clicking.
 */

const BEZIRKE_NEU = [
  'Arlesheim',
  'Basel-Stadt',
  'Laufen',
  'Liestal',
  'Sissach',
  'Waldenburg'
]
const BEZIRKE_ALT = ['Arlesheim', 'Laufen', 'Liestal', 'Sissach', 'Waldenburg']

const NOTIZ_NEU =
  'Gemeinden, ueber die berichtet wird — Basel-Landschaft vollstaendig, dazu Riehen (BS) fuer den Sport. "Aktiv" steuert, fuer welche Gemeinden Meldungen erzeugt werden.'
const NOTIZ_ALT =
  'Gemeinden des Kantons Basel-Landschaft. "Aktiv" steuert, fuer welche Gemeinden Meldungen erzeugt werden.'

function auswahl(bezirke: readonly string[]): string {
  return JSON.stringify({
    choices: bezirke.map((bezirk) => ({ text: bezirk, value: bezirk }))
  })
}

export async function up(knex: Knex): Promise<void> {
  await knex('directus_fields')
    .where({ collection: 'gemeinden', field: 'bezirk' })
    .update({ options: auswahl(BEZIRKE_NEU) })

  await knex('directus_collections')
    .where({ collection: 'gemeinden' })
    .update({ note: NOTIZ_NEU })

  // bfs_nummer is the identity and carries a unique constraint, so a re-run
  // leaves the editor's `aktiv` choice alone instead of resetting it.
  await knex('gemeinden')
    .insert({
      bfs_nummer: 2703,
      name: 'Riehen',
      bezirk: 'Basel-Stadt',
      aktiv: false
    })
    .onConflict('bfs_nummer')
    .ignore()
}

export async function down(knex: Knex): Promise<void> {
  await knex('gemeinden').where({ bfs_nummer: 2703 }).delete()

  await knex('directus_collections')
    .where({ collection: 'gemeinden' })
    .update({ note: NOTIZ_ALT })

  await knex('directus_fields')
    .where({ collection: 'gemeinden', field: 'bezirk' })
    .update({ options: auswahl(BEZIRKE_ALT) })
}
