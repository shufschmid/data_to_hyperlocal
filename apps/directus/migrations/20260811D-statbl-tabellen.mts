import type { Knex } from 'knex'

// statistik.bl.ch as a fourth source, and the memory that goes with it.
//
// The open-data portal does not carry everything the office publishes:
// agriculture has no dataset there at all, while statistik.bl.ch has
// "Landwirtschaftsbetriebe nach Gemeinde" back to 2013 at a stable URL.
//
// A table registered here becomes an ordinary `datensaetze` row — same
// collection, same runs, same articles — because the adapter hands the pipeline
// records in the portal's own shape. What differs is only where the rows come
// from, and that is what `quellen.typ` selects.
//
// `standard_vorgabe` is the memory the newsroom asked for: the instruction that
// made this table worth reading stays with the dataset, so when next year's
// edition appears the run starts with the same brief instead of a blank one.
// Without it the daily check would open a run that writes something else than
// last year's article, from the same numbers.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('datensaetze', (table) => {
    table.text('standard_vorgabe')
  })

  await knex('directus_fields').insert({
    collection: 'datensaetze',
    field: 'standard_vorgabe',
    interface: 'input-multiline',
    note: 'Auftrag, den jeder neue Lauf zu diesem Datensatz erbt — auch der naechstes Jahr.',
    sort: 21,
    width: 'full'
  })

  await knex('directus_fields')
    .where({ collection: 'quellen', field: 'typ' })
    .update({
      options: JSON.stringify({
        choices: [
          { text: 'Opendatasoft-Portal', value: 'ods' },
          { text: 'Publikationsagenda (HTML)', value: 'agenda' },
          { text: 'Statistik-BL-Tabelle (HTML)', value: 'statbl' }
        ]
      })
    })

  // One source row for the whole table portal; each registered table is a
  // dataset under it, keyed by its portal id ("7_1_1_3"). Nothing is fetched
  // from here until a person pastes a URL — there is no crawling of this host.
  await knex('quellen').insert({
    name: 'Statistik BL — Tabellen',
    typ: 'statbl',
    basis_url: 'https://statistik.bl.ch/web_portal/',
    konfiguration: null,
    aktiv: true
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex('quellen').where({ typ: 'statbl' }).delete()

  await knex('directus_fields')
    .where({ collection: 'quellen', field: 'typ' })
    .update({
      options: JSON.stringify({
        choices: [
          { text: 'Opendatasoft-Portal', value: 'ods' },
          { text: 'Publikationsagenda (HTML)', value: 'agenda' }
        ]
      })
    })

  await knex('directus_fields')
    .where({ collection: 'datensaetze', field: 'standard_vorgabe' })
    .delete()

  await knex.schema.alterTable('datensaetze', (table) => {
    table.dropColumn('standard_vorgabe')
  })
}
