import type { Knex } from 'knex'

/**
 * Seed: what Allschwil and Reinach were missing.
 *
 * Measured on 17 September 2026 against the live door (199 published articles
 * over ten municipalities): Allschwil carried FOUR, Reinach ONE, while the
 * other eight carried between 19 and 31. Both had zero from the press review,
 * the waste calendar, sport and statistics. What was missing is not a line of
 * code but a registration, and the press review is the single biggest lever —
 * it accounts for between 7 and 21 articles at the other eight.
 *
 * Every value here was verified in
 * `2026-09-17_handreichung_allschwil_reinach.md` and carries its evidence
 * there. What that document lists as an OPEN QUESTION is deliberately absent
 * from this file: the two football association ids (the association refuses
 * machine access, so they were never read back), which of the VBC Allschwil's
 * two equally-ranked teams is the first one, the TV Reinach team id, and
 * whether the FC Reinach is Aushaengeschild or Breitensport. Those are a
 * browser and a newsroom decision, not a migration.
 *
 * **What a migration cannot do here, and the endpoint can.** Registering a
 * paper through the form reads its archive BEFORE storing it, and then
 * processes the newest issue at once. This writes blind, so the reading
 * happened in the handreichung instead — the archive answered 200 with a
 * 7.4-MB PDF — and the first issue arrives with the ordinary 09:00 run rather
 * than immediately.
 *
 * Insert-only and update-only-where-empty: an editor's own correction survives
 * every redeploy.
 */

const ALLSCHWIL = 2762
const REINACH = 2773

const ALLSCHWILER_WOCHENBLATT = {
  name: 'Allschwiler Wochenblatt',
  archiv_url: 'https://www.lokalzeitungen.ch/allschwiler-wochenblatt/',
  konnektor: 'lokalzeitungen',
  aktiv: true
}

/** Postcode and procurement office, both verified through real publications. */
const STAMMDATEN: ReadonlyArray<{
  bfs: number
  plz: string
  vergabestellen: string[]
}> = [
  {
    bfs: ALLSCHWIL,
    plz: '4123',
    vergabestellen: ['1c10de22-1d6a-4088-a86f-bdeb81b729b3']
  },
  {
    bfs: REINACH,
    plz: '4153',
    vergabestellen: ['d1048e1d-637d-43d5-aa5d-f7019df30cf8']
  }
]

async function gemeindeId(knex: Knex, bfs: number): Promise<string | null> {
  const zeile = (await knex('gemeinden')
    .where({ bfs_nummer: bfs })
    .first('id')) as { id: string } | undefined
  return zeile?.id ?? null
}

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('gemeinden'))) return

  // 1. Postcode and procurement office. Without the postcode the commercial
  //    register, bankruptcies and debt collections of a municipality stay
  //    invisible — and so do the tenders somebody else puts out IN it.
  for (const eintrag of STAMMDATEN) {
    if (await knex.schema.hasColumn('gemeinden', 'plz')) {
      await knex('gemeinden')
        .where({ bfs_nummer: eintrag.bfs })
        .where((q) => q.whereNull('plz').orWhere('plz', ''))
        .update({ plz: eintrag.plz })
    }
    if (await knex.schema.hasColumn('gemeinden', 'simap_vergabestellen')) {
      await knex('gemeinden')
        .where({ bfs_nummer: eintrag.bfs })
        .whereNull('simap_vergabestellen')
        .update({
          simap_vergabestellen: JSON.stringify(eintrag.vergabestellen)
        })
    }
  }

  if (!(await knex.schema.hasTable('wochenblaetter'))) return
  if (!(await knex.schema.hasTable('wochenblattgemeinden'))) return

  // 2. The Allschwiler Wochenblatt. Same platform and therefore the same
  //    connector as the Riehener Zeitung, which is registered and delivering.
  //    It covers Allschwil alone: in the issue of 18.09.2026 the name appears
  //    20 times and every other municipality at most once, in passing.
  const allschwil = await gemeindeId(knex, ALLSCHWIL)
  if (allschwil !== null) {
    const schonDa = await knex('wochenblaetter')
      .where({ archiv_url: ALLSCHWILER_WOCHENBLATT.archiv_url })
      .first('id')
    if (schonDa === undefined) {
      const [angelegt] = (await knex('wochenblaetter')
        .insert({ ...ALLSCHWILER_WOCHENBLATT, gemeinde: allschwil })
        .returning('id')) as Array<{ id: string }>
      if (angelegt !== undefined) {
        await knex('wochenblattgemeinden').insert({
          wochenblatt: angelegt.id,
          gemeinde: allschwil
        })
        console.log('Presseschau: Allschwiler Wochenblatt erfasst.')
      }
    }
  }

  // 3. Reinach is not a new paper but an assignment. The «Wochenblatt fuer das
  //    Birseck» is registered and already delivers for Aesch, Arlesheim and
  //    Muenchenstein, and its own imprint names Reinach among the eight
  //    municipalities it is the official publication organ for. Matched on its
  //    host rather than its name, which an editor may have rewritten.
  const reinach = await gemeindeId(knex, REINACH)
  if (reinach === null) return

  const birseck = (await knex('wochenblaetter')
    .where('archiv_url', 'like', '%wochenblatt.ch%')
    .first('id')) as { id: string } | undefined
  if (birseck === undefined) return

  const zugeordnet = await knex('wochenblattgemeinden')
    .where({ wochenblatt: birseck.id, gemeinde: reinach })
    .first('id')
  if (zugeordnet === undefined) {
    await knex('wochenblattgemeinden').insert({
      wochenblatt: birseck.id,
      gemeinde: reinach
    })
    console.log(
      'Presseschau: Reinach dem Wochenblatt fuer das Birseck zugeordnet.'
    )
  }
}

export async function down(knex: Knex): Promise<void> {
  // The paper and the assignment go, the master data stays: by the time anyone
  // rolls back, a postcode is the newsroom's own setting, and clearing it would
  // silence half the gazette desk for two municipalities.
  if (!(await knex.schema.hasTable('wochenblaetter'))) return

  const blatt = (await knex('wochenblaetter')
    .where({ archiv_url: ALLSCHWILER_WOCHENBLATT.archiv_url })
    .first('id')) as { id: string } | undefined
  if (blatt !== undefined) {
    await knex('wochenblattgemeinden').where({ wochenblatt: blatt.id }).del()
    await knex('wochenblaetter').where({ id: blatt.id }).del()
  }

  const reinach = await gemeindeId(knex, REINACH)
  const birseck = (await knex('wochenblaetter')
    .where('archiv_url', 'like', '%wochenblatt.ch%')
    .first('id')) as { id: string } | undefined
  if (reinach !== null && birseck !== undefined) {
    await knex('wochenblattgemeinden')
      .where({ wochenblatt: birseck.id, gemeinde: reinach })
      .del()
  }
}
