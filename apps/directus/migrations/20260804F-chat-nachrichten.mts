import type { Knex } from 'knex'

/**
 * The editorial conversation, persisted.
 *
 * Two scopes share one table because the turns are identical in shape and the
 * chat component is the same on both sides:
 *   - a run-scoped thread revises every article at once
 *   - a message-scoped thread revises exactly one
 *
 * Exactly one of `lauf` / `meldung` is set, and that is a database CHECK rather
 * than a rule in a handler: this table is written from the endpoint, from the
 * queue, and potentially by hand in the admin UI, and an invariant that only
 * holds on one of those paths is not an invariant.
 *
 * `position` exists because `date_created` alone is not an ordering. A user turn
 * and the assistant reply that follows can land in the same millisecond, and a
 * chat that renders its turns in a different order on every reload is worse than
 * useless.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('chat_nachrichten', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.uuid('lauf').references('id').inTable('laeufe').onDelete('CASCADE')
    table
      .uuid('meldung')
      .references('id')
      .inTable('meldungen')
      .onDelete('CASCADE')
    table.string('rolle', 16).notNullable()
    table.text('inhalt').notNullable()
    table.integer('position').notNullable().defaultTo(0)
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
  })

  await knex.raw(`
    ALTER TABLE chat_nachrichten
    ADD CONSTRAINT chat_nachrichten_genau_ein_bezug
    CHECK ((lauf IS NOT NULL) <> (meldung IS NOT NULL))
  `)

  await knex('directus_collections').insert({
    collection: 'chat_nachrichten',
    icon: 'forum',
    note: 'Verlauf der Redaktionsgespraeche. Quelle fuer das Gedaechtnis in redaktionswissen.',
    display_template: '{{ rolle }}: {{ inhalt }}',
    sort_field: 'position',
    archive_field: null,
    archive_value: null,
    unarchive_value: null,
    archive_app_filter: true,
    accountability: 'all',
    singleton: false,
    hidden: false,
    collapse: 'open',
    versioning: false
  })

  await knex('directus_relations').insert([
    {
      many_collection: 'chat_nachrichten',
      many_field: 'lauf',
      one_collection: 'laeufe',
      one_field: null,
      one_collection_field: null,
      one_allowed_collections: null,
      junction_field: null,
      sort_field: null,
      one_deselect_action: 'nullify'
    },
    {
      many_collection: 'chat_nachrichten',
      many_field: 'meldung',
      one_collection: 'meldungen',
      one_field: null,
      one_collection_field: null,
      one_allowed_collections: null,
      junction_field: null,
      sort_field: null,
      one_deselect_action: 'nullify'
    }
  ])

  await knex('directus_fields').insert([
    {
      collection: 'chat_nachrichten',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'chat_nachrichten',
      field: 'lauf',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ periode }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ periode }}' }),
      note: 'Gesetzt, wenn das Gespraech den ganzen Lauf betrifft.',
      readonly: true,
      sort: 2,
      width: 'half'
    },
    {
      collection: 'chat_nachrichten',
      field: 'meldung',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ titel }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ titel }}' }),
      note: 'Gesetzt, wenn das Gespraech nur eine Meldung betrifft.',
      readonly: true,
      sort: 3,
      width: 'half'
    },
    {
      collection: 'chat_nachrichten',
      field: 'rolle',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Redaktion', value: 'user' },
          { text: 'Assistenz', value: 'assistant' }
        ]
      }),
      display: 'labels',
      required: true,
      readonly: true,
      sort: 4,
      width: 'half'
    },
    {
      collection: 'chat_nachrichten',
      field: 'position',
      interface: 'input',
      note: 'Reihenfolge innerhalb des Gespraechs.',
      required: true,
      readonly: true,
      sort: 5,
      width: 'half'
    },
    {
      collection: 'chat_nachrichten',
      field: 'inhalt',
      interface: 'input-multiline',
      required: true,
      readonly: true,
      sort: 6,
      width: 'full'
    },
    {
      collection: 'chat_nachrichten',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      sort: 7,
      width: 'half'
    }
  ])
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields')
    .where({ collection: 'chat_nachrichten' })
    .delete()
  await knex('directus_relations')
    .where({ many_collection: 'chat_nachrichten' })
    .delete()
  await knex('directus_collections')
    .where({ collection: 'chat_nachrichten' })
    .delete()
  await knex.schema.dropTableIfExists('chat_nachrichten')
}
