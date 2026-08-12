import type { Knex } from 'knex'

/**
 * One row per dataset seen on a source, and the memory of what we already know
 * about it.
 *
 * This is also the template's first many-to-one, so it is worth spelling out.
 * A relation Directus can actually use needs **three** writes, not one:
 *
 *   1. the column, with a real foreign key constraint
 *   2. a `directus_relations` row — this is what `getSchema()` reads; without it
 *      GraphQL exposes a bare id instead of a nested object
 *   3. a `directus_fields` row with `special: 'm2o'`, or the admin UI renders a
 *      plain text input asking a human to paste a uuid
 *
 * The reverse side (an O2M on `quellen`) would be an alias field: a
 * `directus_fields` row with `special: 'o2m'` plus `one_field` on the relation,
 * and **no database column**. We do not need it here — the frontend reads from
 * the many side — so it is left out rather than added speculatively.
 *
 * The check that this is right is `npm run schema:dump && npm run schema:diff`
 * coming back empty: that proves the migration wrote what Directus itself would
 * have written through the admin UI.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('datensaetze', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    // Deleting a source should not silently drop what we learned from it.
    table
      .uuid('quelle')
      .references('id')
      .inTable('quellen')
      .onDelete('SET NULL')
    // The id the portal uses (e.g. "12060" for the waste statistics).
    table.string('externe_id', 120).notNullable()
    table.string('titel', 255).notNullable()
    table.text('beschreibung')
    table.timestamp('portal_modified', { useTz: true })
    // The portal's field list, kept so the generator can explain the columns
    // without a second round trip.
    table.json('felder')
    table.boolean('hat_gemeinde').notNullable().defaultTo(false)
    // A fingerprint of the actual content (row count + newest period), not just
    // the portal's `modified` timestamp: that one also moves when somebody fixes
    // a typo in the description, and re-running on those would mean articles
    // nobody asked for.
    table.string('letzter_stand', 120)
    table.string('status', 32).notNullable().defaultTo('neu')
    table.text('bewertung')
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })

    // One row per dataset per source — a repeated check must update, not append.
    table.unique(['quelle', 'externe_id'])
  })

  await knex('directus_collections').insert({
    collection: 'datensaetze',
    icon: 'dataset',
    note: 'Auf den Quellen gefundene Datensaetze. "Relevant" gibt einen frei, aus dem Meldungen erzeugt werden duerfen.',
    display_template: '{{ titel }}',
    sort_field: null,
    archive_field: 'status',
    archive_value: 'ignoriert',
    unarchive_value: 'neu',
    archive_app_filter: true,
    accountability: 'all',
    singleton: false,
    hidden: false,
    collapse: 'open',
    versioning: false
  })

  // Write 2 of 3. `one_field` stays null because there is no reverse alias on
  // `quellen`; `one_deselect_action` is NOT NULL in Directus, so omitting it
  // fails the insert rather than defaulting.
  await knex('directus_relations').insert({
    many_collection: 'datensaetze',
    many_field: 'quelle',
    one_collection: 'quellen',
    one_field: null,
    one_collection_field: null,
    one_allowed_collections: null,
    junction_field: null,
    sort_field: null,
    one_deselect_action: 'nullify'
  })

  await knex('directus_fields').insert([
    {
      collection: 'datensaetze',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      // Write 3 of 3. Without `special: 'm2o'` this is a text box.
      collection: 'datensaetze',
      field: 'quelle',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ name }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ name }}' }),
      readonly: true,
      sort: 2,
      width: 'half'
    },
    {
      collection: 'datensaetze',
      field: 'externe_id',
      interface: 'input',
      note: 'Id des Datensatzes im Portal.',
      required: true,
      readonly: true,
      sort: 3,
      width: 'half'
    },
    {
      collection: 'datensaetze',
      field: 'titel',
      interface: 'input',
      required: true,
      readonly: true,
      sort: 4,
      width: 'full'
    },
    {
      collection: 'datensaetze',
      field: 'beschreibung',
      interface: 'input-multiline',
      readonly: true,
      sort: 5,
      width: 'full'
    },
    {
      collection: 'datensaetze',
      field: 'status',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Neu', value: 'neu' },
          { text: 'Relevant', value: 'relevant' },
          { text: 'Ignoriert', value: 'ignoriert' },
          { text: 'Aufbereitet', value: 'aufbereitet' }
        ]
      }),
      display: 'labels',
      display_options: JSON.stringify({
        showAsDot: true,
        choices: [
          {
            text: 'Neu',
            value: 'neu',
            foreground: '#FFFFFF',
            background: '#FFA439'
          },
          {
            text: 'Relevant',
            value: 'relevant',
            foreground: '#FFFFFF',
            background: '#2ECDA7'
          },
          {
            text: 'Ignoriert',
            value: 'ignoriert',
            foreground: '#FFFFFF',
            background: '#A2B5CD'
          },
          {
            text: 'Aufbereitet',
            value: 'aufbereitet',
            foreground: '#FFFFFF',
            background: '#3399FF'
          }
        ]
      }),
      sort: 6,
      width: 'half'
    },
    {
      collection: 'datensaetze',
      field: 'hat_gemeinde',
      interface: 'boolean',
      display: 'boolean',
      note: 'Aus den Feld-Metadaten des Portals erkannt, nicht geraten.',
      readonly: true,
      sort: 7,
      width: 'half'
    },
    {
      collection: 'datensaetze',
      field: 'bewertung',
      interface: 'input-multiline',
      note: 'Einschaetzung der Redaktions-KI, warum der Datensatz relevant ist oder nicht.',
      readonly: true,
      sort: 8,
      width: 'full'
    },
    {
      collection: 'datensaetze',
      field: 'felder',
      special: 'cast-json',
      interface: 'input-code',
      options: JSON.stringify({ language: 'json' }),
      note: 'Feldliste des Portals.',
      readonly: true,
      hidden: true,
      sort: 9,
      width: 'full'
    },
    {
      collection: 'datensaetze',
      field: 'portal_modified',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      note: 'Zeitstempel des Portals. Aendert sich auch bei reinen Metadaten-Korrekturen.',
      readonly: true,
      sort: 10,
      width: 'half'
    },
    {
      collection: 'datensaetze',
      field: 'letzter_stand',
      interface: 'input',
      note: 'Fingerabdruck des Inhalts. Erst eine Aenderung hier eroeffnet einen Lauf.',
      readonly: true,
      sort: 11,
      width: 'half'
    },
    {
      collection: 'datensaetze',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 12,
      width: 'half'
    },
    {
      collection: 'datensaetze',
      field: 'date_updated',
      special: 'date-updated',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 13,
      width: 'half'
    }
  ])
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields').where({ collection: 'datensaetze' }).delete()
  await knex('directus_relations')
    .where({ many_collection: 'datensaetze' })
    .delete()
  await knex('directus_collections')
    .where({ collection: 'datensaetze' })
    .delete()
  await knex.schema.dropTableIfExists('datensaetze')
}
