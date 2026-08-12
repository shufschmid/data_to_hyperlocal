import type { Knex } from 'knex'

/**
 * What the statistics office says is coming, and what it says has just landed.
 *
 * This is the early-warning half of the pipeline. `datensaetze` records what
 * exists in the open-data portal; this records what the office *announced*, and
 * the two are not simultaneous: the waste statistics 2025 appeared on the
 * agenda on 7 July 2026 and reached the machine-readable dataset on 21 July.
 * Two weeks of lead time the API alone cannot give.
 *
 * An announcement passes through two states on one row, never two rows:
 *   geplant     announced for a quarter, no date, no link yet
 *   publiziert  a date and a link have appeared
 *
 * Hence `schluessel` is derived from the title alone. Keying on the date would
 * make the second sighting look like a new announcement and tell the editor
 * about the same statistic twice.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ankuendigungen', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table
      .uuid('quelle')
      .notNullable()
      .references('id')
      .inTable('quellen')
      .onDelete('CASCADE')
    // Normalised title — stable across the geplant → publiziert transition.
    table.string('schluessel', 200).notNullable()
    table.string('titel', 200).notNullable()
    table.string('status', 24).notNullable().defaultTo('geplant')
    table.date('datum')
    table.string('quartal', 60)
    table.text('link')
    // Set once the matching dataset shows up in the portal, which closes the
    // loop between "announced" and "we can actually write from it".
    table
      .uuid('datensatz')
      .references('id')
      .inTable('datensaetze')
      .onDelete('SET NULL')
    table
      .timestamp('erstmals_gesehen', { useTz: true })
      .defaultTo(knex.fn.now())
    table.timestamp('publiziert_seit', { useTz: true })
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })

    table.unique(['quelle', 'schluessel'])
  })

  await knex('directus_collections').insert({
    collection: 'ankuendigungen',
    icon: 'campaign',
    note: 'Angekuendigte und publizierte Statistiken aus der Agenda des Amts fuer Daten und Statistik.',
    display_template: '{{ titel }}',
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
  })

  await knex('directus_relations').insert([
    {
      many_collection: 'ankuendigungen',
      many_field: 'quelle',
      one_collection: 'quellen',
      one_field: null,
      one_collection_field: null,
      one_allowed_collections: null,
      junction_field: null,
      sort_field: null,
      one_deselect_action: 'nullify'
    },
    {
      many_collection: 'ankuendigungen',
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
    {
      collection: 'ankuendigungen',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'ankuendigungen',
      field: 'titel',
      interface: 'input',
      // Editable on purpose. When the agenda page turns the crawler away — it
      // sits behind a bot check — the fallback is a person opening it and
      // entering the entry here. A read-only form would make that impossible.
      note: 'Kann von Hand erfasst werden, wenn die Agenda-Abfrage abgewiesen wurde.',
      required: true,
      sort: 2,
      width: 'full'
    },
    {
      collection: 'ankuendigungen',
      field: 'status',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Angekuendigt', value: 'geplant' },
          { text: 'Publiziert', value: 'publiziert' }
        ]
      }),
      display: 'labels',
      display_options: JSON.stringify({
        showAsDot: true,
        choices: [
          {
            text: 'Angekuendigt',
            value: 'geplant',
            foreground: '#FFFFFF',
            background: '#FFA439'
          },
          {
            text: 'Publiziert',
            value: 'publiziert',
            foreground: '#FFFFFF',
            background: '#2ECDA7'
          }
        ]
      }),
      // Editable, like the other hand-fillable fields: someone entering an
      // entry manually has to be able to say whether it is out or only planned.
      sort: 3,
      width: 'half'
    },
    {
      collection: 'ankuendigungen',
      field: 'datum',
      interface: 'datetime',
      display: 'datetime',
      note: 'Publikationsdatum laut Agenda. Leer, solange nur angekuendigt.',
      sort: 4,
      width: 'half'
    },
    {
      collection: 'ankuendigungen',
      field: 'quartal',
      interface: 'input',
      sort: 5,
      width: 'half'
    },
    {
      collection: 'ankuendigungen',
      field: 'link',
      interface: 'input',
      options: JSON.stringify({ iconRight: 'open_in_new' }),
      sort: 6,
      width: 'full'
    },
    {
      collection: 'ankuendigungen',
      field: 'datensatz',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ titel }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ titel }}' }),
      note: 'Der passende Datensatz im Portal, sobald er dort auftaucht.',
      sort: 7,
      width: 'full'
    },
    {
      collection: 'ankuendigungen',
      field: 'quelle',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ name }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ name }}' }),
      required: true,
      readonly: true,
      sort: 8,
      width: 'half'
    },
    {
      collection: 'ankuendigungen',
      field: 'schluessel',
      interface: 'input',
      note: 'Normalisierter Titel. Haelt einen Eintrag ueber den Wechsel von angekuendigt zu publiziert zusammen.',
      // Not `required` in the form: the hook `ankuendigung-schluessel` fills it
      // from the title on every write, so a hand-entered row does not need the
      // person to know the key exists.
      readonly: true,
      hidden: true,
      sort: 9,
      width: 'half'
    },
    {
      collection: 'ankuendigungen',
      field: 'erstmals_gesehen',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      sort: 10,
      width: 'half'
    },
    {
      collection: 'ankuendigungen',
      field: 'publiziert_seit',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      note: 'Wann der Eintrag von angekuendigt auf publiziert gewechselt ist.',
      readonly: true,
      sort: 11,
      width: 'half'
    },
    {
      collection: 'ankuendigungen',
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
      collection: 'ankuendigungen',
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

  // The source type dropdown was written by 20260804B, which has already run
  // everywhere — so it is amended here rather than edited there.
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

  // The agenda page as a second source. `typ` picks the adapter; the ODS portal
  // seeded earlier keeps working unchanged.
  await knex('quellen').insert({
    name: 'Publikationsagenda Statistik BL',
    typ: 'agenda',
    basis_url:
      'https://www.baselland.ch/politik-und-behorden/direktionen/finanz-und-kirchendirektion/daten-statistik/abteilung-statistik/agenda-2026/',
    konfiguration: null,
    aktiv: true
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex('quellen').where({ typ: 'agenda' }).delete()
  await knex('directus_fields')
    .where({ collection: 'quellen', field: 'typ' })
    .update({
      options: JSON.stringify({
        choices: [{ text: 'Opendatasoft-Portal', value: 'ods' }]
      })
    })
  await knex('directus_fields').where({ collection: 'ankuendigungen' }).delete()
  await knex('directus_relations')
    .where({ many_collection: 'ankuendigungen' })
    .delete()
  await knex('directus_collections')
    .where({ collection: 'ankuendigungen' })
    .delete()
  await knex.schema.dropTableIfExists('ankuendigungen')
}
