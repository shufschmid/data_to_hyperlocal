import type { Knex } from 'knex'

/**
 * A Meldung may now belong to a match instead of a run.
 *
 * Sport reports are Meldungen like any other: the newsroom reviews them,
 * revises them by chat, sends them out to be counter-checked and publishes them
 * to the Dorfkönig. Giving them their own collection would have meant building
 * that whole editorial machinery a second time, so they join the existing one.
 *
 * What that costs is two constraints:
 *
 * - `lauf` becomes nullable. A match report has no run — it is written from one
 *   fixture, not from a dataset period. The statistics queue is unaffected
 *   because it only ever picks up rows it queued itself (`verarbeitung` =
 *   `geplant`), and a match report is stored finished.
 * - `unique(lauf, gemeinde)` cannot stand, since every match report in a
 *   municipality would collide. It is replaced by two partial indexes that say
 *   the same thing per source: one article per run and municipality, one per
 *   match.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('meldungen', (table) => {
    table.dropUnique(['lauf', 'gemeinde'])
    table.uuid('lauf').nullable().alter()
    table.uuid('spiel').references('id').inTable('spiele').onDelete('CASCADE')
  })

  // Partial indexes, so each kind of Meldung keeps its own uniqueness without
  // the other kind's NULLs colliding.
  await knex.raw(
    'CREATE UNIQUE INDEX meldungen_lauf_gemeinde_uniq ON meldungen (lauf, gemeinde) WHERE lauf IS NOT NULL'
  )
  await knex.raw(
    'CREATE UNIQUE INDEX meldungen_spiel_uniq ON meldungen (spiel) WHERE spiel IS NOT NULL'
  )

  await knex('directus_relations').insert({
    many_collection: 'meldungen',
    many_field: 'spiel',
    one_collection: 'spiele',
    one_field: null,
    one_collection_field: null,
    one_allowed_collections: null,
    junction_field: null,
    sort_field: null,
    one_deselect_action: 'nullify'
  })

  await knex('directus_fields').insert({
    collection: 'meldungen',
    field: 'spiel',
    special: 'm2o',
    interface: 'select-dropdown-m2o',
    options: JSON.stringify({ template: '{{ heim }} – {{ gast }}' }),
    display: 'related-values',
    display_options: JSON.stringify({ template: '{{ heim }} – {{ gast }}' }),
    readonly: true,
    note: 'Gesetzt, wenn die Meldung ein Spielbericht ist. Dann ist "Lauf" leer.',
    sort: 3,
    width: 'half'
  })
}

export async function down(knex: Knex): Promise<void> {
  // Match reports have no run to fall back on, so they cannot survive a
  // non-null `lauf`. Removing them is the only honest reversal.
  await knex('meldungen').whereNotNull('spiel').delete()

  await knex('directus_fields')
    .where({ collection: 'meldungen', field: 'spiel' })
    .delete()
  await knex('directus_relations')
    .where({ many_collection: 'meldungen', many_field: 'spiel' })
    .delete()

  await knex.raw('DROP INDEX IF EXISTS meldungen_spiel_uniq')
  await knex.raw('DROP INDEX IF EXISTS meldungen_lauf_gemeinde_uniq')

  await knex.schema.alterTable('meldungen', (table) => {
    table.dropColumn('spiel')
    table.uuid('lauf').notNullable().alter()
    table.unique(['lauf', 'gemeinde'])
  })
}
