import type { Knex } from 'knex'

/**
 * What Postgres has to enforce about the south-approach rows, plus the one
 * seed the feed needs. The collection and its fields live in ../schema and
 * arrive through `schema:load`; this file adds only what the snapshot cannot
 * say.
 *
 * - **One row per month.** `(jahr, monat)` is the identity of a sheet: the
 *   airport re-uploads a month whenever it revises it, and a second row would
 *   split one month's history in two — the revision watchdog would then be
 *   comparing an article against a state nobody holds any more. A composite
 *   unique is exactly what the snapshot cannot express (single-column uniques
 *   belong there, as `is_unique`), which is why it sits here.
 * - **Seed: the EuroAirport source row, INACTIVE.** The feed dispatches on
 *   `quellen.typ`, and the daily check only walks rows with `aktiv = true`, so
 *   the row exists and does nothing until a person switches it on. That is
 *   deliberate: this is a new source, and whether the newsroom reads it is not
 *   a decision a migration gets to make. `data.bs.ch` was seeded the same way.
 *
 * Insert-only and guarded by `typ`, like every source seed here: an editor's
 * later edits — a renamed source, a changed threshold, a deactivation — must
 * survive every redeploy.
 */

const INDIZES: ReadonlyArray<string> = [
  'CREATE UNIQUE INDEX IF NOT EXISTS suedanflugquoten_monat_uniq ON suedanflugquoten (jahr, monat)'
]

/**
 * The thresholds live in the row, not in the code and not in the prompt.
 *
 * 40 percent in a month is the NEWSROOM's threshold (Jolanda's word, 17
 * September 2026) and is named as such in the article; 8 and 10 percent over
 * the year are the runway-use agreement of 10 February 2006, where the federal
 * office looks into the causes and measures have to be examined. Changing
 * them is an edit to this row, not a deploy.
 */
const QUELLE = {
  name: 'EuroAirport — ILS-33-Nutzungsstatistik (Suedanfluege)',
  typ: 'euroairport',
  basis_url:
    'https://www.euroairport.com/de/publikationen/statistiken/ils-33-nutzungsstatistik',
  konfiguration: JSON.stringify({
    monatsschwelle: 40,
    jahresschwellen: [8, 10]
  }),
  aktiv: false
}

export async function up(knex: Knex): Promise<void> {
  const hatTabelle = await knex.schema.hasTable('suedanflugquoten')
  if (hatTabelle) {
    for (const anweisung of INDIZES) await knex.raw(anweisung)
  }

  const hatQuellen = await knex.schema.hasTable('quellen')
  if (!hatQuellen) return

  const vorhanden = await knex('quellen').where({ typ: QUELLE.typ }).first('id')
  if (vorhanden === undefined) {
    await knex('quellen').insert(QUELLE)
    console.log('Suedanflug: Quellenzeile angelegt, inaktiv.')
  }
}

export async function down(knex: Knex): Promise<void> {
  // The index goes; the source row stays. By the time anyone rolls back, its
  // `aktiv` flag and its thresholds are the newsroom's own settings, and
  // deleting the row would take the feed's freshness history with it — the
  // same bargain `20260914A` struck with the seeded news pages.
  await knex.raw('DROP INDEX IF EXISTS suedanflugquoten_monat_uniq')
}
