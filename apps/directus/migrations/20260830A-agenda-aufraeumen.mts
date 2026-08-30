import type { Knex } from 'knex'

/**
 * Two repairs to agenda rows that already exist — no structure, only data.
 *
 * 1. **„Zur Anmeldung" is not an announcement.** The newsletter sign-up link
 *    sits between the entries on the agenda page and passed every shape test
 *    the parser applied: short enough, no date of its own, wrapped in an
 *    anchor. It has been sitting in the workspace as a published announcement
 *    since 21 August. The parser now rejects it (`istNavigationszeile`), which
 *    stops the next one — this removes the one already stored.
 *
 * 2. **Entries the mapping gave up on get a second chance.** Until now an
 *    announcement was matched to a dataset from its three-word title alone,
 *    and „Abfallstatistik 2025" against 188 catalogue titles is a coin toss.
 *    A failed attempt was stamped `zuordnung_geprueft` so no run would ask
 *    again — correct then, wrong now: the mapping reads the office's own web
 *    article since this change and can answer questions the title could not.
 *    Clearing the stamp on exactly those entries lets the next daily run try
 *    again, with the better material.
 *
 * Idempotent, and narrow on purpose: only published entries that link a web
 * article and still have no dataset. An entry an editor assigned by hand is
 * never touched.
 */

export async function up(knex: Knex): Promise<void> {
  const hatTabelle = await knex.schema.hasTable('ankuendigungen')
  if (!hatTabelle) return

  // Matched on title AND link, not on `schluessel`: that key is derived from
  // the title by a hook and its exact shape is not this file's business.
  // Requiring both also means a genuine announcement that happens to be called
  // something similar is never caught by accident.
  //
  // A row that already carries a dataset link and a run would orphan those, so
  // only the untouched ones go.
  const geloescht = await knex('ankuendigungen')
    .whereRaw('lower(titel) in (?, ?, ?)', [
      'zur anmeldung',
      'zum newsletter',
      'newsletter'
    ])
    .where('link', 'like', '%anmeldung%')
    .whereNull('datensatz')
    .delete()

  if (geloescht > 0) {
    console.log(`Agenda: ${geloescht} Navigationszeile(n) entfernt.`)
  }

  const zurueckgesetzt = await knex('ankuendigungen')
    .where('status', 'publiziert')
    .whereNull('datensatz')
    .whereNotNull('zuordnung_geprueft')
    .where('link', 'like', '%webartikel%')
    .update({ zuordnung_geprueft: null, link_geprueft: null })

  if (zurueckgesetzt > 0) {
    console.log(
      `Agenda: ${zurueckgesetzt} Eintrag/Eintraege zur erneuten Zuordnung freigegeben.`
    )
  }
}

export async function down(): Promise<void> {
  // Nothing to restore: a deleted navigation row is noise, and an empty
  // `zuordnung_geprueft` only means the next run looks again.
}
