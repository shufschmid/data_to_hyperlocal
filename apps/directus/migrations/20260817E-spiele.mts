import type { Knex } from 'knex'

/**
 * Matches — results already played and fixtures still to come.
 *
 * `spielnummer` is the identity, not a surrogate: the SFV prints it on every
 * entry and it is stable across the fixture appearing, being played and being
 * corrected afterwards. That is what makes the daily run idempotent — the same
 * page is read every day and only genuinely new numbers are inserted.
 *
 * `gemeinde` and `sportart` are denormalised from `vereine` on purpose. The
 * workspace filters by exactly those two, and a filter that has to walk a
 * relation is a filter the frontend cannot express in one GraphQL query.
 * They are written by the connector, never by hand.
 *
 * `tore_heim` / `tore_gast` stay NULL until the source prints both numbers.
 * A half-read score is not a result: one number on its own is a group or a
 * table position, and inventing the other half is how a reversed scoreline
 * reaches an article.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('spiele', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.string('spielnummer', 32).notNullable().unique()

    table
      .uuid('verein')
      .notNullable()
      .references('id')
      .inTable('vereine')
      .onDelete('CASCADE')
    // Denormalised for the workspace filters — see the note above.
    table
      .uuid('gemeinde')
      .notNullable()
      .references('id')
      .inTable('gemeinden')
      .onDelete('RESTRICT')
    table.string('sportart', 40).notNullable()

    table.timestamp('datum', { useTz: true }).notNullable()
    table.string('heim', 160).notNullable()
    table.string('gast', 160).notNullable()
    table.integer('tore_heim')
    table.integer('tore_gast')
    table.string('wettbewerb', 200).notNullable()
    table.string('ort', 200)
    table.string('status', 80)
    table.string('quelle_url', 500)

    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })

    table.index(['datum'])
    table.index(['gemeinde', 'sportart'])
  })

  await knex('directus_collections').insert({
    collection: 'spiele',
    icon: 'scoreboard',
    note: 'Resultate und kommende Begegnungen der erfassten Vereine. Wird vom Konnektor geschrieben.',
    display_template: '{{ heim }} – {{ gast }}',
    sort_field: 'datum',
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
      many_collection: 'spiele',
      many_field: 'verein',
      one_collection: 'vereine',
      one_field: null,
      one_collection_field: null,
      one_allowed_collections: null,
      junction_field: null,
      sort_field: null,
      one_deselect_action: 'nullify'
    },
    {
      many_collection: 'spiele',
      many_field: 'gemeinde',
      one_collection: 'gemeinden',
      one_field: null,
      one_collection_field: null,
      one_allowed_collections: null,
      junction_field: null,
      sort_field: null,
      one_deselect_action: 'nullify'
    }
  ])

  const m2o = (field: string, ziel: string, sort: number) => ({
    collection: 'spiele',
    field,
    special: 'm2o',
    interface: 'select-dropdown-m2o',
    options: JSON.stringify({ template: `{{ ${ziel} }}` }),
    display: 'related-values',
    display_options: JSON.stringify({ template: `{{ ${ziel} }}` }),
    required: true,
    readonly: true,
    sort,
    width: 'half'
  })

  const feld = (
    field: string,
    sort: number,
    extra: Record<string, unknown> = {}
  ) => ({
    collection: 'spiele',
    field,
    interface: 'input',
    readonly: true,
    sort,
    width: 'half',
    ...extra
  })

  await knex('directus_fields').insert([
    {
      collection: 'spiele',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    feld('spielnummer', 2, {
      note: 'Kennung des Verbands. Identitaet des Spiels — daher eindeutig.'
    }),
    m2o('verein', 'name', 3),
    m2o('gemeinde', 'name', 4),
    feld('sportart', 5, { display: 'labels' }),
    {
      collection: 'spiele',
      field: 'datum',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: false }),
      required: true,
      readonly: true,
      sort: 6,
      width: 'half'
    },
    feld('heim', 7),
    feld('gast', 8),
    feld('tore_heim', 9, {
      note: 'Leer, solange die Quelle kein vollstaendiges Resultat zeigt.'
    }),
    feld('tore_gast', 10),
    feld('wettbewerb', 11, { width: 'full' }),
    feld('ort', 12, { width: 'full' }),
    feld('status', 13, {
      note: 'Vermerk der Quelle, etwa "verschoben" oder "nicht gespielt (Gegner)".'
    }),
    feld('quelle_url', 14, { width: 'full' }),
    {
      collection: 'spiele',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 15,
      width: 'half'
    },
    {
      collection: 'spiele',
      field: 'date_updated',
      special: 'date-updated',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 16,
      width: 'half'
    }
  ])
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_relations').where({ many_collection: 'spiele' }).delete()
  await knex('directus_fields').where({ collection: 'spiele' }).delete()
  await knex('directus_collections').where({ collection: 'spiele' }).delete()
  await knex.schema.dropTableIfExists('spiele')
}
