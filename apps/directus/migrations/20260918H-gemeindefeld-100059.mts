import type { Knex } from 'knex'

/**
 * Seed: dataset 100059 gets told which column names the municipality.
 *
 * `20260918E` switched Basel-Stadt on but could not do this, and said so: the
 * field hangs on the DATASET ROW, and that row does not exist until the
 * catalogue has been read once. So this file is deliberately a second
 * migration on a second deploy, and it only works if a run happened in
 * between. If it did not, the file says so in the boot log rather than
 * passing in silence, and it can be re-applied by hand from the dataset card.
 *
 * **Why the column has to be named at all.** Both branches of
 * `detectMunicipalityFields` miss it, and for two independent reasons measured
 * on 17 September 2026: Basel-Stadt ships no field descriptions, so the
 * annotated branch finds nothing, and its own `gemeinde` column carries the
 * CANTON's code (Basel 10, Riehen 20, Bettingen 30) rather than the BFS
 * number, so the numeric branch would match the wrong thing rather than
 * nothing. `gemeindename` is joined by name onto BFS 2703 by
 * `matchMunicipalities`, a mechanism that already existed and needed no change.
 *
 * Written only where the field is still empty: an editor who has named another
 * column keeps that.
 */

const PORTAL = 'https://data.bs.ch'
const DATENSATZ = '100059'
const SPALTE = 'gemeindename'

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('datensaetze'))) return
  if (!(await knex.schema.hasColumn('datensaetze', 'gemeindefeld'))) return

  const portal = (await knex('quellen')
    .where({ typ: 'ods', basis_url: PORTAL })
    .first('id')) as { id: string } | undefined
  if (portal === undefined) {
    console.warn(
      `Statistik: Quelle ${PORTAL} fehlt, ${DATENSATZ} nicht angefasst.`
    )
    return
  }

  const gesetzt = await knex('datensaetze')
    .where({ quelle: portal.id, externe_id: DATENSATZ })
    .where((q) => q.whereNull('gemeindefeld').orWhere('gemeindefeld', ''))
    .update({ gemeindefeld: SPALTE })

  if (gesetzt > 0)
    console.log(`Statistik: ${DATENSATZ} kennt jetzt seine Gemeindespalte.`)
  else
    console.warn(
      `Statistik: Datensatz ${DATENSATZ} von ${PORTAL} nicht gefunden oder schon gesetzt. ` +
        'Wurde der Katalog seit dem Einschalten einmal gelesen? Sonst von Hand in der Karte nachtragen.'
    )
}

export async function down(knex: Knex): Promise<void> {
  // Clears exactly what up() wrote. A column an editor has named differently
  // does not match and stays.
  if (!(await knex.schema.hasTable('datensaetze'))) return

  const portal = (await knex('quellen')
    .where({ typ: 'ods', basis_url: PORTAL })
    .first('id')) as { id: string } | undefined
  if (portal === undefined) return

  await knex('datensaetze')
    .where({ quelle: portal.id, externe_id: DATENSATZ, gemeindefeld: SPALTE })
    .update({ gemeindefeld: null })
}
