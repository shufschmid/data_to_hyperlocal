import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  processPunkt6Dossier,
  type ItemsServiceLike,
  type ProcessPunkt6DossierDeps,
  type Punkt6Logger
} from './process-punkt6-dossier'
import { parsePunkt6Dossier, type Punkt6Segment } from './pdf-parser'
import {
  createTelebaselClient,
  type TelebaselClient,
  type TelebaselEpisode
} from './telebasel-client'
import type { Punkt6Dossier, Punkt6Edition } from '../types/schema'
import type { MessageSender } from '../shared/claude'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

function claudeMessage(text: string): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 }
  } as unknown as Anthropic.Message
}

function fakeItemsService<T extends { id: string }>(initial: T[] = []) {
  const store = new Map<string, T>(initial.map((item) => [item.id, item]))
  let counter = 0

  const service: ItemsServiceLike<T> = {
    async readOne(key) {
      const item = store.get(key)
      if (!item) throw new Error(`not found: ${key}`)
      return item
    },
    async createOne(data) {
      const id = `generated-${++counter}`
      store.set(id, { id, ...data } as T)
      return id
    },
    async updateOne(key, data) {
      const existing = store.get(key)
      if (!existing) throw new Error(`not found: ${key}`)
      store.set(key, { ...existing, ...data })
      return key
    },
    async readByQuery(query) {
      const q = query as { filter?: Record<string, { _eq: unknown }> }
      return [...store.values()].filter((item) => {
        if (!q.filter) return true
        return Object.entries(q.filter).every(
          ([field, cond]) =>
            (item as unknown as Record<string, unknown>)[field] === cond._eq
        )
      })
    }
  }

  return { service, all: () => [...store.values()] }
}

function fakeLogger(): Punkt6Logger {
  return { warn: vi.fn(), error: vi.fn() }
}

const MAIN_HEADLINE = 'Polizei geht gegen die Demo vor'
const OTHER_HEADLINE = 'Metrobasel diskutiert'

const SEGMENT: Punkt6Segment = {
  broadcastDate: '2026-08-25',
  headline: 'punkt6 vom 25.08.2026',
  paragraphs: [
    { timestamp: '00:00:49', seconds: 49, text: 'Zur Demo.' },
    { timestamp: '00:02:06', seconds: 126, text: 'Zu Metrobasel.' }
  ]
}

const EPISODE: TelebaselEpisode = {
  id: '239377',
  url: 'https://telebasel.ch/sendungen/punkt6/239377',
  broadcastDate: '2026-08-25',
  durationSeconds: 816,
  videoUrl:
    'https://simplex-cdn-media.akamaized.net/content/4062/4063/239377/index.m3u8',
  posterUrl:
    'https://simplex-cdn-media.akamaized.net/content/4062/4063/239377/simvid_1.jpg',
  segments: [
    { name: MAIN_HEADLINE, startSeconds: 0, endSeconds: 100 },
    { name: OTHER_HEADLINE, startSeconds: 100, endSeconds: 300 }
  ]
}

function workingTelebaselClient(): TelebaselClient {
  return { resolveEpisode: vi.fn().mockResolvedValue(EPISODE) }
}

async function buildDeps(overrides: Partial<ProcessPunkt6DossierDeps> = {}) {
  const dossiers = fakeItemsService<Punkt6Dossier>([
    {
      id: 'dossier-1',
      status: 'pending',
      source_file: 'file-1',
      source_message_id: null,
      source_subject: 'punkt6',
      error_message: null,
      processed_at: null,
      date_created: null,
      date_updated: null
    }
  ])
  const editions = fakeItemsService<Punkt6Edition>()

  const deps: ProcessPunkt6DossierDeps = {
    dossiers: dossiers.service,
    editions: editions.service,
    readSourceFile: vi.fn().mockResolvedValue(Buffer.from('fake pdf bytes')),
    parseDossier: vi.fn().mockResolvedValue(SEGMENT),
    telebaselClient: workingTelebaselClient(),
    logger: fakeLogger(),
    ...overrides
  }

  return { deps, dossiers, editions }
}

