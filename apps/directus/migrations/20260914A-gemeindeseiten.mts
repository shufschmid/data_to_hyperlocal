import type { Knex } from 'knex'

/**
 * What Postgres has to enforce about the municipal-news rows, plus the one
 * seed a fresh install needs. The collection and its fields live in ../schema
 * and arrive through `schema:load`; this file adds only what the snapshot
 * cannot say:
 *
 * - **One Meldung per Mitteilung.** "Meldung schreiben" pressed twice, or
 *   raced from two tabs, must not produce two articles about the same item.
 *   The predicate matches the endpoint's own guard (`status <> 'verworfen'`)
 *   exactly — the entsorgung index is the precedent — so a second Meldung
 *   after a discarded one is allowed by the database as it is by the code.
 *   `meldungen_kandidat_uniq` lacks that clause and is the shape NOT to copy.
 * - **Seed: the nine news pages the newsroom named.** Keyed by BFS number
 *   (names get edited), written only where the field is still empty, so an
 *   editor's later change is never undone. Allschwil's query string is the
 *   category filter and is kept verbatim.
 *
 * Idempotent, like every migration here: it runs after the schema push on
 * every boot.
 */

const INDIZES: ReadonlyArray<string> = [
  "CREATE UNIQUE INDEX IF NOT EXISTS meldungen_gemeindemitteilung_uniq ON meldungen (gemeindemitteilung) WHERE gemeindemitteilung IS NOT NULL AND status <> 'verworfen'"
]

const NEWSSEITEN: ReadonlyArray<{ bfs_nummer: number; news_url: string }> = [
  { bfs_nummer: 2703, news_url: 'https://www.riehen.ch/aktuelles/' },
  {
    bfs_nummer: 2761,
    news_url: 'https://www.aesch.bl.ch/aktuellesinformationen'
  },
  {
    bfs_nummer: 2762,
    news_url:
      'https://www.allschwil.ch/de/aktuelles/?categories[]=1177055180125'
  },
  { bfs_nummer: 2763, news_url: 'https://www.arlesheim.ch/de/aktuelles/' },
  {
    bfs_nummer: 2765,
    news_url:
      'https://www.binningen.ch/de/gemeinde/news-und-medien/news.html/106'
  },
  { bfs_nummer: 2767, news_url: 'https://www.bottmingen.ch/de/aktuelles/' },
  {
    bfs_nummer: 2769,
    news_url: 'https://www.muenchenstein.ch/aktuellesinformationen'
  },
  {
    bfs_nummer: 2770,
    news_url: 'https://www.muttenz.ch/aktuellesinformationen'
  },
  { bfs_nummer: 2773, news_url: 'https://www.reinach-bl.ch/de/aktuell/' },
  {
    bfs_nummer: 2831,
    news_url: 'https://www.pratteln.ch/aktuellesinformationen'
  }
]

export async function up(knex: Knex): Promise<void> {
  for (const anweisung of INDIZES) {
    await knex.raw(anweisung)
  }

  const hatSpalte = await knex.schema.hasColumn('gemeinden', 'news_url')
  if (!hatSpalte) return

  let gesetzt = 0
  for (const seite of NEWSSEITEN) {
    gesetzt += await knex('gemeinden')
      .where({ bfs_nummer: seite.bfs_nummer })
      .whereNull('news_url')
      .update({ news_url: seite.news_url })
  }
  if (gesetzt > 0)
    console.log(`Gemeindeseiten: ${gesetzt} Newsseiten eingetragen.`)
}

export async function down(knex: Knex): Promise<void> {
  // The seeded addresses stay: by now they are the editor's setting, and a
  // rollback of the index must not silence nine feeds.
  await knex.raw('DROP INDEX IF EXISTS meldungen_gemeindemitteilung_uniq')
}
