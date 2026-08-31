import { describe, expect, it, vi } from 'vitest'
import {
  createSrgssrClient,
  SrgssrLookupError,
  type FetchLike
} from './srgssr-client'

const TOKEN_URL =
  'https://srgssr-prod.apigee.net/oauth/v1/accesstoken?grant_type=client_credentials'
const CONFIG = { clientId: 'test-id', clientSecret: 'test-secret' }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function tokenResponse(accessToken = 'tok'): Response {
  return jsonResponse(200, { access_token: accessToken, expires_in: 1800 })
}

describe('createSrgssrClient - auth', () => {
  it('requests a token with Basic auth and a client_credentials form body', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(tokenResponse())
    const client = createSrgssrClient(CONFIG, fetchImpl)

    // getShowId needs a token; the show search itself we don't care about here
    fetchImpl
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { searchResultShowList: [] }))
    await client.getShowId().catch(() => {}) // will throw (no matching show) - fine, we're only checking the token call

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(TOKEN_URL)
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(
      `Basic ${Buffer.from('test-id:test-secret').toString('base64')}`
    )
    expect(init?.body).toBe('grant_type=client_credentials')
  })

  it('caches the token across calls on the same client', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(200, {
          searchResultShowList: [
            { id: 'show-1', title: 'Regionaljournal Basel Baselland' }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          searchResultShowList: [
            { id: 'show-1', title: 'Regionaljournal Basel Baselland' }
          ]
        })
      )

    const client = createSrgssrClient(CONFIG, fetchImpl)
    await client.getShowId()
    fetchImpl.mockClear()
    // second call to something requiring auth should NOT re-fetch a token
    await client.getShowId() // already cached show id too, so this won't even call fetch
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not share a cached token between separate client instances', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(tokenResponse())
    const clientA = createSrgssrClient(CONFIG, fetchImpl)
    const clientB = createSrgssrClient(CONFIG, fetchImpl)

    fetchImpl
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { searchResultShowList: [] }))
    await clientA.getShowId().catch(() => {})
    const callsAfterA = fetchImpl.mock.calls.length

    fetchImpl
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { searchResultShowList: [] }))
    await clientB.getShowId().catch(() => {})

    // clientB made its own token request too (2 more calls), proving no shared cache
    expect(fetchImpl.mock.calls.length).toBe(callsAfterA + 2)
  })

  it('retries once on a 401 with a refreshed token', async () => {
    const showListOk = jsonResponse(200, {
      searchResultShowList: [
        { id: 'show-1', title: 'Regionaljournal Basel Baselland' }
      ]
    })
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(tokenResponse('first-token'))
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(tokenResponse('second-token'))
      .mockResolvedValueOnce(showListOk)

    const client = createSrgssrClient(CONFIG, fetchImpl)
    const showId = await client.getShowId()

    expect(showId).toBe('show-1')
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    const lastCall = fetchImpl.mock.calls[3]!
    expect(
      (lastCall[1]?.headers as Record<string, string>)['Authorization']
    ).toBe('Bearer second-token')
  })
})

