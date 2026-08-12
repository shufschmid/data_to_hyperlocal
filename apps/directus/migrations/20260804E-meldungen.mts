import type { Knex } from 'knex'

/**
 * One article, for one municipality, from one run. The product of the whole
 * application.
 *
 * Two relations with deliberately different delete behaviour:
 *   - `lauf` CASCADE — an article without its run is an orphan
 *   - `gemeinde` RESTRICT — municipalities are seeded reference data; if
 *     something ever tries to delete one that has articles, that should fail
 *     loudly rather than quietly take published work with it
 *
 * Three groups of columns, and they are worth keeping apart when reading this:
 *   - editorial content (titel/lead/text/status) — what a human works on
 *   - processing state (verarbeitung/anweisung/versuche/gesperrt_bis) — what
 *     the queue works on, so no separate jobs table is needed
 *   - the counter-check (the `freigabe_` and `entscheidung` columns) — see the
 *     redaktion endpoint for why only a hash of the token is stored
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('meldungen', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table
      .uuid('lauf')
      .notNullable()
      .references('id')
      .inTable('laeufe')
      .onDelete('CASCADE')
    table
      .uuid('gemeinde')
      .notNullable()
      .references('id')
      .inTable('gemeinden')
      .onDelete('RESTRICT')

    table.string('titel', 255)
    table.text('lead')
    table.text('text')
    table.string('status', 32).notNullable().defaultTo('entwurf')

    // The rows the article was written from. Provenance for fact-checking, and
    // the reason a reader can be told where a number comes from. Holds the rows
    // actually used, never a dataset dump.
    table.json('datengrundlage')
    // Soft hits from the relative-time check: legitimate in context, so they are
    // shown to the editor rather than blocking the article.
    table.text('zeit_warnungen')

    table.string('verarbeitung', 24).notNullable().defaultTo('idle')
    // The revision Sämi asked for, waiting to be applied by the next drain.
    table.text('anweisung')
    table.integer('versuche').notNullable().defaultTo(0)
    table.timestamp('gesperrt_bis', { useTz: true })
    table.text('fehler')

    // Only the SHA-256 of the approval token, never the token itself: a database
    // dump, an over-broad read policy or a screenshot must not hand out the
    // power to approve. Indexed because lookup happens *by* the hash.
    table.string('freigabe_token_hash', 64).index()
    table.timestamp('freigabe_token_ablauf', { useTz: true })
    table.string('entscheidung', 16)
    table.text('entscheidung_klartext')
    table.timestamp('freigegeben_am', { useTz: true })
    table.timestamp('publiziert_am', { useTz: true })

    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })

    // A run produces at most one article per municipality. A retried or
    // overlapping drain cannot double up.
    table.unique(['lauf', 'gemeinde'])
  })

  await knex('directus_collections').insert({
    collection: 'meldungen',
    icon: 'article',
    note: 'Die redaktionellen Meldungen. Publizierte Meldungen liest der Dorfkoenig als Quelle.',
    display_template: '{{ gemeinde.name }}: {{ titel }}',
    sort_field: null,
    archive_field: 'status',
    archive_value: 'verworfen',
    unarchive_value: 'entwurf',
    archive_app_filter: true,
    accountability: 'all',
    singleton: false,
    hidden: false,
    collapse: 'open',
    versioning: false
  })

  await knex('directus_relations').insert([
    {
      many_collection: 'meldungen',
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
      many_collection: 'meldungen',
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

  await knex('directus_fields').insert([
    {
      collection: 'meldungen',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'meldungen',
      field: 'lauf',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ periode }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ periode }}' }),
      required: true,
      readonly: true,
      sort: 2,
      width: 'half'
    },
    {
      collection: 'meldungen',
      field: 'gemeinde',
      special: 'm2o',
      interface: 'select-dropdown-m2o',
      options: JSON.stringify({ template: '{{ name }}' }),
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ name }}' }),
      required: true,
      readonly: true,
      sort: 3,
      width: 'half'
    },
    {
      collection: 'meldungen',
      field: 'status',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Entwurf', value: 'entwurf' },
          { text: 'In Gegenpruefung', value: 'in_pruefung' },
          { text: 'Freigegeben', value: 'freigegeben' },
          { text: 'Publiziert', value: 'publiziert' },
          { text: 'Verworfen', value: 'verworfen' }
        ]
      }),
      display: 'labels',
      display_options: JSON.stringify({
        showAsDot: true,
        choices: [
          {
            text: 'Entwurf',
            value: 'entwurf',
            foreground: '#FFFFFF',
            background: '#A2B5CD'
          },
          {
            text: 'In Gegenpruefung',
            value: 'in_pruefung',
            foreground: '#FFFFFF',
            background: '#FFA439'
          },
          {
            text: 'Freigegeben',
            value: 'freigegeben',
            foreground: '#FFFFFF',
            background: '#3399FF'
          },
          {
            text: 'Publiziert',
            value: 'publiziert',
            foreground: '#FFFFFF',
            background: '#2ECDA7'
          },
          {
            text: 'Verworfen',
            value: 'verworfen',
            foreground: '#FFFFFF',
            background: '#E35169'
          }
        ]
      }),
      note: 'Der Uebergang wird von einem Hook geprueft — auch beim Bearbeiten hier im Adminbereich.',
      sort: 4,
      width: 'half'
    },
    {
      collection: 'meldungen',
      field: 'verarbeitung',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Bereit', value: 'idle' },
          { text: 'Eingeplant', value: 'geplant' },
          { text: 'Laeuft', value: 'laeuft' },
          { text: 'Fehler', value: 'fehler' }
        ]
      }),
      display: 'labels',
      note: 'Zustand der Warteschlange, nicht der Redaktion.',
      readonly: true,
      sort: 5,
      width: 'half'
    },
    {
      collection: 'meldungen',
      field: 'titel',
      interface: 'input',
      sort: 6,
      width: 'full'
    },
    {
      collection: 'meldungen',
      field: 'lead',
      interface: 'input-multiline',
      note: 'Anreisser. Der Dorfkoenig kann ihn einzeln weiterverwenden.',
      sort: 7,
      width: 'full'
    },
    {
      collection: 'meldungen',
      field: 'text',
      interface: 'input-multiline',
      options: JSON.stringify({ softLength: 2500 }),
      sort: 8,
      width: 'full'
    },
    {
      collection: 'meldungen',
      field: 'zeit_warnungen',
      special: 'cast-csv',
      interface: 'tags',
      options: JSON.stringify({ allowCustom: false }),
      display: 'labels',
      note: 'Relative Zeitangaben, die im Text stehen. Der Text soll auch in Jahren noch stimmen.',
      readonly: true,
      sort: 9,
      width: 'full'
    },
    {
      collection: 'meldungen',
      field: 'datengrundlage',
      special: 'cast-json',
      interface: 'input-code',
      options: JSON.stringify({ language: 'json' }),
      note: 'Die Zahlen, auf denen die Meldung beruht.',
      readonly: true,
      sort: 10,
      width: 'full'
    },
    {
      collection: 'meldungen',
      field: 'anweisung',
      interface: 'input-multiline',
      note: 'Offene Ueberarbeitung, die beim naechsten Durchlauf angewendet wird.',
      readonly: true,
      hidden: true,
      sort: 11,
      width: 'full'
    },
    {
      collection: 'meldungen',
      field: 'fehler',
      interface: 'input-multiline',
      readonly: true,
      sort: 12,
      width: 'full'
    },
    {
      collection: 'meldungen',
      field: 'versuche',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 13,
      width: 'half'
    },
    {
      collection: 'meldungen',
      field: 'gesperrt_bis',
      interface: 'datetime',
      display: 'datetime',
      readonly: true,
      hidden: true,
      sort: 14,
      width: 'half'
    },
    {
      collection: 'meldungen',
      field: 'freigabe_token_hash',
      interface: 'input',
      note: 'SHA-256 des Freigabe-Tokens. Gehoert in keine Leseberechtigung.',
      readonly: true,
      hidden: true,
      sort: 15,
      width: 'half'
    },
    {
      collection: 'meldungen',
      field: 'freigabe_token_ablauf',
      interface: 'datetime',
      display: 'datetime',
      readonly: true,
      hidden: true,
      sort: 16,
      width: 'half'
    },
    {
      collection: 'meldungen',
      field: 'entscheidung',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Freigegeben', value: 'ja' },
          { text: 'Abgelehnt', value: 'nein' },
          { text: 'Unklar', value: 'unklar' }
        ]
      }),
      display: 'labels',
      note: '"Unklar" gilt nie als Freigabe.',
      readonly: true,
      sort: 17,
      width: 'half'
    },
    {
      collection: 'meldungen',
      field: 'entscheidung_klartext',
      interface: 'input-multiline',
      note: 'Wortlaut der Rueckmeldung aus der Gegenpruefung.',
      readonly: true,
      sort: 18,
      width: 'full'
    },
    {
      collection: 'meldungen',
      field: 'freigegeben_am',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      sort: 19,
      width: 'half'
    },
    {
      collection: 'meldungen',
      field: 'publiziert_am',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      sort: 20,
      width: 'half'
    },
    {
      collection: 'meldungen',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      sort: 21,
      width: 'half'
    },
    {
      collection: 'meldungen',
      field: 'date_updated',
      special: 'date-updated',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 22,
      width: 'half'
    }
  ])
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields').where({ collection: 'meldungen' }).delete()
  await knex('directus_relations')
    .where({ many_collection: 'meldungen' })
    .delete()
  await knex('directus_collections').where({ collection: 'meldungen' }).delete()
  await knex.schema.dropTableIfExists('meldungen')
}
