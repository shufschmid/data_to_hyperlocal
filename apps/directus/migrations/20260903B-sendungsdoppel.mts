import type { Knex } from 'knex'

/**
 * Removes the duplicate broadcast candidates the old segmentation produced —
 * row data, no structure.
 *
 * Until `beitraegeAusEdition` gave every topic its own passage, the main
 * contribution was judged on the WHOLE transcript. A Regionaljournal show
 * trails all its topics in the opening breath and then covers each at length,
 * so every "Ausserdem" topic was inventoried twice: once inside that full text,
 * once on its own. Measured on the development data: six of 22 candidates were
 * such pairs — the same Streetart project in Bottmingen, the same Arsen
 * clean-up in Pratteln, twice each.
 *
 * DELETED rather than rejected, and that distinction is the whole point: a
 * rejection is this feed's memory and rides into the next inventory as an
 * example. Rejecting the copy would teach the model that Streetart in
 * Bottmingen is not worth a story — the opposite of what happened.
 *
 * Narrow by construction: only rows that are still OPEN (a decided one is
 * memory and is never touched), only where a sibling for the SAME edition and
 * the SAME municipality carries a timestamp, and only the copy without one.
 * The one with the timestamp is the better row: it points at the passage where
 * the topic is actually covered, which is what `topics-prompt.ts` resolved it
 * to.
 */

export async function up(knex: Knex): Promise<void> {
  const hatTabelle = await knex.schema.hasTable('sendungskandidaten')
  if (!hatTabelle) return

  const geloescht = await knex('sendungskandidaten')
    .where('quelle', 'regionaljournal')
    .where('entscheid', 'offen')
    .whereNull('zeitmarke_sekunden')
    .whereNotNull('edition')
    .whereExists(function () {
      this.select(knex.raw('1'))
        .from('sendungskandidaten as andere')
        .whereRaw('andere.edition = sendungskandidaten.edition')
        .whereRaw('andere.gemeinde = sendungskandidaten.gemeinde')
        .whereRaw('andere.id <> sendungskandidaten.id')
        .whereRaw('andere.zeitmarke_sekunden is not null')
    })
    .delete()

  if (geloescht > 0) {
    console.log(
      `Sendungskandidaten: ${geloescht} Doppel ohne Zeitmarke entfernt.`
    )
  }
}

export async function down(): Promise<void> {
  // Nothing to restore: a duplicate proposal is noise, and the row that was
  // kept carries the same story plus the timestamp.
}
