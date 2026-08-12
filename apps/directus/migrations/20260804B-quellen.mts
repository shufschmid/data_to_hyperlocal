import type { Knex } from 'knex'

/**
 * The raw-data sources «Die Redaktion» watches.
 *
 * A row is a portal, not a single dataset — the scheduled check asks the portal
 * what changed and records the individual datasets in `datensaetze`.
 *
 * Seeded with data.bl.ch, which is an Opendatasoft portal: its Explore API v2.1
 * serves the catalogue and the records as plain JSON over HTTPS, with field
 * metadata that says whether a dataset is broken down by municipality. That is
 * why this application needs no scraper and no headless browser.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('quellen', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.string('name', 120).notNullable()
    // The adapter in extensions/app/src/shared that knows how to talk to this
    // portal. Adding a source of a new kind means adding an adapter, not a
    // column.
    table.string('typ', 32).notNullable().defaultTo('ods')
    table.string('basis_url', 255).notNullable()
    table.json('konfiguration')
    table.boolean('aktiv').notNullable().defaultTo(true)
    table.timestamp('letzte_pruefung', { useTz: true })
    table.text('letzter_fehler')
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })
  })

  await knex('directus_collections').insert({
    collection: 'quellen',
    icon: 'database',
    note: 'Datenportale, die regelmaessig auf neue Datensaetze geprueft werden.',
    display_template: '{{ name }}',
    sort_field: 'name',
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

  await knex('directus_fields').insert([
    {
      collection: 'quellen',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'quellen',
      field: 'name',
      interface: 'input',
      required: true,
      sort: 2,
      width: 'full'
    },
    {
      collection: 'quellen',
      field: 'typ',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [{ text: 'Opendatasoft-Portal', value: 'ods' }]
      }),
      display: 'labels',
      note: 'Bestimmt, welcher Adapter die Quelle abfragt.',
      required: true,
      sort: 3,
      width: 'half'
    },
    {
      collection: 'quellen',
      field: 'basis_url',
      interface: 'input',
      options: JSON.stringify({ placeholder: 'https://data.bl.ch' }),
      note: 'Ohne abschliessenden Schraegstrich.',
      required: true,
      sort: 4,
      width: 'half'
    },
    {
      collection: 'quellen',
      field: 'konfiguration',
      special: 'cast-json',
      interface: 'input-code',
      options: JSON.stringify({ language: 'json' }),
      note: 'Adapterspezifische Optionen. Leer lassen, wenn nichts einzustellen ist.',
      sort: 5,
      width: 'full'
    },
    {
      collection: 'quellen',
      field: 'aktiv',
      interface: 'boolean',
      display: 'boolean',
      note: 'Inaktive Quellen werden vom geplanten Lauf uebersprungen.',
      sort: 6,
      width: 'half'
    },
    {
      collection: 'quellen',
      field: 'letzte_pruefung',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      note: 'Wird vom geplanten Lauf gesetzt.',
      readonly: true,
      sort: 7,
      width: 'half'
    },
    {
      collection: 'quellen',
      field: 'letzter_fehler',
      interface: 'input-multiline',
      note: 'Leer, solange die letzte Pruefung durchlief.',
      readonly: true,
      sort: 8,
      width: 'full'
    },
    {
      collection: 'quellen',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 9,
      width: 'half'
    },
    {
      collection: 'quellen',
      field: 'date_updated',
      special: 'date-updated',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 10,
      width: 'half'
    }
  ])

  await knex('quellen').insert({
    name: 'Statistik Basel-Landschaft (data.bl.ch)',
    typ: 'ods',
    basis_url: 'https://data.bl.ch',
    konfiguration: null,
    aktiv: true
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields').where({ collection: 'quellen' }).delete()
  await knex('directus_collections').where({ collection: 'quellen' }).delete()
  await knex.schema.dropTableIfExists('quellen')
}