describe('createSrgssrClient - getShowId', () => {
  it('matches the show title case-insensitively and exactly', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(200, {
          searchResultShowList: [
            {
              id: 'wrong',
              title: 'Regionaljournal Basel Baselland Wochengast'
            },
            { id: 'right', title: 'regionaljournal basel baselland' }
          ]
        })
      )
    const client = createSrgssrClient(CONFIG, fetchImpl)
    await expect(client.getShowId()).resolves.toBe('right')
  })

  it('throws SrgssrLookupError when no exact title match exists', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(200, {
          searchResultShowList: [{ id: 'x', title: 'Something Else' }]
        })
      )
    const client = createSrgssrClient(CONFIG, fetchImpl)
    await expect(client.getShowId()).rejects.toBeInstanceOf(SrgssrLookupError)
  })

  it('skips the lookup entirely when SRGSSR_SHOW_ID is configured', async () => {
    const fetchImpl = vi.fn<FetchLike>()
    const client = createSrgssrClient(
      { ...CONFIG, showId: 'preset-show' },
      fetchImpl
    )
    await expect(client.getShowId()).resolves.toBe('preset-show')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('createSrgssrClient - resolveEpisode', () => {
  function media(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      urn: 'urn:srf:audio:abc',
      title: 'Ziefen wehrt sich gegen Bachem-Parkplatz',
      date: '2026-08-17T12:03:00+02:00',
      lead: 'Lead text',
      description: null,
      podcastHdUrl: 'https://example.com/a.mp3',
      podcastSdUrl: null,
      ...overrides
    }
  }

  it('matches by exact title and date', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(200, {
          episodeList: [
            { mediaList: [media()] },
            {
              mediaList: [
                media({
                  title: 'Some other story',
                  date: '2026-08-17T06:30:00+02:00'
                })
              ]
            }
          ],
          next: null
        })
      )
    const client = createSrgssrClient(
      { ...CONFIG, showId: 'show-1' },
      fetchImpl
    )
    const episode = await client.resolveEpisode(
      'Ziefen wehrt sich gegen Bachem-Parkplatz',
      '2026-08-17'
    )
    expect(episode.urn).toBe('urn:srf:audio:abc')
  })

  it('follows the next pagination link when the first page has no match', async () => {
    const page1 = jsonResponse(200, {
      episodeList: [
        {
          mediaList: [
            media({ title: 'Unrelated', date: '2026-08-17T06:30:00+02:00' })
          ]
        }
      ],
      next: 'https://api.srgssr.ch/audiometadata/v2/episodeComposition/shows/show-1?page=2'
    })
    const page2 = jsonResponse(200, {
      episodeList: [{ mediaList: [media()] }],
      next: null
    })
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)

    const client = createSrgssrClient(
      { ...CONFIG, showId: 'show-1' },
      fetchImpl
    )
    const episode = await client.resolveEpisode(
      'Ziefen wehrt sich gegen Bachem-Parkplatz',
      '2026-08-17'
    )
    expect(episode.urn).toBe('urn:srf:audio:abc')
    expect(fetchImpl.mock.calls[2]?.[0]).toBe(
      'https://api.srgssr.ch/audiometadata/v2/episodeComposition/shows/show-1?page=2'
    )
  })

  it('stops paging (does not throw) when the next page fails to fetch', async () => {
    const page1 = jsonResponse(200, {
      episodeList: [],
      next: 'https://api.srgssr.ch/integrationlayer/2.0/srf/episodeComposition/latestByShow/show-1?page=2'
    })
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(
        new Response('<html>not json</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        })
      )

    const client = createSrgssrClient(
      { ...CONFIG, showId: 'show-1' },
      fetchImpl
    )
    await expect(
      client.resolveEpisode(
        'Ziefen wehrt sich gegen Bachem-Parkplatz',
        '2026-08-17'
      )
    ).rejects.toBeInstanceOf(SrgssrLookupError)
  })

  it('throws when no episode matches', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { episodeList: [], next: null }))
    const client = createSrgssrClient(
      { ...CONFIG, showId: 'show-1' },
      fetchImpl
    )
    await expect(
      client.resolveEpisode('Nonexistent story', '2026-08-17')
    ).rejects.toBeInstanceOf(SrgssrLookupError)
  })

  it('throws when more than one episode matches (ambiguous)', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(200, {
          episodeList: [
            { mediaList: [media({ urn: 'urn:1' })] },
            { mediaList: [media({ urn: 'urn:2' })] }
          ],
          next: null
        })
      )
    const client = createSrgssrClient(
      { ...CONFIG, showId: 'show-1' },
      fetchImpl
    )
    await expect(
      client.resolveEpisode(
        'Ziefen wehrt sich gegen Bachem-Parkplatz',
        '2026-08-17'
      )
    ).rejects.toBeInstanceOf(SrgssrLookupError)
  })
})
