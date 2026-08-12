import type { Knex } from 'knex'

/**
 * Removes the template's example collection.
 *
 * Deleting `20260729A-example-notes-collection.mts` is not enough on a database
 * where it already ran: the table, its `directus_collections` row and its nine
 * `directus_fields` rows all stay behind, and the collection keeps showing up
 * in the admin UI next to the real ones. So the teardown is its own migration
 * rather than an edit to the one that created it — that one has run, and a
 * migration that has run is never edited.
 *
 * Written to be a no-op on a fresh install, where `notes` never existed.
 */
export async function up(knex: Knex): Promise<void> {
  await knex('directus_fields').where({ collection: 'notes' }).delete()
  await knex('directus_collections').where({ collection: 'notes' }).delete()
  await knex.schema.dropTableIfExists('notes')
}

export async function down(): Promise<void> {
  // Deliberately empty. The example is gone from the codebase, so there is
  // nothing to restore it from — and nothing that would want it back.
}
