import type { Knex } from 'knex'

// The editor's hand on the wheel.
//
// Two columns, both for the same situation: the agenda says a statistic is out,
// the automatic match does not find the right dataset — or finds one whose
// figures are buried in a broader table — and a person knows better.
//
// `laeufe.vorgabe` is what the editor wants written: "vergleiche die Zahl der
// Betriebe mit dem Vorjahr und mit vor zehn Jahren, auch im Kantonsvergleich".
// It goes into the briefing and into the cached article prefix, so every
// article of the run follows it. Per run, never per municipality — anything
// municipality-specific in that prefix breaks the prompt cache.
//
// `datensaetze.gemeindefeld` overrides the automatic detection of the
// municipality column. That detection reads the portal's own field metadata and
// is right nearly always, but "nearly" is why this exists: without it, a dataset
// the portal annotates sloppily is unreachable for good, and the newsroom has no
// way to say "the column is called this".

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('laeufe', (table) => {
    table.text('vorgabe')
  })

  await knex.schema.alterTable('datensaetze', (table) => {
    table.string('gemeindefeld', 100)
  })

  await knex('directus_fields').insert([
    {
      collection: 'laeufe',
      field: 'vorgabe',
      interface: 'input-multiline',
      note: 'Was dieser Lauf schreiben soll. Fliesst in das Briefing und in jede Meldung ein.',
      sort: 20,
      width: 'full'
    },
    {
      collection: 'datensaetze',
      field: 'gemeindefeld',
      interface: 'input',
      note: 'Nur setzen, wenn die Gemeindespalte nicht automatisch erkannt wird. Exakter Feldname im Portal.',
      sort: 20,
      width: 'half'
    }
  ])
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields')
    .where({ collection: 'laeufe', field: 'vorgabe' })
    .delete()
  await knex('directus_fields')
    .where({ collection: 'datensaetze', field: 'gemeindefeld' })
    .delete()

  await knex.schema.alterTable('laeufe', (table) => {
    table.dropColumn('vorgabe')
  })
  await knex.schema.alterTable('datensaetze', (table) => {
    table.dropColumn('gemeindefeld')
  })
}
