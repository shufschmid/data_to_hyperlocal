import type { Knex } from 'knex'

/**
 * Seed: the nine event pages the newsroom named, beside the news pages that
 * 20260914A seeded. Same shape as that one, deliberately — keyed by BFS
 * number (names get edited), written only where the field is still empty, so
 * an editor's later change is never undone.
 *
 * **Why a migration and not the form.** The endpoint reads a page BEFORE it
 * stores the address, which is what makes a typo fail at the form instead of
 * in tomorrow's run. A migration writes blind, so the reading has to have
 * happened somewhere else: all nine were fetched on 18 September 2026 through
 * this project's own reader and fingerprinted by `erkennePlattform` — four
 * `weblication_termine` (Allschwil, Arlesheim, Bottmingen, Reinach), four
 * `iweb_termine` (Aesch, Muenchenstein, Muttenz, Pratteln) and one
 * `backslash_termine` (Binningen). The measurement is the price of the
 * shortcut; without it this file would be nine guesses.
 *
 * **Riehen is absent on purpose.** It runs no event list of its own and
 * points at riehenevents.ch — a foreign host, and therefore a decision about
 * a new source rather than a row of data.
 *
 * Idempotent, like every migration here: it runs after the schema push on
 * every boot.
 */

const VERANSTALTUNGSSEITEN: ReadonlyArray<{
  bfs_nummer: number
  veranstaltungen_url: string
}> = [
  {
    bfs_nummer: 2761,
    veranstaltungen_url: 'https://www.aesch.bl.ch/anlaesseaktuelles'
  },
  {
    bfs_nummer: 2762,
    veranstaltungen_url: 'https://www.allschwil.ch/de/veranstaltungen/'
  },
  {
    bfs_nummer: 2763,
    veranstaltungen_url: 'https://www.arlesheim.ch/de/veranstaltungen/'
  },
  {
    bfs_nummer: 2765,
    veranstaltungen_url:
      'https://www.binningen.ch/de/gemeinde/news-und-medien/veranstaltungen.html/51'
  },
  {
    bfs_nummer: 2767,
    veranstaltungen_url: 'https://www.bottmingen.ch/de/veranstaltungen/'
  },
  {
    bfs_nummer: 2769,
    veranstaltungen_url: 'https://www.muenchenstein.ch/anlaesseaktuelles'
  },
  {
    bfs_nummer: 2770,
    veranstaltungen_url: 'https://www.muttenz.ch/anlass'
  },
  {
    bfs_nummer: 2773,
    veranstaltungen_url: 'https://www.reinach-bl.ch/de/veranstaltungen/'
  },
  {
    bfs_nummer: 2831,
    veranstaltungen_url: 'https://www.pratteln.ch/anlaesseaktuelles'
  }
]

export async function up(knex: Knex): Promise<void> {
  const hatSpalte = await knex.schema.hasColumn(
    'gemeinden',
    'veranstaltungen_url'
  )
  if (!hatSpalte) return

  let gesetzt = 0
  for (const seite of VERANSTALTUNGSSEITEN) {
    gesetzt += await knex('gemeinden')
      .where({ bfs_nummer: seite.bfs_nummer })
      .whereNull('veranstaltungen_url')
      .update({ veranstaltungen_url: seite.veranstaltungen_url })
  }
  if (gesetzt > 0)
    console.log(`Gemeindeseiten: ${gesetzt} Veranstaltungsseiten eingetragen.`)
}

export async function down(knex: Knex): Promise<void> {
  // Removes exactly what this file wrote and nothing else: an address an
  // editor has since changed no longer matches and stays. That is what keeps
  // a rollback from silencing a feed somebody deliberately set up.
  const hatSpalte = await knex.schema.hasColumn(
    'gemeinden',
    'veranstaltungen_url'
  )
  if (!hatSpalte) return

  for (const seite of VERANSTALTUNGSSEITEN) {
    await knex('gemeinden')
      .where({
        bfs_nummer: seite.bfs_nummer,
        veranstaltungen_url: seite.veranstaltungen_url
      })
      .update({ veranstaltungen_url: null })
  }
}
