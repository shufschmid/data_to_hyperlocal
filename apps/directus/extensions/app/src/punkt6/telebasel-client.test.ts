import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createTelebaselClient, TelebaselLookupError } from './telebasel-client'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

async function loadFixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), 'utf-8')
}

// Both fixtures are real telebasel.ch pages, fetched during development
// (archive.html: https://telebasel.ch/sendungen/punkt6 ;
//  episode-239377.html: https://telebasel.ch/sendungen/punkt6/239377) - this test
// pins the client's HTML-scraping regexes against the site's actual current markup,
// not a hand-written approximation of it.
function stubFetch(byUrl: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = byUrl[url]
    if (body === undefined) throw new Error(`unexpected fetch: ${url}`)
    return new Response(body, { status: 200 })
  }) as typeof fetch
}

describe('createTelebaselClient', () => {
  it('resolves a known broadcast date to its episode, video URL and segments', async () => {
    const archiveHtml = await loadFixture('archive.html')
    const episodeHtml = await loadFixture('episode-239377.html')
    const client = createTelebaselClient(
      stubFetch({
        'https://telebasel.ch/sendungen/punkt6': archiveHtml,
        'https://telebasel.ch/sendungen/punkt6/239377': episodeHtml
      })
    )

    const episode = await client.resolveEpisode('2026-08-25')

    expect(episode.id).toBe('239377')
    expect(episode.url).toBe('https://telebasel.ch/sendungen/punkt6/239377')
    expect(episode.durationSeconds).toBe(816)
    expect(episode.videoUrl).toBe(
      'https://simplex-cdn-media.akamaized.net/content/4062/4063/239377/index.m3u8'
    )
    expect(episode.posterUrl).toBe(
      'https://simplex-cdn-media.akamaized.net/content/4062/4063/239377/simvid_1.jpg'
    )

    expect(episode.segments).toEqual([
      {
        name: 'Polizei geht gegen «Death to Zionism»-Demo vor',
        startSeconds: 49,
        endSeconds: 126
      },
      {
        name: 'Metrobasel diskutiert Wettbewerbsfähigkeit der Schweiz',
        startSeconds: 126,
        endSeconds: 313
      },
      {
        name: 'Startschuss für Sanierung zwischen Claraplatz und Kaserne',
        startSeconds: 313,
        endSeconds: 363
      },
      {
        name: 'Der neue Norimattsteg steht',
        startSeconds: 363,
        endSeconds: 550
      },
      {
        name: 'Wassermangel: Badi Gelterkinden schliesst vorzeitig',
        startSeconds: 550,
        endSeconds: 570
      },
      {
        name: '81-Jähriger verursacht Unfall: Drei Personen verletzt',
        startSeconds: 570,
        endSeconds: 606
      },
      {
        name: 'Kunsttage Basel ermöglichen Einblick in die Kunstwelt',
        startSeconds: 606,
        endSeconds: 816
      }
    ])
  })

  it('throws TelebaselLookupError when no episode matches the broadcast date', async () => {
    const archiveHtml = await loadFixture('archive.html')
    const client = createTelebaselClient(
      stubFetch({ 'https://telebasel.ch/sendungen/punkt6': archiveHtml })
    )

    await expect(client.resolveEpisode('2020-01-01')).rejects.toThrow(
      TelebaselLookupError
    )
  })
})
