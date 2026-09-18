import type { Knex } from 'knex'

/**
 * Which dataset a portal carries its vote results in — row data, no structure.
 *
 * The votes feed is NOT a new source. `data.bl.ch` has been read every morning
 * since the first day, dataset 11990 «Abstimmungsresultate nach Vorlage,
 * Gemeinde und Datum (seit 2003)» is a dataset on it like any other, and the
 * feed adds no host and no client. What it does need is to know WHICH dataset,
 * and that belongs where every other portal fact belongs: in the source row's
 * `konfiguration`, next to `amt` and `bezirke` (`20260917A-statistik-portale`).
 * Not a constant, not an environment variable — the newsroom points a portal at
 * another dataset without a deploy, and a second portal brings its own id.
 *
 * A portal whose configuration names no dataset is simply not walked, and the
 * run says so by name. That is what keeps `data.bs.ch` out of this: its vote
 * data are built differently, filled only AFTER the ballot, and the portal is
 * not switched on at all — so it gets nothing here and stays silent rather than
 * being guessed at.
 *
 * Update-only-where-absent, like every other seed in this folder: an editor who
 * points this at a different dataset keeps that across every redeploy.
 */

const PORTAL = 'https://data.bl.ch'

/** Measured 18 September 2026: 34'658 rows, one per Vorlage and municipality. */
const DATENSATZ = '11990'

interface Quellenzeile {
  id: string
  konfiguration: unknown
}

function alsObjekt(wert: unknown): Record<string, unknown> {
  if (typeof wert === 'string') {
    try {
      const gelesen: unknown = JSON.parse(wert)
      return typeof gelesen === 'object' && gelesen !== null
        ? (gelesen as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return typeof wert === 'object' && wert !== null
    ? (wert as Record<string, unknown>)
    : {}
}

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('quellen'))) return

  const zeilen = (await knex('quellen')
    .where({ typ: 'ods' })
    .whereLike('basis_url', `${PORTAL}%`)
    .select('id', 'konfiguration')) as Quellenzeile[]

  for (const zeile of zeilen) {
    const konfiguration = alsObjekt(zeile.konfiguration)
    if (typeof konfiguration['abstimmungen'] === 'string') continue

    await knex('quellen')
      .where({ id: zeile.id })
      .update({
        konfiguration: JSON.stringify({
          ...konfiguration,
          abstimmungen: DATENSATZ
        })
      })
    console.log(
      `Abstimmungen: Datensatz ${DATENSATZ} an ${PORTAL} eingetragen.`
    )
  }
}

export async function down(knex: Knex): Promise<void> {
  // Reversible, and only where the value is still verbatim what `up` wrote: a
  // rollback costs the feed its dataset and nothing else — the run then names
  // the portal as one without a dataset instead of reading the wrong one.
  if (!(await knex.schema.hasTable('quellen'))) return

  const zeilen = (await knex('quellen')
    .where({ typ: 'ods' })
    .select('id', 'konfiguration')) as Quellenzeile[]

  for (const zeile of zeilen) {
    const konfiguration = alsObjekt(zeile.konfiguration)
    if (konfiguration['abstimmungen'] !== DATENSATZ) continue

    const { abstimmungen: _entfernt, ...rest } = konfiguration
    await knex('quellen')
      .where({ id: zeile.id })
      .update({ konfiguration: JSON.stringify(rest) })
  }
}
