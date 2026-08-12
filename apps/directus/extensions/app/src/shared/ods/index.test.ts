import { describe, expect, it, vi } from 'vitest'
import {
  exportRecords,
  fetchRecords,
  listDatasets,
  OdsRequestError,
  type OdsFetch
} from './index'

function antwort(
  body: unknown,
  init: { ok?: boolean; status?: number } = {}
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body
  } as unknown as Response
}

const LEERER_KATALOG = { total_count: 0, results: [] }

describe('listDatasets', () => {
  it('asks for the newest first — that is the "what changed?" question', async () => {
    const doFetch = vi.fn<OdsFetch>().mockResolvedValue(antwort(LEERER_KATALOG))

    await listDatasets('https://data.bl.ch', {}, doFetch)

    const url = doFetch.mock.calls[0]?.[0] ?? ''
    expect(url).toContain('/api/explore/v2.1/catalog/datasets')
    expect(url).toContain('order_by=modified+desc')
  })

  it('passes a filter through', async () => {
    const doFetch = vi.fn<OdsFetch>().mockResolvedValue(antwort(LEERER_KATALOG))

    await listDatasets(
      'https://data.bl.ch',
      { where: 'search(title,"Abfall")' },
      doFetch
    )

    expect(doFetch.mock.calls[0]?.[0]).toContain('where=')
  })
})

describe('fetchRecords', () => {
  it('unwraps the results array', async () => {
    const doFetch = vi
      .fn<OdsFetch>()
      .mockResolvedValue(
        antwort({ total_count: 1, results: [{ gemeinde: 'Liestal' }] })
      )

    await expect(
      fetchRecords('https://data.bl.ch', '12060', {}, doFetch)
    ).resolves.toEqual([{ gemeinde: 'Liestal' }])
  })
})

describe('exportRecords', () => {
  // The export endpoint answers with a bare array, the records endpoint with an
  // envelope. Both have to come back as rows.
  it('accepts a bare array', async () => {
    const doFetch = vi
      .fn<OdsFetch>()
      .mockResolvedValue(antwort([{ gemeinde: 'Aesch' }]))

    await expect(
      exportRecords('https://data.bl.ch', '12060', {}, doFetch)
    ).resolves.toEqual([{ gemeinde: 'Aesch' }])
  })
})

describe('Fehlerbehandlung', () => {
  it("keeps the portal's own error code and message", async () => {
    const doFetch = vi.fn<OdsFetch>().mockResolvedValue(
      antwort(
        {
          error_code: 'InvalidRESTParameterError',
          message:
            'Invalid value for limit API parameter: 200 was found but -1 <= limit <= 100 is expected.'
        },
        { ok: false, status: 400 }
      )
    )

    const fehler = await fetchRecords(
      'https://data.bl.ch',
      '12060',
      {},
      doFetch
    ).catch((error: unknown) => error)

    expect(fehler).toBeInstanceOf(OdsRequestError)
    expect((fehler as OdsRequestError).status).toBe(400)
    expect((fehler as OdsRequestError).errorCode).toBe(
      'InvalidRESTParameterError'
    )
    expect((fehler as OdsRequestError).message).toContain('limit')
  })

  // A portal that is unreachable must not read like a portal that answered.
  it('reports a dead connection as a request error, not a parse error', async () => {
    const doFetch = vi
      .fn<OdsFetch>()
      .mockRejectedValue(new Error('ECONNREFUSED'))

    const fehler = await listDatasets('https://data.bl.ch', {}, doFetch).catch(
      (error: unknown) => error
    )

    expect(fehler).toBeInstanceOf(OdsRequestError)
    expect((fehler as OdsRequestError).status).toBe(0)
    expect((fehler as OdsRequestError).message).toContain('nicht erreichbar')
  })

  it('still fails cleanly when an error response has no JSON body', async () => {
    const doFetch = vi.fn<OdsFetch>().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      }
    } as unknown as Response)

    const fehler = await listDatasets('https://data.bl.ch', {}, doFetch).catch(
      (error: unknown) => error
    )

    expect(fehler).toBeInstanceOf(OdsRequestError)
    expect((fehler as OdsRequestError).status).toBe(502)
  })
})
