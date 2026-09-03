import type { Knex } from 'knex'

/**
 * The source rows the two desk feeds hang their freshness on — row data, no
 * structure.
 *
 * `quellen` carries one row per adapter; the workspace banner reads
 * `letzte_pruefung`/`letzter_fehler` from it, and `amtsblatt-pruefen` stamps it
 * at the end of every run. The seed migration (`20260824A-stammdaten.mts`) only
 * ever seeded `ods`, `agenda` and `statbl` — the gazette row was added by hand
 * on the development database and therefore never existed on a fresh install,
 * where the run silently found no row to stamp and the banner stayed blank.
 *
 * So this seeds BOTH: the new `simap` row, and the `amtsblatt` row that was
 * missing all along.
 *
 * Insert-only and guarded by `typ`, exactly like the QUELLEN block in the
 * stammdaten migration: one source row per adapter is the invariant the
 * connectors dispatch on, and an editor's later edits (a renamed source, a
 * deactivated one) must survive every redeploy.
 */

const QUELLEN: ReadonlyArray<{
  name: string
  typ: string
  basis_url: string
  konfiguration: null
  aktiv: boolean
}> = [
  {
    name: 'Amtsblattportal (Bund und Kantone)',
    typ: 'amtsblatt',
    basis_url: 'https://amtsblattportal.ch',
    konfiguration: null,
    aktiv: true
  },
  {
    name: 'simap.ch — oeffentliche Beschaffungen',
    typ: 'simap',
    basis_url: 'https://www.simap.ch',
    konfiguration: null,
    aktiv: true
  }
]

export async function up(knex: Knex): Promise<void> {
  const hatTabelle = await knex.schema.hasTable('quellen')
  if (!hatTabelle) return

  const vorhandeneTypen: string[] = await knex('quellen')
    .whereIn(
      'typ',
      QUELLEN.map((quelle) => quelle.typ)
    )
    .pluck('typ')

  const fehlende = QUELLEN.filter(
    (quelle) => !vorhandeneTypen.includes(quelle.typ)
  )
  if (fehlende.length > 0) {
    await knex('quellen').insert(fehlende)
    console.log(`Quellen: ${fehlende.map((q) => q.typ).join(', ')} angelegt.`)
  }
}

export async function down(): Promise<void> {
  // Deliberately empty. Deleting a source row would take an editor's own
  // settings and the feed's freshness history with it, and a row nobody
  // dispatches on costs nothing.
}
