// The revision watchdog for the sport desk: what happens to a published match
// report when the association changes the result under it.
//
// `revision.ts` next door does this for statistics, and the case here is the
// same one seen from the other side. An association revises too — a forfait, a
// protest upheld, a typo in the score sheet — and `sportresultate-holen` reads
// the results afresh every morning and writes the corrected figures onto the
// `spiele` row. The published report that points at that row (`meldungen.spiel`)
// then names a score the source no longer carries, and nothing in the pipeline
// ever looks at it again.
//
// So this looks. It states and it does not act: no retraction, no revision, no
// republishing. A person decides, and `/korrekturen` carries the decision out.
//
// Two questions, in this order, and both cheap — no model, no request:
//
//   1. Did the goals or the calendar day actually move? If not, nothing.
//   2. Does the report still stand on the OLD state? Two nets catch that.
//      The digit check is IMPORTED from `spielbericht.ts` whole, the same one
//      that cleared the report for publication, so the watchdog and the
//      publication gate answer the same question the same way: any digit the
//      NEW state no longer supports, and which the old row carried, is proof.
//      And the scoreline is compared as a PAIR, because a correction routinely
//      shares a digit with what it replaced — after 1:1 became 2:1 no single
//      digit of "1:1" is unsupported (the new match still has a 1 in it) while
//      the pair is plainly wrong. The digit net alone would stay silent on the
//      most ordinary correction there is.

import type { GepruefteMeldung, RevisionsSchreibung } from './revision'
import { absolutesDatum, zahlWarnungen, type SpielFakten } from './spielbericht'
import { ZAHL_WARNUNG } from './warnungen'

/** The match as it stood before the source touched it. */
export interface SpielStand {
  tore_heim: number | null
  tore_gast: number | null
  /** ISO instant of kick-off. */
  datum: string
}

/**
 * The match as the source now has it.
 *
 * Wider than `SpielStand` because the new state also supplies the allowance for
 * the digit check: everything `zahlWarnungen` counts as handed material.
 */
export interface RevisionsSpiel extends SpielStand {
  heim: string
  gast: string
  wettbewerb: string
  ort: string | null
}

/** A published match report as the watchdog reads it. */
export interface RevisionsSpielMeldung extends GepruefteMeldung {
  id: string
  /** What the watchdog wrote here last time, if anything. */
  revision_hinweis?: string | null
}

/** "2:1", or the plain German for a result the source pulled back. */
function resultat(spiel: SpielStand): string {
  if (spiel.tore_heim === null || spiel.tore_gast === null) {
    return 'kein Resultat'
  }
  return `${spiel.tore_heim}:${spiel.tore_gast}`
}

function hatResultat(spiel: SpielStand): boolean {
  return spiel.tore_heim !== null && spiel.tore_gast !== null
}

/**
 * The new state as the imported check wants it.
 *
 * Only the fields that carry digits matter here; everything else the prompt
 * uses (club, league, the newsroom's note, earlier matches) is deliberately
 * left empty. It can only make the allowance SMALLER, and a smaller allowance
 * never invents a finding: what comes out is intersected with the digits the
 * OLD row actually carried.
 *
 * A withdrawn score has no number at all, and `NaN` is exactly that — it
 * renders as "NaN" and therefore allows nothing.
 */
function faktenAus(spiel: RevisionsSpiel): SpielFakten {
  return {
    heim: spiel.heim,
    gast: spiel.gast,
    toreHeim: spiel.tore_heim ?? Number.NaN,
    toreGast: spiel.tore_gast ?? Number.NaN,
    wettbewerb: spiel.wettbewerb,
    datum: spiel.datum,
    ort: spiel.ort,
    verein: '',
    gemeinde: '',
    liga: null,
    notiz: null,
    quelle: null,
    telegramm: null,
    frueher: []
  }
}

/** The digits in the text the new state no longer supports. */
function unbelegteZiffern(text: string, neu: RevisionsSpiel): Set<string> {
  const zahlen = new Set<string>()
  for (const warnung of zahlWarnungen(text, faktenAus(neu))) {
    const treffer = ZAHL_WARNUNG.exec(warnung)
    if (treffer?.[1] !== undefined) zahlen.add(treffer[1])
  }
  return zahlen
}

