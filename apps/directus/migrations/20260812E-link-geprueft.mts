import type { Knex } from 'knex'

// Remembering that an agenda entry's link has been followed.
//
// The step that takes up directly linked portal tables selected on "published,
// no dataset yet, link points at statistik.bl.ch". That is the same
// head-of-line blocking as in `eroeffneLaeufe`, one layer up: an entry whose
// table turns out to have no municipality breakdown — "Staatsfinanzen 2025",
// "Verkehrsunfälle 2025" — keeps `datensatz` null for ever and therefore keeps
// its seat in every run, while the older entries behind it are never reached.
//
// `zuordnung_geprueft` cannot serve here: entries the model looked at before
// this step existed carry it, and those are exactly the ones whose links still
// need following — "Wasserstatistik 2024" points at table 2_3 and was written
// off as "kein passender Datensatz".

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ankuendigungen', (table) => {
    table.timestamp('link_geprueft', { useTz: true })
  })

  await knex('directus_fields').insert({
    collection: 'ankuendigungen',
    field: 'link_geprueft',
    interface: 'datetime',
    display: 'datetime',
    display_options: JSON.stringify({ relative: true }),
    note: 'Wann dem Link dieses Eintrags zuletzt gefolgt wurde. Leeren, um es erneut zu versuchen.',
    sort: 16,
    width: 'half'
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields')
    .where({ collection: 'ankuendigungen', field: 'link_geprueft' })
    .delete()

  await knex.schema.alterTable('ankuendigungen', (table) => {
    table.dropColumn('link_geprueft')
  })
}
