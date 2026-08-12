import type { Knex } from 'knex'

// Letting the hook own `ankuendigungen.schluessel`, all the way to GraphQL.
//
// The key has always been derived from the title by the `ankuendigung-schluessel`
// filter hook, on every write path — that is what keeps a hand-typed entry and a
// fetched one the same row instead of two. But the column was NOT NULL without a
// default, so Directus typed it `String!` in the GraphQL input and rejected the
// mutation *before* any hook could run:
//
//   Field "create_ankuendigungen_input.schluessel" of required type "String!"
//   was not provided.
//
// Which meant the one path that exists for a blocked agenda — a person typing in
// what they read on the page — was closed from the workspace.
//
// A default makes the field optional at the API boundary without weakening the
// column: the hook overwrites it on every write, so the empty string is never
// what ends up stored.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ankuendigungen', (table) => {
    table.string('schluessel', 200).notNullable().defaultTo('').alter()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ankuendigungen', (table) => {
    table.string('schluessel', 200).notNullable().alter()
  })
}
