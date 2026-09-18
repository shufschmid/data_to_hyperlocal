import type { Knex } from 'knex'

/**
 * Seed: the BC Arlesheim gets its results address.
 *
 * `#19` built the basketball connector and it has been live and silent since,
 * because a club without an `ergebnis_url` is skipped with a log line nobody
 * reads. Two things it needs, and both are here: the address of the GROUP (one
 * request serves every club in it) and `externe_id`, the team id at the source
 * — a group carries several clubs, and without the id nothing says which match
 * is whose.
 *
 * **The first team is the WOMEN's side.** BC Arlesheim plays Nationalliga B
 * der Damen; the men are one tier lower. `mannschaft.ts` follows the club's
 * highest league and nothing below it, so the women's group is the one to
 * register — the Sm'Aesch Pfeffingen case again, where a blunt rule would have
 * silenced the flagship.
 *
 * **This is a yearly edit.** The group ids change every season, deliberately
 * not an automatism that would re-point itself at the wrong year.
 *
 * Read from `swiss.basketball` and never from `basketplan.ch`: the original
 * bars us with a blanket `Disallow: /` on both hosts, the association mirrors
 * the same data under a host whose robots.txt allows everything, and Jolanda
 * decided on 17 September 2026 that we may read it there.
 *
 * Only where the club carries no connector yet, so an editor's own entry is
 * never overwritten.
 */

const GRUPPE_NLB_DAMEN =
  'https://swiss.basketball/basketplan/showLeagueSchedule.do' +
  '?lang=de&xmlView=rss&leagueId=7&seasonId=31&daysBack=30&daysFuture=120' +
  '&totalGames=500&resultType=big&leagueHoldingId=11329'

const TEAM_DAMEN_1 = '515'

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('vereine'))) return

  const gesetzt = await knex('vereine')
    .where('name', 'like', 'BC Arlesheim%')
    .whereIn('quelle', ['manuell'])
    .update({
      quelle: 'basketball',
      ergebnis_url: GRUPPE_NLB_DAMEN,
      externe_id: TEAM_DAMEN_1
    })

  if (gesetzt > 0)
    console.log('Sport: BC Arlesheim an den Basketball-Konnektor gehaengt.')
  else
    console.log(
      'Sport: kein BC Arlesheim ohne Konnektor gefunden, nichts geaendert.'
    )
}

export async function down(knex: Knex): Promise<void> {
  // Back to a club that is recorded and read by nobody, which is what it was.
  if (!(await knex.schema.hasTable('vereine'))) return

  await knex('vereine')
    .where({ ergebnis_url: GRUPPE_NLB_DAMEN })
    .update({ quelle: 'manuell', ergebnis_url: null, externe_id: null })
}
