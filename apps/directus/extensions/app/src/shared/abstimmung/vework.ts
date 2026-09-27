import type { OdsFetch } from '../ods'
import type { Abstimmungsart, Abstimmungszeile, Leseergebnis } from './parse'

// The canton's own live publication of a vote day — abstimmungen.bl.ch.
//
// Why a second door (measured on the vote Sunday of 27 September 2026): the
// canton published every municipality's final result on its live app at 14:02,
// while dataset 11990 on data.bl.ch still carried all 430 rows of the day as
// `counted: "False"` with empty figures — and the portal's copy of a vote day
// arrives on no schedule we can see. The newsroom's words: the results must be
// in Monday's briefing. So on a vote day the run reads the live publication
// first and falls back to the portal.
//
// It is the SAME data, not a second truth: the portal's own `url_web` points at
// this app (`vework-public.bl.ch/app/publication/<day>/issues/<part>`, which
// redirects here), and its parts are the portal's parts one to one — `e1` is
// `20260927_E1`, `k3a`/`k3b`/`k3c` are the Initiative, the Gegenvorschlag and
// the Stichfrage of `20260927_K3`. Measured the same afternoon: over all four
// Vorlagen checked, the sum of the 86 municipalities matches the canton's own
// total exactly.
//
// The door is the one the app itself calls (Sitrox's VeWork): plain JSON files
// under `/data/publication/` — the list of vote days, then per part the
// results of every municipality. No key, and the host serves no robots.txt
// (404). One request for the list, one per part: six requests for a five-part
// Sunday, every half hour between noon and evening.
//
// This module only MAPS: into the very `Abstimmungszeile` the portal's parser
// produces, so every rule downstream — counted per municipality over the whole
// day, the cantonal sum over all 86 or none, the Stichfrage only when it
// decides — holds unchanged whichever door the figures came through.

/** Where the app's JSON lives. A row setting (`quellen.konfiguration.abstimmungen_live`), this is only its measured value. */
export const VEWORK_BASIS_BL = 'https://abstimmungen.bl.ch/data/publication'

/**
 * The address an article links for one part — the same form the portal's
 * `url_web` carries, so an article is identical whichever door fed it.
 */
export function veworkLink(datum: string, frontendId: string): string {
  return `https://vework-public.bl.ch/app/publication/${datum}/issues/${frontendId}`
}

interface Uebersetzt {
  de?: unknown
}

interface VeworkIssue {
  id?: unknown
  frontend_id?: unknown
  scope?: unknown
  title?: Uebersetzt
  poll_info?: { subtype?: unknown; main_poll_id?: unknown } | null
}

interface VeworkTag {
  date?: unknown
  frontend_id?: unknown
  issues?: unknown
}

interface PollData {
  yes_votes?: unknown
  yes_votes_percentage?: unknown
  no_votes?: unknown
  poll_result?: unknown
}

interface VeworkRecord {
  bfs_number?: unknown
  type?: unknown
  finished?: unknown
  name?: Uebersetzt
  results?: {
    eligible_voters?: unknown
    participation?: unknown
    invalid_ballots?: unknown
    empty_ballots?: unknown
    poll_data?: PollData | null
  } | null
}

function text(wert: unknown): string | null {
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null
}

function zahl(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null
}

function daten(payload: unknown): unknown {
  return typeof payload === 'object' && payload !== null
    ? (payload as { data?: unknown }).data
    : undefined
}

/** VeWork's `poll_info.subtype` in the newsroom's three kinds. Unknown is a Vorlage. */
export function artAusSubtyp(subtyp: unknown): Abstimmungsart {
  const wert = text(subtyp) ?? ''
  if (wert.startsWith('tie')) return 'stichfrage'
  if (wert === 'counter_proposal') return 'gegenvorschlag'
  return 'vorlage'
}

/**
 * The portal's `vote_id` of a part: the day, and the MAIN question's part id
 * without its letter — `k3b` of 27.09.2026 is `20260927_K3`, like `k3a` and
 * `k3c`, so the three reach one article as they do from the portal.
 */
export function voteIdAus(datum: string, frontendId: string): string {
  return `${datum.replace(/-/g, '')}_${frontendId.replace(/[a-z]$/i, '').toUpperCase()}`
}

/** One vote day from the list, or null when the canton publishes none for that day. */
export function findeTag(payload: unknown, datum: string): VeworkTag | null {
  const liste = daten(payload)
  if (!Array.isArray(liste)) return null
  for (const eintrag of liste) {
    if (typeof eintrag !== 'object' || eintrag === null) continue
    const tag = eintrag as VeworkTag
    if (text(tag.date)?.slice(0, 10) === datum) return tag
  }
  return null
}

/** The parts of a day as `{id, frontendId, art, ebene, titel}`. */
export function teileAus(tag: VeworkTag): Array<{
  id: string
  frontendId: string
  art: Abstimmungsart
  ebene: Abstimmungszeile['ebene']
  titel: string
}> {
  const issues = Array.isArray(tag.issues) ? (tag.issues as VeworkIssue[]) : []
  const teile: ReturnType<typeof teileAus> = []
  for (const issue of issues) {
    const id = typeof issue.id === 'number' ? String(issue.id) : text(issue.id)
    const frontendId = text(issue.frontend_id)
    if (id === null || frontendId === null) continue
    const scope = text(issue.scope)
    teile.push({
      id,
      frontendId,
      art: artAusSubtyp(issue.poll_info?.subtype),
      ebene:
        scope === 'federal' ? 'bund' : scope === 'cantonal' ? 'kanton' : null,
      titel: text(issue.title?.de) ?? ''
    })
  }
  return teile
}

