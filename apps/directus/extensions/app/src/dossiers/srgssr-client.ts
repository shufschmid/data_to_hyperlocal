// Client for the SRGSSR Audio Metadata API - resolves an SRF Regionaljournal
// Basel Baselland dossier story (headline + broadcast date) to its audio episode.
//
// Ported from the Python PoC's srgssr_client.py, which validated a number of real,
// non-obvious API behaviours against the live API (not just its OpenAPI spec):
//
// - This show publishes one API "episode" per STORY, not per broadcast edition,
//   and the story's `title` is a verbatim copy of the dossier PDF's headline - so
//   resolution is a plain title+date match, no time-of-day/edition guessing needed.
// - Response field names are lowerCamelCase (`searchResultShowList`, `episodeList`,
//   `mediaList`) even though the OpenAPI spec documents PascalCase - confirmed
//   against the real API, not a typo to "fix".
// - `/radio/channels` only lists the 6 national channels, not regional shows -
//   `/radioshows/search` + `/episodeComposition/shows/{id}` is the right pair.
// - The `next` pagination link points at an internal host outside the subscribed
//   API product and returns HTML instead of JSON - a failure fetching `next` is
//   treated as "no more pages", not thrown; one page (100 episodes, ~1 month of
//   this show's output) is enough in practice for a same-day dossier.
// - `podcastHdUrl` on the matched episode is a direct, publicly-fetchable MP3 - no
//   need to embed SRF's own iframe player.
//
// Unlike the Python version, the OAuth token and resolved show id are cached only
// in memory (per client instance, via closure) - never to a file. "No persistent
// file storage outside Directus" forbids the old `.cache/*.json` approach, and
// since Directus is one long-running process (not a short-lived CLI invocation
// repeated many times a day), a fresh token fetch costing one HTTP round trip per
// process lifetime is a non-issue. Caching lives on the client instance rather
// than at module scope so tests get a clean slate per client without global state
// leaking between them - callers that process several dossiers in one run should
// create one client and reuse it for the whole run to get the caching benefit.

const TOKEN_URL =
  'https://srgssr-prod.apigee.net/oauth/v1/accesstoken?grant_type=client_credentials'
const API_BASE = 'https://api.srgssr.ch/audiometadata/v2'
const BUSINESS_UNIT = 'srf'
const SHOW_TITLE = 'Regionaljournal Basel Baselland'

const MAX_RETRIES = 3
const MAX_PAGES = 10

export class SrgssrLookupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SrgssrLookupError'
  }
}

export class SrgssrHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`SRGSSR API request to ${url} failed with status ${status}`)
    this.name = 'SrgssrHttpError'
  }
}

export interface SrgssrConfig {
  clientId: string
  clientSecret: string
  /** Optional manual override to skip the /radioshows/search lookup. */
  showId?: string | null
}

export interface SrgssrEpisode {
  urn: string
  title: string
  /** ISO datetime, as returned by the API (includes the Swiss offset). */
  date: string
  lead: string | null
  description: string | null
  podcastHdUrl: string | null
  podcastSdUrl: string | null
}

export type FetchLike = typeof fetch

export interface SrgssrClient {
  getShowId(): Promise<string>
  resolveEpisode(
    headline: string,
    broadcastDate: string
  ): Promise<SrgssrEpisode>
}

interface CachedToken {
  accessToken: string
  expiresAt: number
}

interface SrgssrShowSearchResponse {
  searchResultShowList?: { id: string; title: string }[]
}

interface SrgssrMedia {
  urn: string
  title: string
  date: string
  lead?: string | null
  description?: string | null
  podcastHdUrl?: string | null
  podcastSdUrl?: string | null
}

interface SrgssrEpisodeCompositionResponse {
  episodeList?: { mediaList?: SrgssrMedia[] }[]
  next?: string | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  attempt = 0
): Promise<Response> {
  const response = await fetchImpl(url, init)
  const retryable = response.status === 429 || response.status >= 500
  if (retryable && attempt < MAX_RETRIES - 1) {
    await sleep(2 ** attempt * 1000)
    return fetchWithRetry(fetchImpl, url, init, attempt + 1)
  }
  return response
}

