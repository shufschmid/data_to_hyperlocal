import type { Knex } from 'knex'

/**
 * Seed: the canton's live publication of a vote day, on the data.bl.ch row.
 *
 * Measured on the vote Sunday of 27 September 2026: abstimmungen.bl.ch (the
 * canton's VeWork app, where the portal's own `url_web` points) carried every
 * municipality's final result from 14:02, while dataset 11990 on data.bl.ch
 * still held all 430 rows of the day as not counted. The newsroom needs the
 * results in Monday's briefing, so the votes run reads the live publication
 * too and takes whichever door is further (`waehleZeilen`).
 *
 * Which live publication belongs to a portal is a ROW, like the dataset
 * beside it (`20260918B`): `konfiguration.abstimmungen_live`. A portal
 * without one is read exactly as before.
 *
 * Insert-only: an existing value — an editor's own, or an empty string
 * someone set to switch it off — is never overwritten.
 */

const PORTAL = 'https://data.bl.ch'
const LIVE = 'https://abstimmungen.bl.ch/data/publication'

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
    if ('abstimmungen_live' in konfiguration) continue
    // Only a portal that reads votes at all gets the live door beside it.
    if (typeof konfiguration['abstimmungen'] !== 'string') continue

    await knex('quellen')
      .where({ id: zeile.id })
      .update({
        konfiguration: JSON.stringify({
          ...konfiguration,
          abstimmungen_live: LIVE
        })
      })
    console.log(
      `Abstimmungen: Live-Publikation ${LIVE} an ${PORTAL} eingetragen.`
    )
  }
}

export async function down(knex: Knex): Promise<void> {
  // Reversible where the value is still verbatim what `up` wrote; the run then
  // reads the portal alone, as before.
  if (!(await knex.schema.hasTable('quellen'))) return
  const zeilen = (await knex('quellen')
    .where({ typ: 'ods' })
    .whereLike('basis_url', `${PORTAL}%`)
    .select('id', 'konfiguration')) as Quellenzeile[]
  for (const zeile of zeilen) {
    const konfiguration = alsObjekt(zeile.konfiguration)
    if (konfiguration['abstimmungen_live'] !== LIVE) continue
    delete konfiguration['abstimmungen_live']
    await knex('quellen')
      .where({ id: zeile.id })
      .update({ konfiguration: JSON.stringify(konfiguration) })
  }
}