/**
 * A Stichfrage names the side that WON, as the portal does: VeWork's «yes»
 * are the votes for the Initiative, its «no» those for the Gegenvorschlag —
 * the canton's own message on 27.09.2026, „Bei der Stichfrage wurde der
 * Gegenvorschlag bevorzugt", stood beside 22'712 yes against 39'770 no.
 */
function antwortAus(
  art: Abstimmungsart,
  poll: PollData | null | undefined
): string | null {
  if (poll === null || poll === undefined) return null
  if (art === 'stichfrage') {
    const ja = zahl(poll.yes_votes)
    const nein = zahl(poll.no_votes)
    if (ja === null || nein === null || ja === nein) return null
    return ja > nein ? 'initiative' : 'gegenvorschlag'
  }
  const ergebnis = text(poll.poll_result)
  if (ergebnis === 'accepted') return 'angenommen'
  if (ergebnis === 'rejected') return 'abgelehnt'
  return null
}

/**
 * The municipality rows of one part, in the portal's shape. A record that is
 * not a municipality, or carries no BFS number, is named and dropped — the
 * cantonal sum is only ever computed over what is here, so a silent gap would
 * be a wrong number.
 */
export function zeilenAusTeil(
  datum: string,
  teil: ReturnType<typeof teileAus>[number],
  payload: unknown
): Leseergebnis {
  const inhalt = daten(payload)
  const records =
    typeof inhalt === 'object' &&
    inhalt !== null &&
    Array.isArray((inhalt as { records?: unknown }).records)
      ? ((inhalt as { records: unknown[] }).records as VeworkRecord[])
      : null
  if (records === null)
    return {
      zeilen: [],
      verworfen: [`Teil ${teil.frontendId}: keine Resultate in der Antwort.`]
    }

  const zeilen: Abstimmungszeile[] = []
  const verworfen: string[] = []
  const voteId = voteIdAus(datum, teil.frontendId)
  for (const record of records) {
    const bfs =
      typeof record.bfs_number === 'number'
        ? String(record.bfs_number)
        : text(record.bfs_number)
    if (bfs === null || text(record.type) !== 'municipality') {
      verworfen.push(
        `Teil ${teil.frontendId}: ein Eintrag ohne Gemeinde wurde nicht gelesen.`
      )
      continue
    }
    const r = record.results ?? null
    const poll = r?.poll_data ?? null
    zeilen.push({
      datum,
      bfs,
      gemeinde: text(record.name?.de) ?? bfs,
      voteId,
      ebene: teil.ebene,
      art: teil.art,
      titel: teil.titel,
      // The only reading of «done» here, exactly as `istAusgezaehlt` is the
      // portal's: anything but a literal true is not counted.
      ausgezaehlt: record.finished === true,
      antwort: antwortAus(teil.art, poll),
      ja: zahl(poll?.yes_votes),
      nein: zahl(poll?.no_votes),
      prozentJa: zahl(poll?.yes_votes_percentage),
      beteiligung: zahl(r?.participation),
      stimmberechtigte: zahl(r?.eligible_voters),
      leer: zahl(r?.empty_ballots),
      ungueltig: zahl(r?.invalid_ballots),
      url: veworkLink(datum, teil.frontendId)
    })
  }
  return { zeilen, verworfen }
}

async function holeJson(url: string, doFetch: OdsFetch): Promise<unknown> {
  const antwort = await doFetch(url)
  if (!antwort.ok)
    throw new Error(
      `abstimmungen.bl.ch antwortete ${antwort.status} auf ${url}`
    )
  return antwort.json()
}

/**
 * Every municipality row of one vote day from the live publication, or null
 * when the canton publishes no such day there. A part that fails is a loud
 * error, never a missing part — five Vorlagen with one quietly absent would
 * read like a four-question Sunday.
 */
export async function liesVework(
  basis: string,
  datum: string,
  doFetch: OdsFetch
): Promise<Leseergebnis | null> {
  const tag = findeTag(
    await holeJson(`${basis}/polling_days.json`, doFetch),
    datum
  )
  if (tag === null) return null

  const zeilen: Abstimmungszeile[] = []
  const verworfen: string[] = []
  for (const teil of teileAus(tag)) {
    // Sequential on purpose, like every other source here.
    const payload = await holeJson(
      `${basis}/issues/${teil.id}/counting_circles.json`,
      doFetch
    )
    const gelesen = zeilenAusTeil(datum, teil, payload)
    zeilen.push(...gelesen.zeilen)
    verworfen.push(...gelesen.verworfen)
  }
  return { zeilen, verworfen }
}

/** How many municipality rows of a day are counted — the measure the two doors are compared by. */
function ausgezaehlte(gelesen: Leseergebnis | null): number {
  return gelesen === null
    ? 0
    : gelesen.zeilen.filter((z) => z.ausgezaehlt).length
}

/**
 * Which door's rows the run works with: the one with MORE counted rows, the
 * portal on a tie (it is the dataset of record, and the day it has caught up
 * nothing changes). The live publication is only ever a way to be earlier,
 * never a second opinion: both carry the same figures from the same office.
 */
export function waehleZeilen(
  portal: Leseergebnis,
  live: Leseergebnis | null
): { gelesen: Leseergebnis; quelle: 'portal' | 'live' } {
  if (live === null || live.zeilen.length === 0)
    return { gelesen: portal, quelle: 'portal' }
  if (portal.zeilen.length === 0) return { gelesen: live, quelle: 'live' }
  return ausgezaehlte(live) > ausgezaehlte(portal)
    ? { gelesen: live, quelle: 'live' }
    : { gelesen: portal, quelle: 'portal' }
}
