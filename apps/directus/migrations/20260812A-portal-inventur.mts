import type { Knex } from 'knex'

// The portal inventory: what exists on statistik.bl.ch, and what needs watching.
//
// The rule these two collections serve is the newsroom's, and it is sharper
// than a full scan: watch daily only what (1) is broken down by municipality,
// (2) is **not** available as open data, and (3) has no agenda entry. Everything
// else already reaches us — through the daily catalogue check or the agenda —
// and may arrive a day later.
//
// Why two collections instead of one:
//
//   `portal_bereiche`  the 88 second-level branches. "Letzte Änderung" is
//                      published per branch, not per table — 5_1, 5_1_4 and
//                      5_1_5 all say 19.05.2026 — so the branch is the unit that
//                      can be watched at all. The chapter page is not: chapter 7
//                      reported 07.07. while 7_2 underneath was already at
//                      15.07.
//
//   `portal_seiten`    every page the inventory has visited, table or not. It is
//                      what makes the walk resumable and what stops us asking
//                      the same question about the same table twice.
//
// A table that turns out to be worth watching becomes an ordinary `datensaetze`
// row under the existing `statbl` source — the pipeline behind it does not need
// to know where the numbers came from.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('portal_bereiche', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.string('pfad', 40).notNullable().unique()
    table.string('titel', 200).notNullable().defaultTo('')
    // The date the branch page publishes. Comparing it is the entire watch.
    table.date('stand')
    table.boolean('beobachten').notNullable().defaultTo(false)
    table.boolean('inventur_offen').notNullable().defaultTo(true)
    table.timestamp('letzte_pruefung', { useTz: true })
    table.text('letzter_fehler')
    // Pages the inventory could not place: an unknown layout must be counted,
    // not swallowed.
    table.integer('unklar').notNullable().defaultTo(0)
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })
  })

  await knex.schema.createTable('portal_seiten', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.string('pfad', 40).notNullable().unique()
    table
      .uuid('bereich')
      .references('id')
      .inTable('portal_bereiche')
      .onDelete('CASCADE')
    table.string('titel', 300).notNullable().defaultTo('')
    table.string('art', 20).notNullable().defaultTo('offen')
    table.string('form', 10)
    table.boolean('gemeindeebene').notNullable().defaultTo(false)
    table.integer('treffer').notNullable().defaultTo(0)
    // The two answers that decide the rule. Null means "covered by nothing we
    // know of", which is what puts a page into the watch set.
    table.string('ods_datensatz', 60)
    table
      .uuid('ankuendigung')
      .references('id')
      .inTable('ankuendigungen')
      .onDelete('SET NULL')
    table
      .uuid('datensatz')
      .references('id')
      .inTable('datensaetze')
      .onDelete('SET NULL')
    table.boolean('beobachten').notNullable().defaultTo(false)
    table.text('hinweis')
    table.timestamp('geprueft_am', { useTz: true })
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })
  })

  await knex('directus_collections').insert([
    {
      collection: 'portal_bereiche',
      icon: 'account_tree',
      note: 'Zweige des Statistikportals. "Letzte Aenderung" wird pro Zweig publiziert, nicht pro Tabelle.',
      display_template: '{{ pfad }} {{ titel }}',
      sort_field: null,
      archive_field: null,
      archive_value: null,
      unarchive_value: null,
      archive_app_filter: true,
      accountability: 'all',
      singleton: false,
      hidden: false,
      collapse: 'open',
      versioning: false
    },
    {
      collection: 'portal_seiten',
      icon: 'table_view',
      note: 'Jede besuchte Seite des Statistikportals, mit ihrer Einordnung.',
      display_template: '{{ pfad }} {{ titel }}',
      sort_field: null,
      archive_field: null,
      archive_value: null,
      unarchive_value: null,
      archive_app_filter: true,
      accountability: 'all',
      singleton: false,
      hidden: false,
      collapse: 'open',
      versioning: false
    }
  ])

  await knex('directus_relations').insert([
    {
      many_collection: 'portal_seiten',
      many_field: 'bereich',
      one_collection: 'portal_bereiche',
      one_field: null,
      one_collection_field: null,
      one_allowed_collections: null,
      junction_field: null,
      sort_field: null,
      one_deselect_action: 'nullify'
    },
    {
      many_collection: 'portal_seiten',
      many_field: 'ankuendigung',
      one_collection: 'ankuendigungen',
      one_field: null,
      one_collection_field: null,
      one_allowed_collections: null,
      junction_field: null,
      sort_field: null,
      one_deselect_action: 'nullify'
    },
    {
      many_collection: 'portal_seiten',
      many_field: 'datensatz',
      one_collection: 'datensaetze',
      one_field: null,
      one_collection_field: null,
      one_allowed_collections: null,
      junction_field: null,
      sort_field: null,
      one_deselect_action: 'nullify'
    }
  ])

  await knex('directus_fields').insert([
    // --- portal_bereiche ---
    {
      collection: 'portal_bereiche',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'portal_bereiche',
      field: 'pfad',
      interface: 'input',
      note: 'Pfad im Portal, z. B. "5_1".',
      required: true,
      sort: 2,
      width: 'half'
    },
    {
      collection: 'portal_bereiche',
      field: 'titel',
      interface: 'input',
      sort: 3,
      width: 'half'
    },
    {
      collection: 'portal_bereiche',
      field: 'stand',
      interface: 'datetime',
      display: 'datetime',
      note: 'Das Datum, das die Portalseite als "Letzte Aenderung" nennt.',
      sort: 4,
      width: 'half'
    },
    {
      collection: 'portal_bereiche',
      field: 'beobachten',
      interface: 'boolean',
      display: 'boolean',
      note: 'Taeglich pruefen. Wird aus der Einordnung der Seiten abgeleitet und kann von Hand uebersteuert werden.',
      sort: 5,
      width: 'half'
    },
    {
      collection: 'portal_bereiche',
      field: 'inventur_offen',
      interface: 'boolean',
      display: 'boolean',
      note: 'Die Inventur hat diesen Zweig noch nicht fertig durchlaufen.',
      sort: 6,
      width: 'half'
    },
    {
      collection: 'portal_bereiche',
      field: 'unklar',
      interface: 'input',
      note: 'Seiten, deren Aufbau die Inventur nicht einordnen konnte.',
      readonly: true,
      sort: 7,
      width: 'half'
    },
    {
      collection: 'portal_bereiche',
      field: 'letzte_pruefung',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      sort: 8,
      width: 'half'
    },
    {
      collection: 'portal_bereiche',
      field: 'letzter_fehler',
      interface: 'input',
      readonly: true,
      sort: 9,
      width: 'full'
    },
    {
      collection: 'portal_bereiche',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      readonly: true,
      hidden: true,
      sort: 10,
      width: 'half'
    },
    {
      collection: 'portal_bereiche',
      field: 'date_updated',
      special: 'date-updated',
      interface: 'datetime',
      readonly: true,
      hidden: true,
      sort: 11,
      width: 'half'
    },

    // --- portal_seiten ---
    {
      collection: 'portal_seiten',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'portal_seiten',
      field: 'pfad',
      interface: 'input',
      required: true,
      sort: 2,
      width: 'half'
    },
    {
      collection: 'portal_seiten',
      field: 'bereich',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ pfad }} {{ titel }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ pfad }}' }),
      sort: 3,
      width: 'half'
    },
    {
      collection: 'portal_seiten',
      field: 'titel',
      interface: 'input',
      sort: 4,
      width: 'full'
    },
    {
      collection: 'portal_seiten',
      field: 'art',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Noch nicht besucht', value: 'offen' },
          { text: 'Tabelle', value: 'tabelle' },
          { text: 'Navigation', value: 'navigation' }
        ]
      }),
      display: 'labels',
      sort: 5,
      width: 'half'
    },
    {
      collection: 'portal_seiten',
      field: 'form',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Lang (ein Jahr je Seite)', value: 'lang' },
          { text: 'Breit (Jahre als Spalten)', value: 'breit' }
        ]
      }),
      sort: 6,
      width: 'half'
    },
    {
      collection: 'portal_seiten',
      field: 'gemeindeebene',
      interface: 'boolean',
      display: 'boolean',
      sort: 7,
      width: 'half'
    },
    {
      collection: 'portal_seiten',
      field: 'treffer',
      interface: 'input',
      note: 'Wie viele der 86 Gemeinden die erste Spalte trifft.',
      readonly: true,
      sort: 8,
      width: 'half'
    },
    {
      collection: 'portal_seiten',
      field: 'ods_datensatz',
      interface: 'input',
      note: 'ID des Open-Data-Datensatzes, der dieselben Zahlen abdeckt.',
      sort: 9,
      width: 'half'
    },
    {
      collection: 'portal_seiten',
      field: 'ankuendigung',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ titel }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ titel }}' }),
      sort: 10,
      width: 'half'
    },
    {
      collection: 'portal_seiten',
      field: 'datensatz',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ titel }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ titel }}' }),
      note: 'Angelegt, sobald die Tabelle als Datensatz gefuehrt wird.',
      sort: 11,
      width: 'half'
    },
    {
      collection: 'portal_seiten',
      field: 'beobachten',
      interface: 'boolean',
      display: 'boolean',
      note: 'Gemeindeebene, kein Open-Data-Datensatz, kein Agenda-Eintrag.',
      sort: 12,
      width: 'half'
    },
    {
      collection: 'portal_seiten',
      field: 'hinweis',
      interface: 'input',
      note: 'Warum diese Seite so eingeordnet wurde.',
      readonly: true,
      sort: 13,
      width: 'full'
    },
    {
      collection: 'portal_seiten',
      field: 'geprueft_am',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      sort: 14,
      width: 'half'
    },
    {
      collection: 'portal_seiten',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      readonly: true,
      hidden: true,
      sort: 15,
      width: 'half'
    },
    {
      collection: 'portal_seiten',
      field: 'date_updated',
      special: 'date-updated',
      interface: 'datetime',
      readonly: true,
      hidden: true,
      sort: 16,
      width: 'half'
    }
  ])
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields')
    .whereIn('collection', ['portal_bereiche', 'portal_seiten'])
    .delete()
  await knex('directus_relations')
    .where({ many_collection: 'portal_seiten' })
    .delete()
  await knex('directus_collections')
    .whereIn('collection', ['portal_bereiche', 'portal_seiten'])
    .delete()

  await knex.schema.dropTableIfExists('portal_seiten')
  await knex.schema.dropTableIfExists('portal_bereiche')
}