/** Whether the text writes out this scoreline, with or without spaces. */
function nenntResultat(text: string, spiel: SpielStand): boolean {
  if (!hatResultat(spiel)) return false
  const muster = new RegExp(
    `(?<!\\d)${spiel.tore_heim}\\s*:\\s*${spiel.tore_gast}(?!\\d)`
  )
  return muster.test(text)
}

/**
 * Whether the report still stands on the old score.
 *
 * The scoreline first, then the digit net for the many ways a figure reaches a
 * text without a colon in it ("mit 3 Toren Vorsprung").
 */
function nenntAltesResultat(
  text: string,
  alt: SpielStand,
  neu: RevisionsSpiel
): boolean {
  if (!hatResultat(alt)) return false
  if (nenntResultat(text, alt)) return true
  const unbelegt = unbelegteZiffern(text, neu)
  return (
    unbelegt.has(String(alt.tore_heim)) || unbelegt.has(String(alt.tore_gast))
  )
}

/**
 * Whether the report still names the old day.
 *
 * Dates are written out in full by rule ("am 6. September 2026"), so the
 * rendered day is what a report carries and what is looked for. `absolutesDatum`
 * is imported rather than rebuilt: the same function writes the date into the
 * prompt in the first place.
 */
function nenntAltesDatum(text: string, alt: SpielStand): boolean {
  return text.includes(absolutesDatum(alt.datum))
}

/**
 * The German sentence for the editor, or `null` when there is nothing to say.
 *
 * `null` in three cases: nothing moved, the report has no text, or the report
 * never stood on what moved. The last one is the important one — a report that
 * says "der FC gewann auswaerts" and no more is still true after a 1:1 became a
 * 2:1, and flagging it would train the desk to ignore the chip.
 *
 * `jetzt` is handed in rather than read from the clock: this is a pure function,
 * and the tests say which day the finding is dated.
 */
export function revisionsBefundSpiel(
  meldung: GepruefteMeldung,
  alt: SpielStand,
  neu: RevisionsSpiel,
  jetzt: string
): string | null {
  const resultatGeaendert =
    alt.tore_heim !== neu.tore_heim || alt.tore_gast !== neu.tore_gast
  // The calendar day in Zurich, not the instant: a kick-off moved from 18:00 to
  // 19:00 changes nothing a report ever wrote down.
  const datumGeaendert = absolutesDatum(alt.datum) !== absolutesDatum(neu.datum)
  if (!resultatGeaendert && !datumGeaendert) return null

  const ganzerText = [meldung.titel, meldung.lead, meldung.text]
    .filter((teil): teil is string => typeof teil === 'string' && teil !== '')
    .join(' ')
  if (ganzerText === '') return null

  const korrekturen: string[] = []
  const genannt: string[] = []

  if (resultatGeaendert && nenntAltesResultat(ganzerText, alt, neu)) {
    korrekturen.push(
      `das Resultat korrigiert: ${resultat(neu)} statt ${resultat(alt)}`
    )
    genannt.push('das alte Resultat')
  }
  if (datumGeaendert && nenntAltesDatum(ganzerText, alt)) {
    korrekturen.push(
      `das Spieldatum verschoben: ${absolutesDatum(neu.datum)} statt ${absolutesDatum(alt.datum)}`
    )
    genannt.push('das alte Datum')
  }
  if (korrekturen.length === 0) return null

  return (
    `Der Verband hat ${korrekturen.join(' und ')} ` +
    `(Stand ${absolutesDatum(jetzt)}). ` +
    `Der Bericht nennt noch ${genannt.join(' und ')}.`
  )
}

/**
 * What the watchdog writes after one match's row moved.
 *
 * Only rows whose state actually CHANGES appear — a new finding, or the
 * clearing of one that no longer holds because the association corrected back.
 * A report that was fine and stays fine is not touched, so `date_updated` keeps
 * meaning something. Same bargain as `revisionsSchreibungen` next door.
 */
export function revisionsSchreibungenSpiel(
  meldungen: readonly RevisionsSpielMeldung[],
  alt: SpielStand,
  neu: RevisionsSpiel,
  jetzt: string
): RevisionsSchreibung[] {
  const schreibungen: RevisionsSchreibung[] = []
  for (const meldung of meldungen) {
    const hinweis = revisionsBefundSpiel(meldung, alt, neu, jetzt)
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
