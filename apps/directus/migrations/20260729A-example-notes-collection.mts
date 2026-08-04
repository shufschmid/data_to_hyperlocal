import type { Knex } from 'knex'

/**
 * Example migration — the template's demo collection.
 *
 * It exists so a fresh `docker compose up` produces a database the frontend can
 * actually read from. Delete it once you have your own collections.
 *
 * Note which mechanism does what (see apps/directus/CLAUDE.md):
 *   - Everyday data-model work happens in the Directus admin UI and is then
 *     committed with `npm run schema:dump` (directus-sync writes ./schema).
 *   - Migrations like this one are for changes that must be reproducible
 *     without a human clicking through the UI: bootstrapping a collection on
 *     a fresh install, backfills, data repairs, non-Directus tables.
 *
 * A migration that creates a table has to register it as a collection too. The
 * table alone is enough for REST and GraphQL — Directus reads the schema from the
 * database — but the admin UI only lists collections that have a
 * `directus_collections` row, and it renders plain text inputs for fields with no
 * `directus_fields` row. Creating a table without those rows gives you a
 * collection your colleagues cannot see or edit.
 *
 * This is the reason for the ownership rule: whichever mechanism creates a
 * collection also owns its metadata. Never split the two.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notes', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.string('status', 32).notNullable().defaultTo('draft')
    table.string('title', 255).notNullable()
    table.text('body')
    // Written by the notes-summary endpoint and the notes-summarize-pending
    // operation, never by hand — see extensions/app/src/endpoints/notes-summary.
    //
    // The tags get their own column rather than being packed into the summary
    // text: a derived value that the UI has to parse back apart is a
    // serialisation format implemented twice, and the two copies drift. Directus
    // exposes a text column with `special: cast-csv` as a real `[String]` in
    // REST and GraphQL, so both sides see a list without any parsing.
    table.text('ai_summary')
    table.text('ai_summary_tags')
    table.timestamp('ai_summary_generated_at', { useTz: true })
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })
  })

  // Makes the collection appear in the admin UI under Content.
  await knex('directus_collections').insert({
    collection: 'notes',
    icon: 'sticky_note_2',
    note: 'Beispiel-Collection der Vorlage: Notizen mit KI-Zusammenfassung.',
    display_template: '{{ title }}',
    sort_field: null,
    archive_field: 'status',
    archive_value: 'archived',
    unarchive_value: 'draft',
    archive_app_filter: true,
    accountability: 'all',
    singleton: false,
    hidden: false,
    collapse: 'open',
    versioning: false
  })

  // Field metadata: interfaces, order, and the two `special` flags that make
  // Directus maintain the timestamps itself.
  //
  // `special` is a comma-separated string, and the JSON columns must be passed as
  // JSON strings — knex does not serialise a plain object into a `json` column.
  await knex('directus_fields').insert([
    {
      collection: 'notes',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'notes',
      field: 'status',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Entwurf', value: 'draft' },
          { text: 'Veroeffentlicht', value: 'published' },
          { text: 'Archiviert', value: 'archived' }
        ]
      }),
      display: 'labels',
      display_options: JSON.stringify({
        showAsDot: true,
        choices: [
          {
            text: 'Entwurf',
            value: 'draft',
            foreground: '#FFFFFF',
            background: '#A2B5CD'
          },
          {
            text: 'Veroeffentlicht',
            value: 'published',
            foreground: '#FFFFFF',
            background: '#2ECDA7'
          },
          {
            text: 'Archiviert',
            value: 'archived',
            foreground: '#FFFFFF',
            background: '#A2B5CD'
          }
        ]
      }),
      sort: 2,
      width: 'full'
    },
    {
      collection: 'notes',
      field: 'title',
      interface: 'input',
      options: JSON.stringify({ placeholder: 'Titel der Notiz' }),
      required: true,
      sort: 3,
      width: 'full'
    },
    {
      collection: 'notes',
      field: 'body',
      interface: 'input-multiline',
      sort: 4,
      width: 'full'
    },
    {
      collection: 'notes',
      field: 'ai_summary',
      interface: 'input-multiline',
      note: 'Wird von der Claude-Zusammenfassung geschrieben. Nicht von Hand aendern — eine Textaenderung loescht sie automatisch.',
      readonly: true,
      sort: 5,
      width: 'full'
    },
    {
      collection: 'notes',
      field: 'ai_summary_tags',
      // `cast-csv` is what turns the text column into a string array everywhere:
      // admin UI, REST, GraphQL and the ItemsService all see string[].
      special: 'cast-csv',
      interface: 'tags',
      options: JSON.stringify({ allowCustom: false }),
      display: 'labels',
      note: 'Von der Claude-Zusammenfassung vergeben.',
      readonly: true,
      sort: 6,
      width: 'full'
    },
    {
      collection: 'notes',
      field: 'ai_summary_generated_at',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      sort: 7,
      width: 'half'
    },
    {
      collection: 'notes',
      field: 'date_created',
      // `date-created` / `date-updated` make Directus fill these on every write,
      // through any interface — admin UI, REST, GraphQL or an extension.
      special: 'date-created',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 8,
      width: 'half'
    },
    {
      collection: 'notes',
      field: 'date_updated',
      special: 'date-updated',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 9,
      width: 'half'
    }
  ])
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields').where({ collection: 'notes' }).delete()
  await knex('directus_collections').where({ collection: 'notes' }).delete()
  await knex.schema.dropTableIfExists('notes')
}
