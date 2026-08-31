import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  processDossier,
  type DossierLogger,
  type ItemsServiceLike,
  type ProcessDossierDeps
} from './process-dossier'
import type { SrgssrClient, SrgssrEpisode } from './srgssr-client'
import type { Dossier, Edition } from '../types/schema'
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

function fakeLogger(): DossierLogger {
  return { warn: vi.fn(), error: vi.fn() }
}

const ZIEFEN_HEADLINE = 'Ziefen wehrt sich gegen Bachem-Parkplatz'
const FCB_HEADLINE = 'FCB gegen FCB im Joggeli'
const UPK_HEADLINE = 'UPK Basel: Praktikanten haben ADHS-Abklärungen gemacht'

function episodeFor(
  headline: string,
  description: string | null = null
): SrgssrEpisode {
  return {
    urn: `urn:srf:audio:${headline.slice(0, 6)}`,
    title: headline,
    date: '2026-08-17T12:03:00+02:00',
    lead: 'Lead.',
    description,
    podcastHdUrl: 'https://example.com/a.mp3',
    podcastSdUrl: null
  }
}

/** SRGSSR resolves Ziefen and FCB, but fails for UPK - the case the test suite cares about. */
function partiallyFailingSrgssrClient(): SrgssrClient {
  return {
    getShowId: vi.fn().mockResolvedValue('show-1'),
    resolveEpisode: vi.fn(async (headline: string) => {
      if (headline === UPK_HEADLINE) throw new Error('No episode found.')
      return episodeFor(headline)
    })
  }
}

async function buildDeps(overrides: Partial<ProcessDossierDeps> = {}) {
  const buffer = await readFile(join(FIXTURES, 'Dossier (1).pdf'))
  const dossiers = fakeItemsService<Dossier>([
    {
      id: 'dossier-1',
      status: 'pending',
      source_file: 'file-1',
      source_message_id: null,
      source_subject: 'Dossier',
      error_message: null,
      processed_at: null,
      date_created: null,
      date_updated: null
    }
  ])
  const editions = fakeItemsService<Edition>()

  const deps: ProcessDossierDeps = {
    dossiers: dossiers.service,
    editions: editions.service,
    readSourceFile: vi.fn().mockResolvedValue(buffer),
    srgssrClient: partiallyFailingSrgssrClient(),
    logger: fakeLogger(),
    ...overrides
  }

  return { deps, dossiers, editions }
}

describe('processDossier', () => {
  it('processes every segment, degrading gracefully when one fails to resolve', async () => {
    const { deps, dossiers, editions } = await buildDeps()

    const result = await processDossier('dossier-1', deps)

    expect(result.status).toBe('processed')
    expect(result.editionIds).toHaveLength(3)

    const dossierRow = dossiers.all()[0]!
    expect(dossierRow.status).toBe('processed')
    expect(dossierRow.error_message).toBeNull()

    const byHeadline = new Map(editions.all().map((e) => [e.headline, e]))
    expect(byHeadline.get(ZIEFEN_HEADLINE)?.audio_url).toBe(
      'https://example.com/a.mp3'
    )
    expect(byHeadline.get(FCB_HEADLINE)?.audio_url).toBe(
      'https://example.com/a.mp3'
    )

    const upk = byHeadline.get(UPK_HEADLINE)!
    expect(upk.audio_url).toBeNull()
    expect(upk.resolution_error).toBe('No episode found.')
  })

  it('reprocessing the same dossier updates existing editions instead of duplicating them', async () => {
    const { deps, editions } = await buildDeps()

    await processDossier('dossier-1', deps)
    await processDossier('dossier-1', deps)

    expect(editions.all()).toHaveLength(3)
  })

  it('marks the dossier failed, with a message, when the PDF cannot be read', async () => {
    const { deps, dossiers, editions } = await buildDeps({
      readSourceFile: vi
        .fn()
        .mockRejectedValue(new Error('Directus Files: asset not found'))
    })

    const result = await processDossier('dossier-1', deps)

    expect(result.status).toBe('failed')
    expect(result.editionIds).toHaveLength(0)
    const dossierRow = dossiers.all()[0]!
    expect(dossierRow.status).toBe('failed')
    expect(dossierRow.error_message).toBe('Directus Files: asset not found')
    expect(editions.all()).toHaveLength(0)
  })

  it('calls Claude only for the segment(s) that actually have "Ausserdem" topics', async () => {
    const sendToClaude = vi.fn<MessageSender>().mockResolvedValue(
      claudeMessage(
        JSON.stringify({
          topics: [
            {
              headline: 'Mehrere Grosseinsätze fordern Rettungskräfte in Basel',
              timestamp: null,
              summary: null
            }
          ]
        })
      )
    )

    const srgssrClient: SrgssrClient = {
      getShowId: vi.fn().mockResolvedValue('show-1'),
      resolveEpisode: vi.fn(async (headline: string) => {
        if (headline === UPK_HEADLINE) throw new Error('No episode found.')
        if (headline === FCB_HEADLINE) {
          return episodeFor(
            headline,
            'Ausserdem: ·\tMehrere Grosseinsätze fordern Rettungskräfte in Basel'
          )
        }
        return episodeFor(headline) // Ziefen: no description, no Ausserdem topics
      })
    }

    const { deps, editions } = await buildDeps({ srgssrClient, sendToClaude })
    await processDossier('dossier-1', deps)

    expect(sendToClaude).toHaveBeenCalledTimes(1)

    const fcb = editions.all().find((e) => e.headline === FCB_HEADLINE)!
    expect(fcb.extra_topics).toEqual([
      {
        headline: 'Mehrere Grosseinsätze fordern Rettungskräfte in Basel',
        paragraphTimestamp: null,
        paragraphSeconds: null,
        summary: null
      }
    ])

    const ziefen = editions.all().find((e) => e.headline === ZIEFEN_HEADLINE)!
    expect(ziefen.extra_topics).toEqual([])
  })

  it('lets a failure reading the dossier row itself propagate to the caller', async () => {
    const { deps } = await buildDeps()
    await expect(processDossier('does-not-exist', deps)).rejects.toThrow(
      'not found'
    )
  })
})