async function fetchToken(
  config: SrgssrConfig,
  fetchImpl: FetchLike
): Promise<CachedToken> {
  const credentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`
  ).toString('base64')
  const response = await fetchWithRetry(fetchImpl, TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  })
  if (!response.ok) throw new SrgssrHttpError(response.status, TOKEN_URL)

  const data = (await response.json()) as {
    access_token: string
    expires_in?: number
  }
  const expiresIn = data.expires_in ?? 1800
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000
  }
}

export function createSrgssrClient(
  config: SrgssrConfig,
  fetchImpl: FetchLike = fetch
): SrgssrClient {
  let cachedToken: CachedToken | null = null
  let cachedShowId: string | null = config.showId ?? null

  async function getToken(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      cachedToken &&
      cachedToken.expiresAt > Date.now() + 30_000
    ) {
      return cachedToken.accessToken
    }
    cachedToken = await fetchToken(config, fetchImpl)
    return cachedToken.accessToken
  }

  async function authedGet<T>(url: string): Promise<T> {
    const headers = (token: string) => ({
      Accept: 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`
    })

    let response = await fetchWithRetry(fetchImpl, url, {
      headers: headers(await getToken())
    })
    if (response.status === 401) {
      response = await fetchWithRetry(fetchImpl, url, {
        headers: headers(await getToken(true))
      })
    }
    if (!response.ok) throw new SrgssrHttpError(response.status, url)
    return (await response.json()) as T
  }

  async function getShowId(): Promise<string> {
    if (cachedShowId) return cachedShowId

    const url = `${API_BASE}/radioshows/search?bu=${BUSINESS_UNIT}&q=${encodeURIComponent(SHOW_TITLE)}`
    const data = await authedGet<SrgssrShowSearchResponse>(url)
    const shows = data.searchResultShowList ?? []
    const exact = shows.find(
      (s) => s.title.trim().toLowerCase() === SHOW_TITLE.toLowerCase()
    )

    if (!exact) {
      const candidates = shows.map((s) => s.title).join(', ')
      throw new SrgssrLookupError(
        `No show titled "${SHOW_TITLE}" found. Candidates: [${candidates}]. ` +
          `You can set SRGSSR_SHOW_ID manually to skip this lookup.`
      )
    }

    cachedShowId = exact.id
    return exact.id
  }

  async function resolveEpisode(
    headline: string,
    broadcastDate: string
  ): Promise<SrgssrEpisode> {
    const targetTitle = headline.trim().toLowerCase()
    const showId = await getShowId()
    const month = broadcastDate.slice(0, 7) // "YYYY-MM"

    let url = `${API_BASE}/episodeComposition/shows/${showId}?bu=${BUSINESS_UNIT}&maxPublishedDate=${month}&pageSize=100`
    const matches: SrgssrEpisode[] = []

    for (let page = 0; page < MAX_PAGES; page++) {
      let data: SrgssrEpisodeCompositionResponse
      try {
        data = await authedGet<SrgssrEpisodeCompositionResponse>(url)
      } catch {
        // `next` (page 2+) points at a host outside the subscribed API product and
        // serves HTML instead of JSON - best-effort: stop paging rather than crash.
        break
      }

      for (const episode of data.episodeList ?? []) {
        for (const media of episode.mediaList ?? []) {
          if (media.title.trim().toLowerCase() !== targetTitle) continue
          if (media.date.slice(0, 10) !== broadcastDate) continue
          matches.push({
            urn: media.urn,
            title: media.title,
            date: media.date,
            lead: media.lead ?? null,
            description: media.description ?? null,
            podcastHdUrl: media.podcastHdUrl ?? null,
            podcastSdUrl: media.podcastSdUrl ?? null
          })
        }
      }

      if (matches.length > 0) break
      if (!data.next) break
      url = data.next
    }

    if (matches.length === 1) return matches[0]!
    if (matches.length === 0) {
      throw new SrgssrLookupError(
        `No episode titled "${headline}" found on ${broadcastDate}.`
      )
    }
    throw new SrgssrLookupError(
      `${matches.length} episodes titled "${headline}" found on ${broadcastDate} - ambiguous.`
    )
  }

  return { getShowId, resolveEpisode }
}
