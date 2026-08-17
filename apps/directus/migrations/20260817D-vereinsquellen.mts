import type { Knex } from 'knex'

/**
 * Where each club's results are actually fetched from.
 *
 * The football entry point is the *club* page, not the league page:
 *
 *     matchcenter.fvnws.ch/default.aspx?oid=8&lng=1&v=<vereinsId>
 *
 * The league views (`ln=`) render navigation and nothing else on a plain GET —
 * they are a dead end, and the reason this took so long to find. The club page
 * returns "Aktuelle Spiele" including the score, plus tabs for
 * "Resultate + Ranglisten", "Vereinsspielplan" and "Heimspielplan".
 *
 * Two properties of that page matter for the connector:
 *
 * - The club register is shared across regional associations. `v=487` resolves
 *   to SC Binningen on `al-la.ch` and on `fvnws.ch` alike, so one host serves
 *   every club regardless of which association runs its competitions.
 * - A club page lists *all* of that club's matches, whichever association runs
 *   the competition. SC Binningen's first team plays the national Amateur Liga
 *   while its juniors play the regional championship, and both appear on the
 *   same page. That is why every football club here points at one URL rather
 *   than one URL per league.
 *
 * Every id below was verified by fetching the page and matching the club name;
 * three also match the founding years the newsroom supplied independently
 * (Münchenstein 1920, Pratteln 1929, Binningen 1920).
 *
 * Volleyball works differently — one URL per *team*, not per club — which is
 * why `ergebnis_url` exists per club rather than a rule derived from `sportart`.
 */

const QUELLEN_NEU = [
  { text: 'Von Hand erfasst', value: 'manuell' },
  { text: 'FVNWS (Fussball)', value: 'fvnws' },
  { text: 'Swiss Volley', value: 'swissvolley' },
  { text: 'swissunihockey', value: 'swissunihockey' }
]

const QUELLEN_ALT = QUELLEN_NEU.filter(
  (quelle) => quelle.value !== 'swissvolley'
)

interface Zuordnung {
  bfs: number
  name: string
  quelle: string
  externeId: string
  url: string
}

function fvnws(id: number): string {
  return `https://matchcenter.fvnws.ch/default.aspx?oid=8&lng=1&v=${id}`
}

const ZUORDNUNGEN: readonly Zuordnung[] = [
  {
    bfs: 2761,
    name: 'FC Aesch',
    quelle: 'fvnws',
    externeId: '482',
    url: fvnws(482)
  },
  {
    bfs: 2763,
    name: 'FC Arlesheim',
    quelle: 'fvnws',
    externeId: '484',
    url: fvnws(484)
  },
  {
    bfs: 2765,
    name: 'SC Binningen',
    quelle: 'fvnws',
    externeId: '487',
    url: fvnws(487)
  },
  {
    bfs: 2769,
    name: 'FC Münchenstein',
    quelle: 'fvnws',
    externeId: '497',
    url: fvnws(497)
  },
  {
    bfs: 2831,
    name: 'FC Pratteln',
    quelle: 'fvnws',
    externeId: '501',
    url: fvnws(501)
  },
  {
    bfs: 2703,
    name: 'FC Amicitia Riehen',
    quelle: 'fvnws',
    externeId: '478',
    url: fvnws(478)
  },
  {
    bfs: 2761,
    name: "Sm'Aesch Pfeffingen",
    quelle: 'swissvolley',
    externeId: '909660/98',
    url: 'https://www.volleyball.ch/de/game-center/club/909660/team/98'
  }
]

// The newsroom reports VBC Riehen is no longer in the top leagues, so the
// seeded "Nationalliga A (Herren)" is wrong. Rather than invent a replacement
// league, the club is switched off and the stale value cleared — an editor can
// switch it back on with a correct league at any time.
const VBC_LIGA_ALT = 'Nationalliga A (Herren)'

export async function up(knex: Knex): Promise<void> {
  await knex('directus_fields')
    .where({ collection: 'vereine', field: 'quelle' })
    .update({ options: JSON.stringify({ choices: QUELLEN_NEU }) })

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
        quelle: zuordnung.quelle,
        externe_id: zuordnung.externeId,
        ergebnis_url: zuordnung.url
      })
  }

  const riehen = nachBfs.get(2703)
  if (riehen !== undefined) {
    await knex('vereine')
      .where({ gemeinde: riehen, name: 'VBC Riehen' })
      .update({ liga: null, aktiv: false })
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

  const riehen = nachBfs.get(2703)
  if (riehen !== undefined) {
    await knex('vereine')
      .where({ gemeinde: riehen, name: 'VBC Riehen' })
      .update({ liga: VBC_LIGA_ALT, aktiv: true })
  }

  for (const zuordnung of ZUORDNUNGEN) {
    const gemeindeId = nachBfs.get(zuordnung.bfs)
    if (gemeindeId === undefined) continue
    await knex('vereine')
      .where({ gemeinde: gemeindeId, name: zuordnung.name })
      .update({ quelle: 'manuell', externe_id: null, ergebnis_url: null })
  }

  await knex('directus_fields')
    .where({ collection: 'vereine', field: 'quelle' })
    .update({ options: JSON.stringify({ choices: QUELLEN_ALT }) })
}
