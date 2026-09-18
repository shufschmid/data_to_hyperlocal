import {
  buildRecordsUrl,
  buildWhereClause,
  exportRecords,
  odsLiteral,
  type OdsFetch
} from '../ods'
import { parseZeilen, type Leseergebnis } from './parse'

// The votes feed's door to data.bl.ch — and it is the SAME door everything
// else uses.
//
// This is not a new source. `shared/ods/` has read this portal every morning
// since the first day, dataset 11990 is a dataset on it like any other, and
// this module adds no client, no host and no `fetch` of its own: it composes
// the existing one. What it adds is the three questions the votes feed asks.
//
// **One request per vote day, never one per municipality.** 86 municipalities
// times five Vorlagen is 430 rows and 294 KB (measured 18 September 2026) —
// one export, well inside a single response, and it sidesteps the records
// endpoint's paging ceiling entirely. A run on a day with no ballot costs
// exactly that one request and answers nothing.

export * from './parse'

/** The default dataset on data.bl.ch. Which one a portal uses is a `quellen` row. */
export const ABSTIMMUNGS_DATENSATZ = '11990'

/**
 * Every row of one vote day, over all municipalities of the canton.
 *
 * All of them, not our ten: the cantonal figure an article compares against is
 * the sum of all 86, and a sum over a sample is exactly the mistake this house
 * has already paid for once.
 */
export async function liesAbstimmungen(
  basisUrl: string,
  datensatzId: string,
  datum: string,
  doFetch: OdsFetch
): Promise<Leseergebnis> {
  const records = await exportRecords(
    basisUrl,
    datensatzId,
    {
      where: buildWhereClause('date', 'date', datum),
      orderBy: 'entity_id'
    },
    doFetch
  )

  return parseZeilen(records)
}

interface RecordsAntwort {
  results?: unknown
}

function ergebnisse(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  const results =
    typeof payload === 'object' && payload !== null
      ? (payload as RecordsAntwort).results
      : undefined
  return Array.isArray(results) ? results : []
}

async function holeRecords(url: string, doFetch: OdsFetch): Promise<unknown[]> {
  const antwort = await doFetch(url)
  const body: unknown = await antwort.json().catch(() => null)
  return ergebnisse(body)
}

/**
 * The newest vote day before `datum`, or null when there is none.
 *
 * What «das letzte vergleichbare Mal» means in a figure an article may
 * actually name: the turnout of the previous ballot in the same municipality.
 * One grouped request, and only ever asked once per vote day — the answer
 * cannot change afterwards.
 */
export async function liesVorherigesDatum(
  basisUrl: string,
  datensatzId: string,
  datum: string,
  doFetch: OdsFetch
): Promise<string | null> {
  const url = buildRecordsUrl(basisUrl, datensatzId, {
    select: 'date',
    groupBy: 'date',
    where: `date<${odsLiteral(datum, 'date')}`,
    orderBy: 'date desc',
    limit: 1
  })

  const zeilen = await holeRecords(url, doFetch)
  const erste = zeilen[0]
  if (typeof erste !== 'object' || erste === null) return null

  const roh = (erste as Record<string, unknown>)['date']
  if (typeof roh !== 'string') return null
  const kurz = roh.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(kurz) ? kurz : null
}

/**
 * One earlier day, but only for the municipalities the newsroom covers.
 *
 * The comparison is per municipality, so the other 76 are not needed and are
 * not fetched. No municipality, no request.
 */
export async function liesGemeindezahlen(
  basisUrl: string,
  datensatzId: string,
  datum: string,
  bfsNummern: readonly string[],
  doFetch: OdsFetch
): Promise<Leseergebnis> {
  if (bfsNummern.length === 0) return { zeilen: [], verworfen: [] }

  const gemeinden = bfsNummern
    .map((bfs) => buildWhereClause('entity_id', 'text', bfs))
    .join(' or ')

  const url = buildRecordsUrl(basisUrl, datensatzId, {
    where: `${buildWhereClause('date', 'date', datum)} and (${gemeinden})`,
    orderBy: 'entity_id',
    limit: 100
  })

  return parseZeilen(await holeRecords(url, doFetch))
}
