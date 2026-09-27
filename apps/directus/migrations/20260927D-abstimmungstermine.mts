import type { Knex } from 'knex'

/**
 * Seed: where the Bund's coming vote days are read, on the data.bl.ch row.
 *
 * The newsroom wants the vote days on the desk before they arrive, like the
 * agenda's announcements (27 September 2026). The Federal Chancellery's table
 * of Blanko-Termine is a LINDAS cube, read through its public SPARQL service
 * (`shared/abstimmung/termine.ts`). Which service belongs to a portal is a row
 * setting like the two beside it: `konfiguration.abstimmungen_termine`.
 *
 * Insert-only, like `20260927B`.
 */

const PORTAL = 'https://data.bl.ch'
const TERMINE = 'https://lindas.admin.ch/query'

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
    if ('abstimmungen_termine' in konfiguration) continue
    // Only a portal that reads votes at all gets the vote days beside it.
    if (typeof konfiguration['abstimmungen'] !== 'string') continue

    await knex('quellen')
      .where({ id: zeile.id })
      .update({
        konfiguration: JSON.stringify({
          ...konfiguration,
          abstimmungen_termine: TERMINE
        })
      })
    console.log(
      `Abstimmungen: Abstimmungstermine des Bundes ${TERMINE} an ${PORTAL} eingetragen.`
    )
  }
}

export async function down(knex: Knex): Promise<void> {
  // Reversible where the value is still verbatim what `up` wrote; the desk then
  // shows no coming vote days.
  if (!(await knex.schema.hasTable('quellen'))) return
  const zeilen = (await knex('quellen')
    .where({ typ: 'ods' })
    .whereLike('basis_url', `${PORTAL}%`)
    .select('id', 'konfiguration')) as Quellenzeile[]
  for (const zeile of zeilen) {
    const konfiguration = alsObjekt(zeile.konfiguration)
    if (konfiguration['abstimmungen_termine'] !== TERMINE) continue
    delete konfiguration['abstimmungen_termine']
    await knex('quellen')
      .where({ id: zeile.id })
      .update({ konfiguration: JSON.stringify(konfiguration) })
  }
}