describe('processPunkt6Dossier', () => {
  it('creates ONE edition per Sendung: the first telebasel.ch segment as Hauptbeitrag, the rest as extra_topics', async () => {
    const { deps, dossiers, editions } = await buildDeps()

    const result = await processPunkt6Dossier('dossier-1', deps)

    expect(result.status).toBe('processed')
    expect(editions.all()).toHaveLength(1)

    const dossierRow = dossiers.all()[0]!
    expect(dossierRow.status).toBe('processed')
    expect(dossierRow.error_message).toBeNull()

    const edition = editions.all()[0]!
    expect(result.editionId).toBe(edition.id)
    expect(edition.headline).toBe(MAIN_HEADLINE)
    expect(edition.main_start_seconds).toBe(0)
    expect(edition.main_end_seconds).toBe(100)
    // The WHOLE episode's transcript, not just the Hauptbeitrag's own slice.
    expect(edition.transcript).toEqual(SEGMENT.paragraphs)
    expect(edition.video_url).toBe(EPISODE.videoUrl)
    expect(edition.episode_url).toBe(EPISODE.url)
    expect(edition.resolution_error).toBeNull()

    expect(edition.extra_topics).toEqual([
      {
        headline: OTHER_HEADLINE,
        summary: null,
        startSeconds: 100,
        endSeconds: 300
      }
    ])
  })

  it('falls back to one headline-only, unsegmented edition when telebasel.ch resolution fails, rather than creating none', async () => {
    const telebaselClient: TelebaselClient = {
      resolveEpisode: vi.fn().mockRejectedValue(new Error('No episode found.'))
    }
    const { deps, dossiers, editions } = await buildDeps({ telebaselClient })

    const result = await processPunkt6Dossier('dossier-1', deps)

    expect(result.status).toBe('processed')
    expect(dossiers.all()[0]!.status).toBe('processed')
    expect(editions.all()).toHaveLength(1)

    const edition = editions.all()[0]!
    expect(edition.headline).toBe(SEGMENT.headline)
    expect(edition.transcript).toEqual(SEGMENT.paragraphs)
    expect(edition.main_start_seconds).toBeNull()
    expect(edition.extra_topics).toEqual([])
    expect(edition.video_url).toBeNull()
    expect(edition.resolution_error).toBe('No episode found.')
  })

  it('reprocessing the same dossier updates the existing edition instead of duplicating it', async () => {
    const { deps, editions } = await buildDeps()

    await processPunkt6Dossier('dossier-1', deps)
    await processPunkt6Dossier('dossier-1', deps)

    expect(editions.all()).toHaveLength(1)
  })

  it('marks the dossier failed, with a message, when the PDF cannot be read', async () => {
    const { deps, dossiers, editions } = await buildDeps({
      readSourceFile: vi
        .fn()
        .mockRejectedValue(new Error('Directus Files: asset not found'))
    })

    const result = await processPunkt6Dossier('dossier-1', deps)

    expect(result.status).toBe('failed')
    expect(result.editionId).toBeNull()
    expect(dossiers.all()[0]!.status).toBe('failed')
    expect(dossiers.all()[0]!.error_message).toBe(
      'Directus Files: asset not found'
    )
    expect(editions.all()).toHaveLength(0)
  })

  it('writes Claude-generated leads for the Hauptbeitrag and every extra topic', async () => {
    const sendToClaude = vi.fn<MessageSender>().mockResolvedValue(
      claudeMessage(
        JSON.stringify({
          leads: [
            {
              headline: MAIN_HEADLINE,
              lead: 'Kurze Zusammenfassung zur Demo.'
            },
            {
              headline: OTHER_HEADLINE,
              lead: 'Kurze Zusammenfassung zu Metrobasel.'
            }
          ]
        })
      )
    )
    const { deps, editions } = await buildDeps({ sendToClaude })

    await processPunkt6Dossier('dossier-1', deps)

    const edition = editions.all()[0]!
    expect(edition.lead).toBe('Kurze Zusammenfassung zur Demo.')
    expect(edition.extra_topics![0]!.summary).toBe(
      'Kurze Zusammenfassung zu Metrobasel.'
    )
  })

  it('continues without leads when Claude fails, rather than aborting the dossier', async () => {
    const sendToClaude = vi
      .fn<MessageSender>()
      .mockRejectedValue(new Error('Claude unavailable'))
    const { deps, editions } = await buildDeps({ sendToClaude })

    const result = await processPunkt6Dossier('dossier-1', deps)

    expect(result.status).toBe('processed')
    const edition = editions.all()[0]!
    expect(edition.lead).toBeNull()
    expect(edition.extra_topics!.every((t) => t.summary === null)).toBe(true)
  })

  it('lets a failure reading the dossier row itself propagate to the caller', async () => {
    const { deps } = await buildDeps()
    await expect(processPunkt6Dossier('does-not-exist', deps)).rejects.toThrow(
      'not found'
    )
  })
})

