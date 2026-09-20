import type { Knex } from 'knex'

/**
 * Veranstaltungen become a desk of their own: one row per ANLASS in
 * `veranstaltungen`, and the calendars a municipality reads in
 * `veranstaltungsquellen` — a LIST per municipality, because the measurement
 * of 17–20 September 2026 over all ten showed that the municipality's own
 * calendar is only one of several (Aesch's village life is on Crossiety,
 * Allschwil's on kallaender.ch, Riehen's on riehenevents.ch, Pratteln's
 * concerts at the Z7), and two columns on `gemeinden` cannot hold that.
 *
 * Three unmanaged indexes, then one row move:
 *
 * - `(quelle, schluessel)` is the identity of an Anlass — the series key,
 *   readable, not hashed — so a second run upserts instead of doubling.
 * - `(gemeinde, url)` keeps one calendar from being registered twice.
 * - The partial unique on `meldungen.veranstaltung` mirrors the endpoint's
 *   guard exactly as `20260914A` did for `gemeindemitteilung`: one Meldung
 *   per Anlass, discarded ones excepted.
 *
 * Then every `gemeinden.veranstaltungen_url` that `20260918A` seeded (or an
 * editor entered since) becomes a `veranstaltungsquellen` row of `art:
 * gemeinde`. The column itself STAYS for now, hidden in the admin UI: the
 * boot order in `docker/entrypoint.sh` pushes the schema BEFORE it runs the
 * migrations, so a column dropped from the snapshot in this same release
 * would be gone before this migration could read it. It is dropped in a later
 * release, once every instance has been through here.
 *
 * Idempotent: the indexes are `IF NOT EXISTS`, the rows `ON CONFLICT DO
 * NOTHING` on the `(gemeinde, url)` index. Runs after the schema push on
 * every boot.
 */

const INDIZES: ReadonlyArray<string> = [
  'CREATE UNIQUE INDEX IF NOT EXISTS veranstaltungen_quelle_schluessel_uniq ON veranstaltungen (quelle, schluessel)',
  'CREATE UNIQUE INDEX IF NOT EXISTS veranstaltungsquellen_gemeinde_url_uniq ON veranstaltungsquellen (gemeinde, url)',
  "CREATE UNIQUE INDEX IF NOT EXISTS meldungen_veranstaltung_uniq ON meldungen (veranstaltung) WHERE veranstaltung IS NOT NULL AND status <> 'verworfen'"
]

interface GemeindeZeile {
  id: string
  name: string
  veranstaltungen_url: string | null
}

export async function up(knex: Knex): Promise<void> {
  const hatQuellen = await knex.schema.hasTable('veranstaltungsquellen')
  const hatAnlaesse = await knex.schema.hasTable('veranstaltungen')
  if (!hatQuellen || !hatAnlaesse) {
    console.log(
      'Veranstaltungen: Tabellen fehlen noch — Schema zuerst laden, die Migration holt beim naechsten Start nach.'
    )
    return
  }

  for (const anweisung of INDIZES) {
    await knex.raw(anweisung)
  }

  const hatSpalte = await knex.schema.hasColumn(
    'gemeinden',
    'veranstaltungen_url'
  )
  if (!hatSpalte) return

  const gemeinden = await knex<GemeindeZeile>('gemeinden')
    .select('id', 'name', 'veranstaltungen_url')
    .whereNotNull('veranstaltungen_url')

  let angelegt = 0
  for (const gemeinde of gemeinden) {
    const url = gemeinde.veranstaltungen_url?.trim() ?? ''
    if (url === '') continue
    const zeilen = await knex('veranstaltungsquellen')
      .insert({
        id: knex.raw('gen_random_uuid()'),
        gemeinde: gemeinde.id,
        name: `Veranstaltungskalender der Gemeinde ${gemeinde.name}`,
        url,
        art: 'gemeinde',
        aktiv: true,
        date_created: knex.fn.now()
      })
      .onConflict(['gemeinde', 'url'])
      .ignore()
      .returning('id')
    angelegt += zeilen.length
  }
  if (angelegt > 0)
    console.log(
      `Veranstaltungen: ${angelegt} Kalender aus gemeinden.veranstaltungen_url uebernommen.`
    )
}

export async function down(knex: Knex): Promise<void> {
  // The calendar rows stay: by now they carry the editor's own settings and
  // the run's status lines, and the source column still holds the address
  // they came from. Only the indexes go.
  for (const name of [
    'meldungen_veranstaltung_uniq',
    'veranstaltungsquellen_gemeinde_url_uniq',
    'veranstaltungen_quelle_schluessel_uniq'
  ]) {
    await knex.raw(`DROP INDEX IF EXISTS ${name}`)
  }
}
