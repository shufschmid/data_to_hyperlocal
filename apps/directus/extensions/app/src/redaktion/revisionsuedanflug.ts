import type { GepruefteMeldung, RevisionsSchreibung } from './revision'
import { monatDeutsch } from './suedanfluglauf'
import { tagDeutsch } from '../shared/euroairport'

// The revision watchdog, third case: the EuroAirport.
//
// `revision.ts` does this for the statistics portal, `revisionsport.ts` for
// the sport desk, and this source is the one the whole idea was built for.
// The airport's figures are PROVISIONAL and stay that way — the sheet for
// December 2025 still said so on 30 January 2026 — and a month is re-uploaded
// under a new file name whenever it is revised. So an article that was correct
// on the day it went out can quietly stop being correct months later, and
// nothing else in the pipeline ever looks at it again.
//
// It states and it does not act. No retraction, no rewrite, no republishing: a
// person reads the finding and decides, and `/api/v1/korrekturen` carries that
// decision out. The same bargain as the two watchdogs next door.
//
// Two questions, in this order, both cheap — no model, no request:
//
//   1. Did the figures actually move? BOTH counts and the quota are compared,
//      not just the percentage: 3304 of 7556 is the same 43,7 percent and a
//      different month, and an article naming the absolute numbers is wrong
//      after such a correction while the quota alone says nothing happened.
//   2. Does the article still stand on the OLD state? Only the figures the
//      text actually WROTE DOWN count. «Der Juli war laut» survives every
//      revision, and flagging it would teach the desk to ignore the chip.

/** A month's figures as the watchdog compares them. */
export interface MonatsStand {
  jahr: number
  monat: number
  anfluege: number | null
  suedlandungen: number | null
  /** As printed, in percent. */
  quote: number | null
}

/** A published south-approach article as the watchdog reads it. */
export interface RevisionsQuotenMeldung extends GepruefteMeldung {
  id: string
  /** What the watchdog wrote here last time, if anything. */
  revision_hinweis?: string | null
}

function alsDeutsch(zahl: number): string {
  return String(zahl).replace('.', ',')
}

/** "43,7 Prozent", or the plain German for a sheet without a printed quota. */
function quoteText(wert: number | null): string {
  return wert === null ? 'keine Quote' : `${alsDeutsch(wert)} Prozent`
}

/**
 * Whether the text writes out this number.
 *
 * Both spellings of a decimal — the German comma the newsroom writes and the
 * point a model sometimes slips into — and never inside a longer number, so
 * «43» does not match the «43» in «2043».
 */
function nenntZahl(text: string, wert: number | null): boolean {
  if (wert === null) return false
  const deutsch = alsDeutsch(wert).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const englisch = String(wert).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const muster = new RegExp(
    `(?<![\\d,.])(?:${deutsch}|${englisch})(?![\\d,.])`,
    'u'
  )
  return muster.test(text)
}

/**
 * The German sentence for the editor, or `null` when there is nothing to say.
 *
 * `null` in three cases: nothing moved, the article has no text, or the
 * article never named what moved. The last one matters most — it is what keeps
 * the chip worth looking at.
 *
 * `jetzt` is handed in rather than read from the clock: this is a pure
 * function, and the tests say which day the finding is dated.
 */
export function revisionsBefundSuedanflug(
  meldung: GepruefteMeldung,
  alt: MonatsStand,
  neu: MonatsStand,
  jetzt: string
): string | null {
  const bewegt =
    alt.anfluege !== neu.anfluege ||
    alt.suedlandungen !== neu.suedlandungen ||
    alt.quote !== neu.quote
  if (!bewegt) return null

  const ganzerText = [meldung.titel, meldung.lead, meldung.text]
    .filter((teil): teil is string => typeof teil === 'string' && teil !== '')
    .join(' ')
  if (ganzerText === '') return null

  // Only what the article actually wrote down. A figure the old state carried
  // and the NEW one no longer does is the proof that the text is stale.
  const nenntAlteQuote =
    alt.quote !== neu.quote &&
    nenntZahl(ganzerText, alt.quote) &&
    !nenntZahl(ganzerText, neu.quote)
  const nenntAlteZahl =
    (alt.anfluege !== neu.anfluege && nenntZahl(ganzerText, alt.anfluege)) ||
    (alt.suedlandungen !== neu.suedlandungen &&
      nenntZahl(ganzerText, alt.suedlandungen))

  if (!nenntAlteQuote && !nenntAlteZahl) return null

  return (
    `Der EuroAirport hat die Zahlen fuer ${monatDeutsch(alt.jahr, alt.monat)} ` +
    `revidiert: neu ${neu.suedlandungen ?? '?'} von ${neu.anfluege ?? '?'} ` +
    `Landungen (${quoteText(neu.quote)} statt ${quoteText(alt.quote)}, ` +
    `Stand ${tagDeutsch(jetzt.slice(0, 10))}). ` +
    'Der Beitrag nennt noch den alten Stand. Bitte pruefen und entweder ' +
    'ueberarbeiten lassen oder zurueckziehen.'
  )
}

/**
 * What the watchdog writes after one month's figures moved.
 *
 * Only rows whose state actually CHANGES appear — a new finding, or the
 * clearing of one that no longer holds because the airport corrected back. An
 * article that was fine and stays fine is not touched, so `date_updated` keeps
 * meaning something. The same bargain as the two watchdogs next door.
 */
export function revisionsSchreibungenSuedanflug(
  meldungen: readonly RevisionsQuotenMeldung[],
  alt: MonatsStand,
  neu: MonatsStand,
  jetzt: string
): RevisionsSchreibung[] {
  const schreibungen: RevisionsSchreibung[] = []
  for (const meldung of meldungen) {
    const hinweis = revisionsBefundSuedanflug(meldung, alt, neu, jetzt)
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
