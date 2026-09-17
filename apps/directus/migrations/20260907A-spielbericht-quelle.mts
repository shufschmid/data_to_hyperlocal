import type { Knex } from 'knex'

/**
 * Puts the association link under the match reports written before there was
 * one — row data, no structure.
 *
 * Every other feed's article names a source the reader can open. A match report
 * did not, and the newsroom asked for it: a published report has to say where
 * the result stands. `redaktion/spielbericht.ts` now appends that line when a
 * report is written or revised, and `pruefeUebergang` refuses to publish one
 * without it.
 *
 * Which leaves the drafts already on the desk. Without this they could only be
 * published after a trip through the chat — a model call and a rewritten text
 * for a line the code can put there itself.
 *
 * The address and the wording are duplicated from `redaktion/spielbericht.ts`
 * on purpose: a migration is its own npm package and cannot import the
 * extension bundle. The rule lives there; this is a one-time copy of what it
 * produced on 7 September 2026.
 */

const VERBAND: Readonly<Record<string, string>> = {
  fvnws: 'Fussballverband Nordwestschweiz',
  swissvolley: 'Swiss Volley',
  handball: 'Swiss Handball'
}

interface Zeile {
  id: string
  text: string | null
  /** `vereine.ergebnis_url` — the club page, which keeps the result. */
  vereinsseite: string | null
  /** `spiele.quelle_url` — the page the fixture was read from. */
  spielplan: string | null
  quelle: string | null
}

export async function up(knex: Knex): Promise<void> {
  for (const tabelle of ['meldungen', 'spiele', 'vereine']) {
    if (!(await knex.schema.hasTable(tabelle))) return
  }

  const ohneLink = (await knex('meldungen')
    .join('spiele', 'spiele.id', 'meldungen.spiel')
    .leftJoin('vereine', 'vereine.id', 'spiele.verein')
    .whereNotNull('meldungen.text')
    .whereRaw("meldungen.text not like '%http%'")
    .select(
      'meldungen.id as id',
      'meldungen.text as text',
      'vereine.ergebnis_url as vereinsseite',
      'spiele.quelle_url as spielplan',
      'vereine.quelle as quelle'
    )) as Zeile[]

  let ergaenzt = 0
  for (const zeile of ohneLink) {
    // The club page first, the fixture list second — the football "what's on"
    // page only looks forward and no longer carries the match a week later.
    const url = (zeile.vereinsseite ?? zeile.spielplan ?? '').trim()
    if (url === '' || zeile.text === null) continue

    const verband = VERBAND[zeile.quelle ?? ''] ?? 'Verbandsseite'
    await knex('meldungen')
      .where('id', zeile.id)
      .update({
        text: `${zeile.text.trimEnd()}\n\nQuelle: ${verband}, ${url}`
      })
    ergaenzt += 1
  }

  const ohneAdresse = ohneLink.length - ergaenzt
  if (ergaenzt > 0 || ohneAdresse > 0) {
    console.log(
      `Spielberichte: ${ergaenzt} mit Quellenzeile ergaenzt, ${ohneAdresse} ohne bekannte Adresse.`
    )
  }
}

export async function down(): Promise<void> {
  // Deliberately irreversible, and audible rather than silent. The line names
  // the page the result stands on; taking it back out would leave a published
  // report pointing at nothing, which is the state this migration exists to
  // end, and `pruefeUebergang` would then refuse to publish those reports at
  // all. An empty `down` reported a rollback that never happened; refusing out
  // loud is the form `migrations-reversible-mts` accepts for a change that
  // cannot be undone.
  throw new Error(
    'Nicht umkehrbar: die Quellenzeile bleibt unter den Spielberichten stehen. ' +
      'Sie wieder zu entfernen liesse publizierte Berichte auf nichts zeigen, ' +
      'und pruefeUebergang laesst einen Bericht ohne Quellenlink gar nicht erst publizieren.'
  )
}
