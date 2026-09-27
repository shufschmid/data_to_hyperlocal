import type { Knex } from 'knex'

/**
 * Seed: the Bund's vote-day results, on the data.bl.ch row.
 *
 * The vote-day summary (27 September 2026) says where a municipality voted
 * differently from Switzerland — never the national figures, only whether the
 * Bund accepted. That outcome comes from the Federal Chancellery's open data
 * (`ogd-static.voteinfo-app.ch`, one static JSON per vote day, no key), and
 * which file set belongs to a portal is a row setting like the live door
 * beside it: `konfiguration.abstimmungen_bund`.
 *
 * Insert-only, like `20260927B`.
 */

const PORTAL = 'https://data.bl.ch'
const BUND = 'https://ogd-static.voteinfo-app.ch/v1/ogd'

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
    if ('abstimmungen_bund' in konfiguration) continue
    // Only a portal that reads votes at all gets the Bund beside it.
    if (typeof konfiguration['abstimmungen'] !== 'string') continue

    await knex('quellen')
      .where({ id: zeile.id })
      .update({
        konfiguration: JSON.stringify({
          ...konfiguration,
          abstimmungen_bund: BUND
        })
      })
    console.log(
      `Abstimmungen: Ergebnisse des Bundes ${BUND} an ${PORTAL} eingetragen.`
    )
  }
}

export async function down(knex: Knex): Promise<void> {
  // Reversible where the value is still verbatim what `up` wrote; the summary then
  // simply compares with the canton alone.
  if (!(await knex.schema.hasTable('quellen'))) return
  const zeilen = (await knex('quellen')
    .where({ typ: 'ods' })
    .whereLike('basis_url', `${PORTAL}%`)
    .select('id', 'konfiguration')) as Quellenzeile[]
  for (const zeile of zeilen) {
    const konfiguration = alsObjekt(zeile.konfiguration)
    if (konfiguration['abstimmungen_bund'] !== BUND) continue
    delete konfiguration['abstimmungen_bund']
    await knex('quellen')
      .where({ id: zeile.id })
      .update({ konfiguration: JSON.stringify(konfiguration) })
  }
}
