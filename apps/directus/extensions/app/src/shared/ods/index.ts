import {
  buildCatalogUrl,
  buildExportUrl,
  buildRecordsUrl,
  MAX_LIMIT,
  type RecordsQuery
} from './query'
import { parseCatalogPage, type OdsCatalogPage } from './parse'

// Client for an Opendatasoft Explore API v2.1 portal.
//
// The `fetch` parameter is the same seam `shared/claude.ts` uses for
// `MessageSender`: every function takes one, so tests run against recorded
// fixtures and never touch the network.
//
// This is the second outbound dependency of the application, after the Claude
// API, and it was a deliberate decision — see the root CLAUDE.md. It is plain
// JSON over HTTPS with no authentication, which is why this feature needs no
// scraper and no headless browser.

export * from './query'
export * from './parse'

export type OdsFetch = (url: string) => Promise<Response>

export const defaultFetch: OdsFetch = (url) => fetch(url)

/** An error the portal reported, with its own code preserved for the log. */
export class OdsRequestError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string | null,
    message: string,
    readonly url: string
  ) {
    super(message)
    this.name = 'OdsRequestError'
  }
}

async function getJson(url: string, doFetch: OdsFetch): Promise<unknown> {
  let response: Response
  try {
    response = await doFetch(url)
  } catch (cause) {
    // A portal that is down must not read like a portal that answered.
    throw new OdsRequestError(
      0,
      null,
      `Opendatasoft nicht erreichbar: ${cause instanceof Error ? cause.message : String(cause)}`,
      url
    )
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const fehler =
      typeof body === 'object' && body !== null
        ? (body as { error_code?: unknown; message?: unknown })
        : {}
    throw new OdsRequestError(
      response.status,
      typeof fehler.error_code === 'string' ? fehler.error_code : null,
      typeof fehler.message === 'string'
        ? fehler.message
        : `Opendatasoft antwortete mit HTTP ${response.status}`,
      url
    )
  }

  return body
}

export interface ListDatasetsOptions {
  /** At most 100 per page, same cap as the records endpoint. */
  limit?: number
  offset?: number
  where?: string
  /** Newest first is what a "what changed?" check wants. */
  orderBy?: string
}

export async function listDatasets(
  basisUrl: string,
  options: ListDatasetsOptions = {},
  doFetch: OdsFetch = defaultFetch
): Promise<OdsCatalogPage> {
  const url = buildCatalogUrl(basisUrl, {
    limit: options.limit ?? MAX_LIMIT,
    offset: options.offset,
    where: options.where,
    orderBy: options.orderBy ?? 'modified desc'
  })

  return parseCatalogPage(await getJson(url, doFetch))
}

/** A row as the portal returns it — shape depends entirely on the dataset. */
export type OdsRecord = Record<string, unknown>

function readRecords(payload: unknown): OdsRecord[] {
  if (Array.isArray(payload)) return payload as OdsRecord[]

  const results =
    typeof payload === 'object' && payload !== null
      ? (payload as { results?: unknown }).results
      : undefined

  return Array.isArray(results) ? (results as OdsRecord[]) : []
}

/** One page of records. Respects the paging caps — see `buildRecordsUrl`. */
export async function fetchRecords(
  basisUrl: string,
  datasetId: string,
  query: RecordsQuery = {},
  doFetch: OdsFetch = defaultFetch
): Promise<OdsRecord[]> {
  return readRecords(
    await getJson(buildRecordsUrl(basisUrl, datasetId, query), doFetch)
  )
}

/**
 * Every row matching the filter, in one request.
 *
 * This is what a period slice uses. One year of the waste statistics is roughly
 * 200 KB and about 500 rows, so the alternative — six paged requests that stop
 * dead at 10 000 rows — buys nothing.
 */
export async function exportRecords(
  basisUrl: string,
  datasetId: string,
  query: { where?: string; orderBy?: string; select?: string } = {},
  doFetch: OdsFetch = defaultFetch
): Promise<OdsRecord[]> {
  return readRecords(
    await getJson(buildExportUrl(basisUrl, datasetId, query), doFetch)
  )
}
