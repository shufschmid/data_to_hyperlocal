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
 *
 * And it is REVERSIBLE, unlike its neighbours: `down` removes exactly the one
 * row `up` created and clears the backfill only where it is still verbatim
 * what `up` wrote. That is possible here because nothing outside this file
 * depends on either — the code falls back to Baselland when the configuration
 * is empty, so a rollback costs a source line its office name and an article
 * nothing at all.
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

export async function down(knex: Knex): Promise<void> {
  const hatTabelle = await knex.schema.hasTable('quellen')
  if (!hatTabelle) return

  // The new row goes again — but only if it is still the untouched row `up`
  // wrote. Matched on the exact address, never on a pattern: `data.bs.ch` is
  // one row and a LIKE over the host would take a second portal somebody
  // registered beside it.
  const bsZeile = (await knex('quellen')
    .where({ basis_url: BS_PORTAL.basis_url, typ: BS_PORTAL.typ })
    .first()) as { id?: string } | undefined

  if (bsZeile?.id !== undefined) {
    // Datasets outlive a rollback. If the editor switched the portal on and a
    // catalogue run hung datasets off it, deleting the source would orphan
    // them — or be refused by the foreign key, which fails the whole
    // migration. Leaving the row is the smaller harm, and saying so is the
    // point: a rollback that quietly did less than it claims is worse than
    // one that reports what it left standing.
    const hatDatensaetze = await knex.schema.hasTable('datensaetze')
    const daran = hatDatensaetze
      ? await knex('datensaetze').where({ quelle: bsZeile.id }).first()
      : undefined

    if (daran === undefined) {
      await knex('quellen').where({ id: bsZeile.id }).del()
      console.log('Quellen: data.bs.ch wieder entfernt.')
    } else {
      console.log(
        'Quellen: data.bs.ch bleibt stehen — es haengen bereits Datensaetze daran.'
      )
    }
  }

  // The backfill goes too, but only where it is still verbatim what `up`
  // wrote. An editor who corrected an office name or a district list keeps
  // that correction: `up` only ever filled an EMPTY field, so anything else
  // standing there was never ours to clear.
  for (const eintrag of NACHTRAG) {
    const zeile = (await knex('quellen')
      .where({ typ: eintrag.typ, basis_url: eintrag.basisUrl })
      .first()) as { id?: string; konfiguration?: unknown } | undefined

    if (zeile?.id === undefined) continue

    // The column is `json`, so Postgres has no `=` for it — compared in JS,
    // which also spares us a dialect-specific cast.
    const gespeichert =
      typeof zeile.konfiguration === 'string'
        ? sicheresJson(zeile.konfiguration)
        : zeile.konfiguration

    if (JSON.stringify(gespeichert) === JSON.stringify(eintrag.konfiguration)) {
      await knex('quellen')
        .where({ id: zeile.id })
        .update({ konfiguration: null })
      console.log(
        `Quellen: Portalangaben fuer ${eintrag.basisUrl} wieder geleert.`
      )
    }
  }
}

function sicheresJson(wert: string): unknown {
  try {
    return JSON.parse(wert)
  } catch {
    // Not ours, then. A blob we cannot read is a blob we must not clear.
    return undefined
  }
}
