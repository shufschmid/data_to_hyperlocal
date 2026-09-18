// One row of dataset 11990, read once and properly.
//
// «Abstimmungsresultate nach Vorlage, Gemeinde und Datum (seit 2003)» on
// data.bl.ch: one row per Vorlage and municipality, 34'658 of them, the fields
// of the federal standard. This module turns such a row into something the
// newsroom can reason about — and it is the ONLY place that knows the portal's
// spellings.
//
// Four things were measured on 18 September 2026 and every one of them is a
// trap somewhere else if it is read a second time:
//
// 1. **`counted` is the STRING "True"/"False", not a boolean.** A truthiness
//    test on it says yes for both, and "yes" means an article about a
//    municipality whose ballot papers are still being counted.
// 2. **`type` names three things**, and the third is not a Vorlage at all:
//    `proposal`, `counter-proposal` and `tie-breaker` — Initiative,
//    Gegenvorschlag and Stichfrage, all three under ONE `vote_id`.
// 3. **A Stichfrage's `answer` names the WINNING side**, not a yes or a no:
//    `proposal` or `counter-proposal`. Its `yeas` are the votes for the
//    Initiative, its `nays` those for the Gegenvorschlag (measured on
//    20260308_K5 and 20130303_K5, both consistent).
// 4. **`date` arrives in two shapes.** The export answers `2026-09-27`, the
//    records endpoint with `group_by` answers `2026-09-27T00:00:00+00:00`.

/** What the three `type` values of the source mean in German. */
export type Abstimmungsart = 'vorlage' | 'gegenvorschlag' | 'stichfrage'

/** Who put the question — `domain0` in the source. */
export type Abstimmungsebene = 'bund' | 'kanton'

const ART_JE_TYP: Readonly<Record<string, Abstimmungsart>> = {
  proposal: 'vorlage',
  'counter-proposal': 'gegenvorschlag',
  'tie-breaker': 'stichfrage'
}

const EBENE_JE_DOMAIN: Readonly<Record<string, Abstimmungsebene>> = {
  federation: 'bund',
  canton: 'kanton'
}

/**
 * The `answer` column, in German.
 *
 * Two vocabularies live in one column, and which one applies depends on the
 * row's `type`: a Vorlage is `accepted`/`rejected`, a Stichfrage names the side
 * that won. Both are translated here and nowhere else.
 */
const ANTWORT_JE_WERT: Readonly<Record<string, string>> = {
  accepted: 'angenommen',
  rejected: 'abgelehnt',
  proposal: 'initiative',
  'counter-proposal': 'gegenvorschlag'
}

/** One municipality's result for one Vorlage, as the newsroom reads it. */
export interface Abstimmungszeile {
  /** ISO day, always ten characters. */
  datum: string
  /** The BFS number — `entity_id` at the source. */
  bfs: string
  gemeinde: string
  /** `20260927_K3` — what carries Initiative, Gegenvorschlag and Stichfrage together. */
  voteId: string
  ebene: Abstimmungsebene | null
  art: Abstimmungsart
  titel: string
  /**
   * Whether THIS row is counted. The rule that hangs on it is in
   * `redaktion/abstimmunglauf.ts`: nothing is written while one row of a
   * municipality still says no.
   */
  ausgezaehlt: boolean
  /** `angenommen`/`abgelehnt`, or for a Stichfrage the winning side. */
  antwort: string | null
  ja: number | null
  nein: number | null
  prozentJa: number | null
  beteiligung: number | null
  stimmberechtigte: number | null
  leer: number | null
  ungueltig: number | null
  /** The canton's own publication of this Vorlage. The one address an article carries. */
  url: string | null
}

export interface Leseergebnis {
  zeilen: Abstimmungszeile[]
  /** German sentences: what was dropped and why. A gap is never silent. */
  verworfen: string[]
}

function text(wert: unknown): string | null {
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null
}

function zahl(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null
}

/** Ten characters, whichever of the two shapes the portal answered with. */
function tag(wert: unknown): string | null {
  const roh = text(wert)
  if (roh === null) return null
  const kurz = roh.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(kurz) ? kurz : null
}

/**
 * The one place `counted` is read.
 *
 * Anything that is not the literal `"True"` (or a real boolean `true`, should
 * the portal ever change its mind) counts as NOT counted. That direction is
 * deliberate: a misread here publishes an interim state as a result.
 */
export function istAusgezaehlt(wert: unknown): boolean {
  if (typeof wert === 'boolean') return wert
  return typeof wert === 'string' && wert.trim().toLowerCase() === 'true'
}

/** One record, or null when it is not a row this feed can use. */
export function parseZeile(record: unknown): Abstimmungszeile | null {
  if (typeof record !== 'object' || record === null) return null
  const roh = record as Record<string, unknown>

  const datum = tag(roh['date'])
  const bfs = text(roh['entity_id'])
  const voteId = text(roh['vote_id'])
  const typ = text(roh['type'])
  if (datum === null || bfs === null || voteId === null || typ === null) {
    return null
  }

  const art = ART_JE_TYP[typ]
  if (art === undefined) return null

  const antwort = text(roh['answer'])

  return {
    datum,
    bfs,
    gemeinde: text(roh['name']) ?? bfs,
    voteId,
    ebene: EBENE_JE_DOMAIN[text(roh['domain0']) ?? ''] ?? null,
    art,
    titel: text(roh['title_de_ch']) ?? '',
    ausgezaehlt: istAusgezaehlt(roh['counted']),
    antwort: antwort === null ? null : (ANTWORT_JE_WERT[antwort] ?? antwort),
    ja: zahl(roh['yeas']),
    nein: zahl(roh['nays']),
    prozentJa: zahl(roh['percent_yeas']),
    beteiligung: zahl(roh['percent_turnout']),
    stimmberechtigte: zahl(roh['eligible_voters']),
    leer: zahl(roh['empty']),
    ungueltig: zahl(roh['invalid']),
    url: text(roh['url_web'])
  }
}

/**
 * A whole answer, with what it could not use named rather than dropped.
 *
 * An unknown `type` is never filed under the nearest known one — the same
 * rule the gazette desk holds for an unmapped rubric. Guessing here would put
 * a fourth kind of ballot question into an article as if it were an
 * Initiative.
 */
export function parseZeilen(records: readonly unknown[]): Leseergebnis {
  const zeilen: Abstimmungszeile[] = []
  const verworfen: string[] = []

  for (const record of records) {
    const zeile = parseZeile(record)
    if (zeile !== null) {
      zeilen.push(zeile)
      continue
    }

    const roh =
      typeof record === 'object' && record !== null
        ? (record as Record<string, unknown>)
        : {}
    const kennung =
      text(roh['vote_id']) ?? text(roh['entity_id']) ?? 'ohne Kennung'
    const typ = text(roh['type'])
    verworfen.push(
      typ === null || ART_JE_TYP[typ] !== undefined
        ? `Zeile ${kennung} ist unvollstaendig und wurde nicht gelesen.`
        : `Zeile ${kennung}: unbekannte Art «${typ}» — nicht gelesen.`
    )
  }

  return { zeilen, verworfen }
}
