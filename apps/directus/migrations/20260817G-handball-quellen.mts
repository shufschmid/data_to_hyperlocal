import type { Knex } from 'knex'

/**
 * The two handball clubs get their Match Center team pages.
 *
 * Swiss Handball is the friendliest of the three sources so far: each row prints
 * a real ISO instant beside the human date, so the connector needs no month
 * names and no timezone arithmetic.
 *
 * One team page per club, like volleyball — hence `ergebnis_url` per club rather
 * than a rule derived from `sportart`. `externe_id` is the team number in the
 * URL; it only feeds the composed match key, since these rows carry no match
 * number of their own.
 */

const QUELLEN_NEU = [
  { text: 'Von Hand erfasst', value: 'manuell' },
  { text: 'FVNWS (Fussball)', value: 'fvnws' },
  { text: 'Swiss Volley', value: 'swissvolley' },
  { text: 'Swiss Handball', value: 'handball' },
  { text: 'swissunihockey', value: 'swissunihockey' }
]

const QUELLEN_ALT = QUELLEN_NEU.filter((quelle) => quelle.value !== 'handball')

const ZUORDNUNGEN: ReadonlyArray<{ bfs: number; name: string; team: string }> =
  [
    { bfs: 2831, name: 'TV Pratteln NS', team: '41131' },
    { bfs: 2765, name: 'Handball Blau Boys Binningen', team: '41538' }
  ]

function url(team: string): string {
  return `https://www.handball.ch/de/matchcenter/teams/${team}#/games`
}

async function setzeQuellen(
  knex: Knex,
  quellen: readonly unknown[]
): Promise<void> {
  await knex('directus_fields')
    .where({ collection: 'vereine', field: 'quelle' })
    .update({ options: JSON.stringify({ choices: quellen }) })
}

export async function up(knex: Knex): Promise<void> {
  await setzeQuellen(knex, QUELLEN_NEU)

  const gemeinden = (await knex('gemeinden').select(
    'id',
    'bfs_nummer'
  )) as ReadonlyArray<{
    id: string
    bfs_nummer: number
  }>
  const nachBfs = new Map(
    gemeinden.map((gemeinde) => [gemeinde.bfs_nummer, gemeinde.id])
  )

  for (const zuordnung of ZUORDNUNGEN) {
    const gemeindeId = nachBfs.get(zuordnung.bfs)
    if (gemeindeId === undefined) continue
    await knex('vereine')
      .where({ gemeinde: gemeindeId, name: zuordnung.name })
      .update({
        quelle: 'handball',
        externe_id: zuordnung.team,
        ergebnis_url: url(zuordnung.team)
      })
  }
}

export async function down(knex: Knex): Promise<void> {
  const gemeinden = (await knex('gemeinden').select(
    'id',
    'bfs_nummer'
  )) as ReadonlyArray<{
    id: string
    bfs_nummer: number
  }>
  const nachBfs = new Map(
    gemeinden.map((gemeinde) => [gemeinde.bfs_nummer, gemeinde.id])
  )

  for (const zuordnung of ZUORDNUNGEN) {
    const gemeindeId = nachBfs.get(zuordnung.bfs)
    if (gemeindeId === undefined) continue
    await knex('vereine')
      .where({ gemeinde: gemeindeId, name: zuordnung.name })
      .update({ quelle: 'manuell', externe_id: null, ergebnis_url: null })
  }

  await setzeQuellen(knex, QUELLEN_ALT)
}