// Full pipeline against real data: the actual TEBV_2026-08-25.pdf (pdfjs-dist, no
// stub) resolved against a saved real telebasel.ch response for the matching
// episode (id 239377, stubbed fetch only - no live network call in a test run).
describe('processPunkt6Dossier (real PDF + real telebasel.ch fixtures)', () => {
  it('builds one edition: the real first Beitrag as Hauptbeitrag, the other six as extra_topics', async () => {
    const buffer = await readFile(join(FIXTURES, 'TEBV_2026-08-25.pdf'))
    const archiveHtml = await readFile(join(FIXTURES, 'archive.html'), 'utf-8')
    const episodeHtml = await readFile(
      join(FIXTURES, 'episode-239377.html'),
      'utf-8'
    )

    const fetchImpl = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === 'https://telebasel.ch/sendungen/punkt6')
        return new Response(archiveHtml, { status: 200 })
      if (url === 'https://telebasel.ch/sendungen/punkt6/239377')
        return new Response(episodeHtml, { status: 200 })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    const { deps, dossiers, editions } = await buildDeps({
      readSourceFile: vi.fn().mockResolvedValue(buffer),
      parseDossier: parsePunkt6Dossier,
      telebaselClient: createTelebaselClient(fetchImpl)
    })

    const result = await processPunkt6Dossier('dossier-1', deps)

    expect(result.status).toBe('processed')
    expect(dossiers.all()[0]!.status).toBe('processed')
    expect(editions.all()).toHaveLength(1)

    const edition = editions.all()[0]!
    expect(edition.headline).toBe(
      'Polizei geht gegen «Death to Zionism»-Demo vor'
    )
    expect(edition.main_start_seconds).toBe(49)
    expect(edition.main_end_seconds).toBe(126)
    expect(edition.video_url).toBe(
      'https://simplex-cdn-media.akamaized.net/content/4062/4063/239377/index.m3u8'
    )
    expect(edition.episode_url).toBe(
      'https://telebasel.ch/sendungen/punkt6/239377'
    )
    expect(edition.resolution_error).toBeNull()

    // The WHOLE episode's transcript (all paragraphs), not just the Hauptbeitrag's slice.
    expect(edition.transcript!.length).toBeGreaterThan(200)

    expect(edition.extra_topics).toHaveLength(6)
    const kunsttage = edition.extra_topics!.find(
      (t) =>
        t.headline === 'Kunsttage Basel ermöglichen Einblick in die Kunstwelt'
    )!
    expect(kunsttage.startSeconds).toBe(606)
    expect(kunsttage.endSeconds).toBe(816)
  })
})
