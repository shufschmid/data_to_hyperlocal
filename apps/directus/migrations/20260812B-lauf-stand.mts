import type { Knex } from 'knex'

// Remembering which state of a dataset already got a run.
//
// Without it the queue in `eroeffneLaeufe` was head-of-line blocked, and the
// blockage was invisible: it takes the three oldest `relevant` datasets by
// `date_updated` on every tick, and datasets that can never open a run kept
// those three seats for good. Measured on the live database, the seats were
// held by 12060 (a run already existed), 12150 and 10960 (no date column at
// all, so no unambiguous period) — every two minutes, for ever. Nothing behind
// them was ever going to be written up, and no error said so, because the
// operation's return value goes nowhere.
//
// `lauf_stand` is the content fingerprint a run was last opened for. Equal to
// `letzter_stand` means "this state is dealt with"; the daily source check
// writes a new `letzter_stand` when the data actually moves, which puts the
// dataset back in the queue by itself.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('datensaetze', (table) => {
    table.string('lauf_stand', 120)
  })

  await knex('directus_fields').insert({
    collection: 'datensaetze',
    field: 'lauf_stand',
    interface: 'input',
    note: 'Stand, fuer den zuletzt ein Lauf eroeffnet wurde. Leeren, um erneut einen Lauf zu erzwingen.',
    readonly: true,
    sort: 22,
    width: 'half'
  })

  // The datasets that were holding the seats. They keep their assessment; what
  // changes is that they stop blocking. `ignoriert` is reversible in the admin
  // UI, and the note says what to do instead.
  await knex('datensaetze')
    .whereIn('externe_id', ['12150', '10960'])
    .andWhere({ status: 'relevant' })
    .update({
      status: 'ignoriert',
      bewertung:
        'Nicht relevant: keine eindeutige Zeitachse. Fuer einen Lauf im Reiter "Angekuendigt" einen Auftrag von Hand geben.'
    })
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields')
    .where({ collection: 'datensaetze', field: 'lauf_stand' })
    .delete()

  await knex.schema.alterTable('datensaetze', (table) => {
    table.dropColumn('lauf_stand')
  })
}
