import type { Knex } from 'knex'

// `ankuendigungen.schluessel` belongs to the hook, and now the column says so.
//
// The default added in 20260812C did not help: Directus types a NOT NULL column
// as `String!` in the GraphQL input regardless of its default, and rejects the
// mutation before any hook can run. So a hook-derived column can be NOT NULL
// *or* writable through the API, not both.
//
// It has to be writable. The one path that exists when the agenda host turns us
// away is a person typing in what they read on the page, and that path runs
// through the API like everything else in the workspace.
//
// Nothing is actually loosened: `ankuendigung-schluessel` is a `filter` hook on
// create and update, so it sets the key on every write path there is — admin
// UI, REST, GraphQL, other extensions — derived from a title that is itself
// NOT NULL. The constraint was a second copy of a guarantee we already had, and
// the copy was the one blocking the door.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ankuendigungen', (table) => {
    table.string('schluessel', 200).nullable().alter()
  })
}

export async function down(knex: Knex): Promise<void> {
  // Rows without a key would break the constraint on the way back; the hook
  // fills them, so this is a repair rather than a guess.
  await knex('ankuendigungen')
    .whereNull('schluessel')
    .update({ schluessel: knex.raw('lower(titel)') })

  await knex.schema.alterTable('ankuendigungen', (table) => {
    table.string('schluessel', 200).notNullable().defaultTo('').alter()
  })
}
