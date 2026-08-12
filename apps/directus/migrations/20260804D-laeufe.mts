import type { Knex } from 'knex'

/**
 * One run = one dataset, one period, turned into a set of articles.
 *
 * `periode` is what makes the same dataset reusable year after year: the waste
 * statistics for 2025 and for 2026 are two runs on one dataset, and the older
 * run is exactly the memory the newer one reads from.
 *
 * The unique constraint on (datensatz, periode) does more work than any lock:
 * two overlapping scheduled ticks physically cannot open two runs for the same
 * period, so the queue logic never has to be clever about it.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('laeufe', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    // A run without its dataset means nothing, so it goes with it.
    table
      .uuid('datensatz')
      .notNullable()
      .references('id')
      .inTable('datensaetze')
      .onDelete('CASCADE')
    // "2025" for a yearly statistic, "2026-06-14" for a referendum date. Free
    // text on purpose — the shape comes from the dataset, not from us.
    table.string('periode', 32).notNullable()
    table.string('status', 32).notNullable().defaultTo('geplant')
    table.text('briefing')
    table.json('kontext')
    table.text('fehler')
    table.integer('versuche').notNullable().defaultTo(0)
    // Lease for the briefing stage. A tick that dies mid-call leaves this in the
    // past, and the next tick reclaims the run instead of stalling forever.
    table.timestamp('gesperrt_bis', { useTz: true })
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })

    table.unique(['datensatz', 'periode'])
  })

  await knex('directus_collections').insert({
    collection: 'laeufe',
    icon: 'workspaces',
    note: 'Ein Lauf verwandelt einen Datensatz fuer eine Periode in Meldungen.',
    display_template: '{{ datensatz.titel }} — {{ periode }}',
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

  await knex('directus_relations').insert({
    many_collection: 'laeufe',
    many_field: 'datensatz',
    one_collection: 'datensaetze',
    one_field: null,
    one_collection_field: null,
    one_allowed_collections: null,
    junction_field: null,
    sort_field: null,
    one_deselect_action: 'nullify'
  })

  await knex('directus_fields').insert([
    {
      collection: 'laeufe',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'laeufe',
      field: 'datensatz',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ titel }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ titel }}' }),
      required: true,
      readonly: true,
      sort: 2,
      width: 'half'
    },
    {
      collection: 'laeufe',
      field: 'periode',
      interface: 'input',
      note: 'Jahr oder Datum, auf das sich der Lauf bezieht.',
      required: true,
      readonly: true,
      sort: 3,
      width: 'half'
    },
    {
      collection: 'laeufe',
      field: 'status',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Geplant', value: 'geplant' },
          { text: 'Briefing laeuft', value: 'briefing' },
          { text: 'Meldungen werden geschrieben', value: 'schreibt' },
          { text: 'Bereit zur Durchsicht', value: 'bereit' },
          { text: 'Fehler', value: 'fehler' }
        ]
      }),
      display: 'labels',
      display_options: JSON.stringify({
        showAsDot: true,
        choices: [
          {
            text: 'Geplant',
            value: 'geplant',
            foreground: '#FFFFFF',
            background: '#A2B5CD'
          },
          {
            text: 'Briefing laeuft',
            value: 'briefing',
            foreground: '#FFFFFF',
            background: '#FFA439'
          },
          {
            text: 'Meldungen werden geschrieben',
            value: 'schreibt',
            foreground: '#FFFFFF',
            background: '#FFA439'
          },
          {
            text: 'Bereit zur Durchsicht',
            value: 'bereit',
            foreground: '#FFFFFF',
            background: '#2ECDA7'
          },
          {
            text: 'Fehler',
            value: 'fehler',
            foreground: '#FFFFFF',
            background: '#E35169'
          }
        ]
      }),
      readonly: true,
      sort: 4,
      width: 'half'
    },
    {
      collection: 'laeufe',
      field: 'briefing',
      interface: 'input-multiline',
      note: 'Gemeinsamer Winkel aller Meldungen dieses Laufs. Wird einmal pro Lauf erzeugt.',
      readonly: true,
      sort: 5,
      width: 'full'
    },
    {
      collection: 'laeufe',
      field: 'kontext',
      special: 'cast-json',
      interface: 'input-code',
      options: JSON.stringify({ language: 'json' }),
      note: 'Kantonale Kennzahlen und Vergleichsbasis, auf die sich das Briefing stuetzt.',
      readonly: true,
      hidden: true,
      sort: 6,
      width: 'full'
    },
    {
      collection: 'laeufe',
      field: 'fehler',
      interface: 'input-multiline',
      readonly: true,
      sort: 7,
      width: 'full'
    },
    {
      collection: 'laeufe',
      field: 'versuche',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 8,
      width: 'half'
    },
    {
      collection: 'laeufe',
      field: 'gesperrt_bis',
      interface: 'datetime',
      display: 'datetime',
      readonly: true,
      hidden: true,
      sort: 9,
      width: 'half'
    },
    {
      collection: 'laeufe',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      sort: 10,
      width: 'half'
    },
    {
      collection: 'laeufe',
      field: 'date_updated',
      special: 'date-updated',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 11,
      width: 'half'
    }
  ])
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields').where({ collection: 'laeufe' }).delete()
  await knex('directus_relations').where({ many_collection: 'laeufe' }).delete()
  await knex('directus_collections').where({ collection: 'laeufe' }).delete()
  await knex.schema.dropTableIfExists('laeufe')
}
