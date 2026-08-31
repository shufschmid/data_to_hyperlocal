// Resolves a Punkt6 broadcast date to its telebasel.ch episode: the video URL and
// the show's own, pre-computed per-story segmentation. Unlike SRGSSR
// (dossiers/srgssr-client.ts) this needs no OAuth client and no show/episode
// pagination - telebasel.ch's own public pages already carry everything as plain,
// server-rendered HTML with embedded schema.org metadata (verified against the
// real site: robots.txt allows /sendungen/, no login or JS execution needed).
//
//   1. GET the show archive (ARCHIVE_URL) - one <a class="episode ..."> per episode,
//      each with a "Wochentag DD.MM.YYYY" sibling - to find the episode id for a
//      given broadcastDate.
//   2. GET that episode's detail page - it embeds the resolved HLS video URL
//      (`data-video-url`) and one schema.org `Clip` block per story
//      (itemprop="hasPart", with name/startOffset/endOffset in seconds).
//
// Both are unauthenticated GETs; nothing here needs caching beyond a single
// resolveEpisode call (contrast with SRGSSR's token/show-id cache, which exists
// specifically to amortise real OAuth round-trips).

export type FetchLike = typeof fetch

const ARCHIVE_URL = 'https://telebasel.ch/sendungen/punkt6'

export class TelebaselLookupError extends Error {}
export class TelebaselHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`Telebasel request to ${url} failed with status ${status}`)
  }
}

export interface TelebaselSegment {
  name: string
  startSeconds: number
  endSeconds: number
}

export interface TelebaselEpisode {
  id: string
  url: string
  broadcastDate: string // ISO "YYYY-MM-DD"
  durationSeconds: number | null
  /**
   * The HLS master playlist (telebasel.ch's own `data-video-url`), NOT the
   * progressive MP4 also linked on the page. Verified against the real manifest:
   * telebasel.ch serves video-only renditions (1080p/720p/360p) with audio as a
   * SEPARATE HLS rendition group, combined by an adaptive player - exactly what
   * telebasel.ch's own embedded player does, and exactly why a plain <video src>
   * to the raw MP4 (tried first, before this was understood) loaded slowly and
   * played no sound. Play this through hls.js (or natively on Safari), never as
   * a plain progressive source.
   */
  videoUrl: string | null
  posterUrl: string | null
  segments: TelebaselSegment[]
}

export interface TelebaselClient {
  resolveEpisode(broadcastDate: string): Promise<TelebaselEpisode>
}

// "Montag 25.08.2026" -> "2026-08-25". The archive lists one weekday name per
// episode, which this deliberately ignores - only the date matters for matching.
const ARCHIVE_ENTRY_RE =
  /<a class="episode episode--vertical-list" href="https:\/\/telebasel\.ch\/sendungen\/punkt6\/(\d+)\?autoplay=1">[\s\S]*?<span class="episode__time">\S+\s+(\d{2})\.(\d{2})\.(\d{4})<\/span>/g

const DURATION_RE = /data-video-duration="(\d+)"/
const VIDEO_URL_RE = /data-video-url="([^"]+)"/
const THUMBNAIL_URL_RE = /<meta itemprop="thumbnailUrl" content="([^"]+)"/
const CLIP_RE =
  /itemprop="hasPart"\s+itemtype="https:\/\/schema\.org\/Clip"\s*>\s*<meta itemprop="name" content="([^"]*)"\s*\/>\s*<meta itemprop="startOffset" content="(\d+)"\s*\/>\s*<meta itemprop="endOffset" content="(\d+)"\s*\/>/g

async function fetchText(fetchImpl: FetchLike, url: string): Promise<string> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new TelebaselHttpError(res.status, url)
  return res.text()
}

function findEpisodeId(archiveHtml: string, broadcastDate: string): string {
  const wanted = broadcastDate // "YYYY-MM-DD"
  ARCHIVE_ENTRY_RE.lastIndex = 0
  for (const match of archiveHtml.matchAll(ARCHIVE_ENTRY_RE)) {
    const [, id, dd, mm, yyyy] = match as unknown as [
      string,
      string,
      string,
      string,
      string
    ]
    if (`${yyyy}-${mm}-${dd}` === wanted) return id
  }
  throw new TelebaselLookupError(
    `No punkt6 episode found on the telebasel.ch archive page for ${wanted}`
  )
}

function parseSegments(episodeHtml: string): TelebaselSegment[] {
  CLIP_RE.lastIndex = 0
  return [...episodeHtml.matchAll(CLIP_RE)].map((match) => {
    const [, name, start, end] = match as unknown as [
      string,
      string,
      string,
      string
    ]
    return {
      name: decodeHtmlEntities(name),
      startSeconds: Number(start),
      endSeconds: Number(end)
    }
  })
}

// The handful of entities telebasel.ch actually uses in these titles (mostly
// German quotation marks and ampersands) - not a general HTML-entity decoder.
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export function createTelebaselClient(
  fetchImpl: FetchLike = fetch
): TelebaselClient {
  return {
    async resolveEpisode(broadcastDate: string): Promise<TelebaselEpisode> {
      const archiveHtml = await fetchText(fetchImpl, ARCHIVE_URL)
      const id = findEpisodeId(archiveHtml, broadcastDate)
      const url = `https://telebasel.ch/sendungen/punkt6/${id}`
      const episodeHtml = await fetchText(fetchImpl, url)

      const durationMatch = DURATION_RE.exec(episodeHtml)
      const videoUrlMatch = VIDEO_URL_RE.exec(episodeHtml)
      const thumbnailMatch = THUMBNAIL_URL_RE.exec(episodeHtml)

      return {
        id,
        url,
        broadcastDate,
        durationSeconds: durationMatch ? Number(durationMatch[1]) : null,
        videoUrl: videoUrlMatch ? (videoUrlMatch[1] ?? null) : null,
        posterUrl: thumbnailMatch ? (thumbnailMatch[1] ?? null) : null,
        segments: parseSegments(episodeHtml)
      }
    }
  }
}
