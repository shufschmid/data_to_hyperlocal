// Building Opendatasoft Explore API v2.1 URLs.
//
// Pure string work, kept apart from the client so the parts that are easy to
// get wrong — the caps and the literal syntax — are testable without a network.
//
// The caps below are not guesses; they are what the API answers with:
//   limit=200        → "Invalid value for limit API parameter: 200 was found
//                       but -1 <= limit <= 100 is expected."
//   offset=9950&limit=100
//                    → "Invalid value for sum of offset + limit API parameter:
//                       10050 was found but <= 10000 is expected."

/** Records endpoint: at most 100 rows per request. */
export const MAX_LIMIT = 100

/** Records endpoint: paging stops here. Use `exportUrl` for a full slice. */
export const MAX_OFFSET_PLUS_LIMIT = 10000

export class OdsQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OdsQueryError'
  }
}

function trimBase(basisUrl: string): string {
  return basisUrl.replace(/\/+$/, '')
}

function withParams(
  url: string,
  params: Record<string, string | undefined>
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.append(key, value)
  }
  const query = search.toString()
  return query === '' ? url : `${url}?${query}`
}

/**
 * Renders a value the way the ODS query language expects it for a given field
 * type.
 *
 * The trap this exists for: dataset 12060's `jahr` field is typed `date` even
 * though it serialises as the string "2025". Quoting it as text returns zero
 * rows — no error, just silence — so the type from the catalogue has to decide
 * the syntax.
 */
export function odsLiteral(
  value: string | number | boolean,
  type: string
): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)

  switch (type) {
    case 'date':
    case 'datetime':
      return `date'${value.replace(/'/g, "''")}'`
    case 'int':
    case 'double':
    case 'decimal':
      return value
    default:
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
}

/** `field = literal`, with the literal rendered for the field's type. */
export function buildWhereClause(
  field: string,
  type: string,
  value: string | number | boolean
): string {
  return `${field}=${odsLiteral(value, type)}`
}

/** Joins clauses that must all hold. */
export function andClauses(
  ...clauses: Array<string | undefined>
): string | undefined {
  const kept = clauses.filter(
    (clause): clause is string => clause !== undefined && clause !== ''
  )
  return kept.length === 0 ? undefined : kept.join(' and ')
}

export interface CatalogQuery {
  limit?: number
  offset?: number
  where?: string
  orderBy?: string
}

/** The dataset catalogue — this is the "what is new?" endpoint. */
export function buildCatalogUrl(
  basisUrl: string,
  query: CatalogQuery = {}
): string {
  return withParams(`${trimBase(basisUrl)}/api/explore/v2.1/catalog/datasets`, {
    limit: query.limit === undefined ? undefined : String(query.limit),
    offset: query.offset === undefined ? undefined : String(query.offset),
    where: query.where,
    order_by: query.orderBy
  })
}

export interface RecordsQuery extends CatalogQuery {
  select?: string
  groupBy?: string
}

/**
 * A page of records. Throws rather than letting the API reject the request, so
 * a caller that paged too far finds out at the call site instead of in a log.
 */
export function buildRecordsUrl(
  basisUrl: string,
  datasetId: string,
  query: RecordsQuery = {}
): string {
  const limit = query.limit ?? MAX_LIMIT
  const offset = query.offset ?? 0

  if (limit < 1 || limit > MAX_LIMIT) {
    throw new OdsQueryError(
      `limit must be between 1 and ${MAX_LIMIT}, got ${limit}`
    )
  }
  if (offset + limit > MAX_OFFSET_PLUS_LIMIT) {
    throw new OdsQueryError(
      `offset + limit must not exceed ${MAX_OFFSET_PLUS_LIMIT}, got ${offset + limit}. ` +
        'Use buildExportUrl for a whole slice.'
    )
  }

  return withParams(
    `${trimBase(basisUrl)}/api/explore/v2.1/catalog/datasets/${encodeURIComponent(datasetId)}/records`,
    {
      limit: String(limit),
      offset: offset === 0 ? undefined : String(offset),
      where: query.where,
      order_by: query.orderBy,
      select: query.select,
      group_by: query.groupBy
    }
  )
}

/**
 * Every row matching `where`, in one response and without paging.
 *
 * This is how a period slice is fetched: one year of dataset 12060 is ~200 KB,
 * well inside what a single request should carry, and it sidesteps the 10 000
 * row paging ceiling entirely.
 */
export function buildExportUrl(
  basisUrl: string,
  datasetId: string,
  query: { where?: string; orderBy?: string; select?: string } = {}
): string {
  return withParams(
    `${trimBase(basisUrl)}/api/explore/v2.1/catalog/datasets/${encodeURIComponent(datasetId)}/exports/json`,
    { where: query.where, order_by: query.orderBy, select: query.select }
  )
}
