import type { Knex } from 'knex'

// Remembering that we looked for the portal dataset behind an agenda entry.
//
// `ankuendigungen.datensatz` has existed since 20260805A, but nothing ever
// filled it: the agenda says "Abfallstatistik 2025", the portal says
// "Abfallmengen nach Kategorie, Gemeinde und Jahr (seit 2017)", and no string
// comparison bridges that. A small Claude call does, and these two columns are
// what keep it from being asked twice.
//
// `zuordnung_geprueft` is the budget guard, not decoration. Without it every
// nightly run would re-ask about all ~19 published entries forever, including
// the ones that genuinely have no dataset — the announcements the portal never
// publishes machine-readable at all.
//
// `zuordnung_hinweis` carries the reason. The link that appears in the
// workspace is a model's guess; an editor who cannot see why it was made can
// only believe it or ignore it, and both are bad.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ankuendigungen', (table) => {
    table.timestamp('zuordnung_geprueft', { useTz: true })
    table.text('zuordnung_hinweis')
  })

  await knex('directus_fields').insert([
    {
      collection: 'ankuendigungen',
      field: 'zuordnung_geprueft',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      note: 'Wann zuletzt nach dem passenden Datensatz gesucht wurde. Leeren, um erneut suchen zu lassen.',
      sort: 14,
      width: 'half'
    },
    {
      collection: 'ankuendigungen',
      field: 'zuordnung_hinweis',
      interface: 'input',
      note: 'Warum dieser Datensatz zugeordnet wurde — oder warum keiner passt.',
      readonly: true,
      sort: 15,
      width: 'full'
    }
  ])
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields')
    .where({ collection: 'ankuendigungen' })
    .whereIn('field', ['zuordnung_geprueft', 'zuordnung_hinweis'])
    .delete()

  await knex.schema.alterTable('ankuendigungen', (table) => {
    table.dropColumn('zuordnung_geprueft')
    table.dropColumn('zuordnung_hinweis')
  })
}
