import type { Knex } from 'knex'

/**
 * The memory that makes the second time better than the first.
 *
 * When the waste statistics reappear in 2027, the generator reads two things
 * from the past: the articles written in 2026 (via `laeufe` on the same
 * dataset), and the rules in here — the durable lessons distilled from what
 * Sämi asked for in the editorial chat.
 *
 * Not every chat instruction belongs here. "Shorten this one" is a correction;
 * "always name the cantonal average for comparison" is a rule. A small
 * classification call decides which is which, and `herkunft` records whether a
 * row came from that path or was written by hand — so a rule that turns out to
 * be nonsense can be traced back and switched off rather than deleted, which
 * keeps the audit trail intact.
 *
 * `geltungsbereich` keeps the cached prompt prefix bounded as this table grows:
 * a run only ever loads the rules that actually apply to it.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('redaktionswissen', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table
      .uuid('datensatz')
      .references('id')
      .inTable('datensaetze')
      .onDelete('CASCADE')
    table.uuid('quelle').references('id').inTable('quellen').onDelete('CASCADE')
    table.text('regel').notNullable()
    table.string('geltungsbereich', 24).notNullable().defaultTo('datensatz')
    table.string('herkunft', 16).notNullable().defaultTo('chat')
    table.boolean('aktiv').notNullable().defaultTo(true)
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })
  })

  await knex('directus_collections').insert({
    collection: 'redaktionswissen',
    icon: 'psychology',
    note: 'Dauerhafte Regeln aus der Redaktionsarbeit. Fliessen in jede weitere Generierung ein.',
    display_template: '{{ regel }}',
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
      many_collection: 'redaktionswissen',
      many_field: 'datensatz',
      one_collection: 'datensaetze',
      one_field: null,
      one_collection_field: null,
      one_allowed_collections: null,
      junction_field: null,
      sort_field: null,
      one_deselect_action: 'nullify'
    },
    {
      many_collection: 'redaktionswissen',
      many_field: 'quelle',
      one_collection: 'quellen',
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
      collection: 'redaktionswissen',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'redaktionswissen',
      field: 'regel',
      interface: 'input-multiline',
      note: 'Als Anweisung formuliert, so wie sie im Prompt stehen soll.',
      required: true,
      sort: 2,
      width: 'full'
    },
    {
      collection: 'redaktionswissen',
      field: 'geltungsbereich',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Nur dieser Datensatz', value: 'datensatz' },
          { text: 'Ganze Quelle', value: 'quelle' },
          { text: 'Alle Meldungen', value: 'global' }
        ]
      }),
      display: 'labels',
      required: true,
      sort: 3,
      width: 'half'
    },
    {
      collection: 'redaktionswissen',
      field: 'aktiv',
      interface: 'boolean',
      display: 'boolean',
      note: 'Deaktivieren statt loeschen — so bleibt nachvollziehbar, was einmal galt.',
      sort: 4,
      width: 'half'
    },
    {
      collection: 'redaktionswissen',
      field: 'datensatz',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ titel }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ titel }}' }),
      note: 'Noetig bei Geltungsbereich "Nur dieser Datensatz".',
      sort: 5,
      width: 'half'
    },
    {
      collection: 'redaktionswissen',
      field: 'quelle',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ name }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ name }}' }),
      note: 'Noetig bei Geltungsbereich "Ganze Quelle".',
      sort: 6,
      width: 'half'
    },
    {
      collection: 'redaktionswissen',
      field: 'herkunft',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Aus einem Gespraech', value: 'chat' },
          { text: 'Von Hand', value: 'manuell' }
        ]
      }),
      display: 'labels',
      readonly: true,
      sort: 7,
      width: 'half'
    },
    {
      collection: 'redaktionswissen',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      sort: 8,
      width: 'half'
    },
    {
      collection: 'redaktionswissen',
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
  await knex('directus_fields')
    .where({ collection: 'redaktionswissen' })
    .delete()
  await knex('directus_relations')
    .where({ many_collection: 'redaktionswissen' })
    .delete()
  await knex('directus_collections')
    .where({ collection: 'redaktionswissen' })
    .delete()
  await knex.schema.dropTableIfExists('redaktionswissen')
}
