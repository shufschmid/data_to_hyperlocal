import type { Knex } from 'knex'

/**
 * Which canton a statistics portal speaks for — row data, no structure.
 *
 * Until 17 September 2026 two cantonal facts lived in the code: the address
 * `data.bl.ch` was interpolated into every statistics article's source link
 * (`redaktion/quelle.ts`), and the five Basel-Landschaft districts were a
 * `Set` in the workspace that decided whether a municipality could ever get a
 * statistics article at all. Both are now read from the source row that a
 * dataset already points at — `basis_url` for the address, `konfiguration` for
 * the office and the districts.
 *
 * So this migration moves those two facts out of the code and into the rows,
 * and registers the second portal.
 *
 * `data.bs.ch` arrives INACTIVE on purpose. It is the same Opendatasoft
 * platform on the same paths (measured 17 September 2026: the catalogue
 * answers `total_count` + `results` exactly as data.bl.ch does, 361 datasets
 * against 188, and `/explore/dataset/<id>/` redirects to `/explore/assets/<id>/`
 * on both), and dataset 100059 "Wohnbevoelkerung nach Staatsangehoerigkeit und
 * Gemeinde" carries a `gemeindename` column with 27 Riehen rows. But switching
 * a new host on means a daily outbound request in Bajour's production, and
 * that is an operator's decision, not a migration's. Saemi flips `aktiv` in
 * the admin UI.
 *
 * Two more things measured on that portal and worth knowing before the switch:
 * its `gemeinde` column is the CANTON's own code (Basel 10, Riehen 20,
 * Bettingen 30), not the BFS number, and its field descriptions are empty —
 * so neither branch of `detectMunicipalityFields` finds the column by itself.
 * The editor names `gemeindename` in `datensaetze.gemeindefeld`, and
 * `matchMunicipalities` joins it by name onto BFS 2703. That mechanism
 * already exists and needed no change.
 *
 * Insert-only and update-only-where-empty, like every other seed here: an
 * editor who corrects a district list or an office name keeps that correction
 * across every redeploy.
 */

/** `gemeinden.bezirk` of the five Basel-Landschaft districts. */
const BL_BEZIRKE = ['Arlesheim', 'Laufen', 'Liestal', 'Sissach', 'Waldenburg']

const AMT_BL = 'Statistisches Amt Basel-Landschaft'

/** Backfill for the two source rows the stammdaten migration already seeded. */
const NACHTRAG: ReadonlyArray<{
  typ: string
  basisUrl: string
  konfiguration: { amt: string; bezirke: string[] }
}> = [
  {
    typ: 'ods',
    basisUrl: 'https://data.bl.ch',
    konfiguration: { amt: AMT_BL, bezirke: BL_BEZIRKE }
  },
  {
    typ: 'statbl',
    basisUrl: 'https://statistik.bl.ch/web_portal/',
    konfiguration: { amt: AMT_BL, bezirke: BL_BEZIRKE }
  }
]

const BS_PORTAL = {
  name: 'Statistik Basel-Stadt (data.bs.ch)',
  typ: 'ods',
  basis_url: 'https://data.bs.ch',
  konfiguration: JSON.stringify({
    amt: 'Statistisches Amt des Kantons Basel-Stadt',
    bezirke: ['Basel-Stadt']
  }),
  aktiv: false
}

export async function up(knex: Knex): Promise<void> {
  const hatTabelle = await knex.schema.hasTable('quellen')
  if (!hatTabelle) return

  for (const eintrag of NACHTRAG) {
    const betroffen = await knex('quellen')
      .where({ typ: eintrag.typ, basis_url: eintrag.basisUrl })
      .whereNull('konfiguration')
      .update({ konfiguration: JSON.stringify(eintrag.konfiguration) })

    if (betroffen > 0) {
      console.log(
        `Quellen: Portalangaben fuer ${eintrag.basisUrl} nachgetragen.`
      )
    }
  }

  // Guarded by the ADDRESS, not by the type: from here on there may be several
  // `ods` rows, one per portal, and that is the whole point of the change.
  const schonDa = await knex('quellen')
    .where({ basis_url: BS_PORTAL.basis_url })
    .first()

  if (schonDa === undefined) {
    await knex('quellen').insert(BS_PORTAL)
    console.log(
      'Quellen: data.bs.ch angelegt (inaktiv, wartet auf eine Person).'
    )
  }
}

export async function down(): Promise<void> {
  // Deliberately empty. Deleting a source row would take an editor's own
  // settings and the feed's freshness history with it, and an inactive row
  // nobody dispatches on costs nothing.
}
