// The revision watchdog: what happens to a published article when the source
// changes its numbers under it.
//
// Statistics offices revise. A provisional figure becomes a final one, a
// municipality reports late, a category is reclassified — and an article that
// was correct on the day it went out quietly stops being correct. Nobody
// notices, because nothing in the pipeline ever looks at a published article
// again.
//
// So this looks. When `daten_stand` of a dataset rises, every published article
// of that dataset is measured against the NEW rows with the very function that
// cleared it for publication in the first place (`unbelegteProzentangaben`),
// and the figures that no longer stand are written onto the row.
//
// Three things it deliberately does NOT do. It has no threshold of its own —
// borrowing `zahlen.ts` whole is the point, because a second tolerance would
// drift from the first and the two would disagree about the same article. It
// checks percentages only, for the same reason the publication gate does: a
// percentage is always derived and always one we supplied, while raw values
// appear in a text in many legitimate forms. And it never publishes, revises
// or retracts anything — it states a finding and leaves the decision to a
// person. A machine that silently pulls yesterday's journalism is worse than
// one that says nothing.

import type { OdsRecord } from '../shared/ods'
import {
  beschreibeEinordnung,
  type FrischeZeilen,
  type Zeitreihe
} from './kontext'
import {
  ableitbareProzentangaben,
  erlaubteProzentangaben,
  unbelegteProzentangaben
} from './zahlen'

/** The parts of a Meldung this check reads. Structural, so tests need no row. */
export interface GepruefteMeldung {
  titel: string | null
  lead: string | null
  text: string | null
}

/**
 * The percentages in a published article that the new state no longer supports.
 *
 * `null` means nothing to report — the article still stands. The allowance is
 * built exactly as the publication gate builds it: everything honest arithmetic
 * derives from the new rows, plus whatever the new einordnung states
 * (`erlaubteZusaetzlich`, the caller's `erlaubteProzentangaben(einordnung)`).
 *
 * Empty rows yield `null` rather than a finding. A municipality that dropped
 * out of the dataset is a gap in the source, not a wrong article, and flagging
 * every figure in that case would bury the real findings.
 */
export function revisionsBefund(
  meldung: GepruefteMeldung,
  neueZeilen: readonly OdsRecord[],
  erlaubteZusaetzlich: readonly number[],
  reihen: readonly Zeitreihe[] = []
): number[] | null {
  const ganzerText = [meldung.titel, meldung.lead, meldung.text]
    .filter((teil): teil is string => typeof teil === 'string' && teil !== '')
    .join(' ')
  if (ganzerText === '') return null
  if (neueZeilen.length === 0) return null

  const erlaubt = [
    ...erlaubteZusaetzlich,
    ...ableitbareProzentangaben(neueZeilen, reihen)
  ]

  const unbelegt = unbelegteProzentangaben(ganzerText, erlaubt)
  return unbelegt.length === 0 ? null : unbelegt
}

/** The German sentence that goes on the row, for the editor to act on. */
export function revisionsHinweis(unbelegt: readonly number[]): string {
  const zahlen = unbelegt.map((z) => `${z} Prozent`).join(', ')
  return (
    `Die Quelle hat ihre Zahlen revidiert. Diese Angaben im Text sind im ` +
    `neuen Stand nicht mehr belegt: ${zahlen}. Bitte den Beitrag pruefen und ` +
    `entweder ueberarbeiten lassen oder zurueckziehen.`
  )
}

/** A published article as the watchdog reads it. */
export interface RevisionsMeldung extends GepruefteMeldung {
  id: string
  /** The municipality's id — the key into the freshly fetched rows. */
  gemeinde: string
  /** What the watchdog wrote here last time, if anything. */
  revision_hinweis?: string | null
}

export interface RevisionsSchreibung {
  id: string
  revision_hinweis: string | null
  revision_geprueft_am: string
}

/**
 * What the watchdog writes after one pass over a dataset's published articles.
 *
 * Only rows whose state actually CHANGES appear: a new finding, or the clearing
 * of one that no longer holds. An article that was fine and stays fine is not
 * touched — the run would otherwise rewrite every published article of the
 * dataset on every revision, and `date_updated` would stop meaning anything.
 *
 * A municipality missing from the fresh rows is skipped entirely, not cleared:
 * we learned nothing about it this time, and silently dropping a standing
 * finding because an export came back short would be the worst of both.
 *
 * The allowance per municipality is built exactly as stage A builds it — its
 * own rows plus the einordnung over the whole slice — so the watchdog and the
 * publication gate answer the same question the same way.
 */
export function revisionsSchreibungen(
  meldungen: readonly RevisionsMeldung[],
  frischJeGemeinde: ReadonlyMap<string, FrischeZeilen>,
  jetzt: string
): RevisionsSchreibung[] {
  const schreibungen: RevisionsSchreibung[] = []
  // One einordnung per municipality, not per article: a dataset routinely
  // carries several periods' articles for the same place.
  const einordnungen = new Map<string, number[]>()

  for (const meldung of meldungen) {
    const frisch = frischJeGemeinde.get(meldung.gemeinde)
    if (frisch === undefined || frisch.eigene.length === 0) continue

    let erlaubt = einordnungen.get(meldung.gemeinde)
    if (erlaubt === undefined) {
      erlaubt = erlaubteProzentangaben(
        beschreibeEinordnung(frisch.eigene, frisch.alle)
      )
      einordnungen.set(meldung.gemeinde, erlaubt)
    }

    const unbelegt = revisionsBefund(meldung, frisch.eigene, erlaubt)
    const hinweis = unbelegt === null ? null : revisionsHinweis(unbelegt)
    const stand = meldung.revision_hinweis ?? null

    if (hinweis === stand) continue
    schreibungen.push({
      id: meldung.id,
      revision_hinweis: hinweis,
      revision_geprueft_am: jetzt
    })
  }

  return schreibungen
}
