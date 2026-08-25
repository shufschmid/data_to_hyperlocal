import type { Knex } from 'knex'

/**
 * What Postgres has to enforce about the Wochenblatt rows, plus the one seed a
 * fresh install needs. The collections themselves live in ../schema and arrive
 * through `schema:load` — this file adds only what the snapshot cannot say:
 *
 * - **One Meldung per candidate.** "Meldung erzeugen" pressed twice, or raced
 *   from two tabs, must not produce two press-review articles about the same
 *   piece. The partial index mirrors `meldungen_spiel_uniq` — the fourth
 *   Meldung kind gets the same guarantee as the other three.
 * - **One issue per paper and key.** The daily archive read sees the whole
 *   list every morning; the canonical `schluessel` (slug suffixes like `_v2`
 *   normalized away) plus this index is what makes that idempotent.
 * - **Seed: the Binninger Wochenblatt.** The first registered paper, so a
 *   fresh install watches it without a human clicking. Insert-only and
 *   idempotent — an editor's later changes are never undone.
 *
 * Idempotent (`IF NOT EXISTS` / `onConflict().ignore()`), like every migration
 * here: it runs after the schema push on every boot.
 */

const INDIZES: ReadonlyArray<string> = [
  'CREATE UNIQUE INDEX IF NOT EXISTS meldungen_kandidat_uniq ON meldungen (kandidat) WHERE kandidat IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS wochenblattausgaben_eindeutig ON wochenblattausgaben (wochenblatt, schluessel)'
]

export async function up(knex: Knex): Promise<void> {
  for (const anweisung of INDIZES) {
    await knex.raw(anweisung)
  }

  // Binningen carries BFS number 2765 — the same key the municipality seed
  // uses, so the lookup cannot drift when names are edited.
  const binningen = await knex('gemeinden')
    .where({ bfs_nummer: 2765 })
    .first('id')
  if (binningen === undefined) return

  await knex('wochenblaetter')
    .insert({
      id: knex.raw('gen_random_uuid()'),
      gemeinde: binningen.id,
      name: 'Binninger Wochenblatt',
      archiv_url: 'https://www.binninger-wochenblatt.ch/archiv/',
      konnektor: 'wordpress-archiv',
      aktiv: true
    })
    .onConflict('gemeinde')
    .ignore()
}

export async function down(knex: Knex): Promise<void> {
  await knex('wochenblaetter')
    .where({ archiv_url: 'https://www.binninger-wochenblatt.ch/archiv/' })
    .delete()
  await knex.raw('DROP INDEX IF EXISTS wochenblattausgaben_eindeutig')
  await knex.raw('DROP INDEX IF EXISTS meldungen_kandidat_uniq')
}
