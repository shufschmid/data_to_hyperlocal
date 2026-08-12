import { describe, expect, it } from 'vitest'
import {
  andClauses,
  buildCatalogUrl,
  buildExportUrl,
  buildRecordsUrl,
  buildWhereClause,
  MAX_LIMIT,
  MAX_OFFSET_PLUS_LIMIT,
  odsLiteral,
  OdsQueryError
} from './query'

const BASIS = 'https://data.bl.ch'

describe('odsLiteral', () => {
  // The trap this whole function exists for: dataset 12060's `jahr` is typed
  // `date` on the portal even though it reads as "2025". Quoted as text it
  // matches nothing — and returns 200 with an empty list, not an error.
  it('renders a date field as a date literal, not as text', () => {
    expect(odsLiteral('2025', 'date')).toBe("date'2025'")
    expect(odsLiteral('2026-06-14', 'datetime')).toBe("date'2026-06-14'")
  })

  it('quotes text', () => {
    expect(odsLiteral('Liestal', 'text')).toBe('"Liestal"')
  })

  it('escapes quotes and backslashes inside text', () => {
    expect(odsLiteral('a"b', 'text')).toBe('"a\\"b"')
    expect(odsLiteral('a\\b', 'text')).toBe('"a\\\\b"')
  })

  it('leaves numbers bare', () => {
    expect(odsLiteral(2829, 'int')).toBe('2829')
    expect(odsLiteral('2829', 'int')).toBe('2829')
    expect(odsLiteral(16.9, 'double')).toBe('16.9')
  })

  it('renders booleans unquoted', () => {
    expect(odsLiteral(true, 'boolean')).toBe('true')
    expect(odsLiteral(false, 'boolean')).toBe('false')
  })

  // bfs_gemeindenummer is typed `text` on the portal, not int — so a BFS number
  // used in a filter has to be quoted even though it looks numeric.
  it('quotes a BFS number, because the portal types that column as text', () => {
    expect(buildWhereClause('bfs_gemeindenummer', 'text', '2829')).toBe(
      'bfs_gemeindenummer="2829"'
    )
  })
})

describe('andClauses', () => {
  it('joins what is there and drops what is not', () => {
    expect(andClauses('a=1', undefined, 'b=2', '')).toBe('a=1 and b=2')
  })

  it('returns undefined when nothing is left', () => {
    expect(andClauses(undefined, '')).toBeUndefined()
  })
})

describe('buildCatalogUrl', () => {
  it('defaults to nothing and tolerates a trailing slash on the base', () => {
    expect(buildCatalogUrl('https://data.bl.ch/')).toBe(
      'https://data.bl.ch/api/explore/v2.1/catalog/datasets'
    )
  })

  it('encodes the order and filter', () => {
    const url = buildCatalogUrl(BASIS, {
      limit: 100,
      orderBy: 'modified desc',
      where: 'search(title,"Abfall")'
    })
    expect(url).toContain('limit=100')
    expect(url).toContain('order_by=modified+desc')
    expect(url).toContain('where=search%28title%2C%22Abfall%22%29')
  })
})

describe('buildRecordsUrl', () => {
  it('defaults to the maximum page size', () => {
    expect(buildRecordsUrl(BASIS, '12060')).toContain(`limit=${MAX_LIMIT}`)
  })

  it('encodes the dataset id into the path', () => {
    expect(buildRecordsUrl(BASIS, '12060')).toContain('/datasets/12060/records')
  })

  it('omits offset when it is zero', () => {
    expect(buildRecordsUrl(BASIS, '12060', { offset: 0 })).not.toContain(
      'offset'
    )
  })

  // Both limits are what the API actually answers with — see query.ts.
  it('rejects a page larger than the API allows', () => {
    expect(() => buildRecordsUrl(BASIS, '12060', { limit: 200 })).toThrow(
      OdsQueryError
    )
  })

  it('accepts exactly the maximum page size', () => {
    expect(() =>
      buildRecordsUrl(BASIS, '12060', { limit: MAX_LIMIT })
    ).not.toThrow()
  })

  it('rejects paging past the ceiling before the API does', () => {
    expect(() =>
      buildRecordsUrl(BASIS, '12060', { offset: 9950, limit: 100 })
    ).toThrow(OdsQueryError)
  })

  it('accepts the last page that still fits', () => {
    expect(() =>
      buildRecordsUrl(BASIS, '12060', {
        offset: MAX_OFFSET_PLUS_LIMIT - MAX_LIMIT,
        limit: MAX_LIMIT
      })
    ).not.toThrow()
  })
})

describe('buildExportUrl', () => {
  it('points at the export endpoint and carries no paging at all', () => {
    const url = buildExportUrl(BASIS, '12060', { where: "jahr=date'2025'" })
    expect(url).toContain('/datasets/12060/exports/json')
    expect(url).not.toContain('limit')
    expect(url).not.toContain('offset')
    expect(url).toContain('where=jahr%3Ddate%272025%27')
  })
})
