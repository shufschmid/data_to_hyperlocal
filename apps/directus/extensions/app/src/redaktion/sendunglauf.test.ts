import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { sichteSendung } from './sendunglauf'

// A reprocessed edition (telebasel.ch markers arriving late, a second button
// press) must diff like the press review's re-inventory: open candidates are
// replaced by the fresh Sichtung, decided ones stay and are never re-created.

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

const KANDIDAT_TITEL = 'Neues Schulhaus in Aesch'

const ANTWORT = JSON.stringify({
  kandidaten: [
    {
      gemeinde: 'Aesch',
      titel: KANDIDAT_TITEL,
      zusammenfassung: 'Aesch baut ein neues Schulhaus.',
      begruendung: 'Der Beitrag handelt von Aesch.'
    }
  ]
})

interface KandidatZeile {
  id: string
  entscheid: string
  titel: string
  gemeinde: string
}

function baueDienste(bestehende: KandidatZeile[]) {
  const angelegt: Record<string, unknown>[] = []
  const geloescht: string[] = []

  const dienste = {
    editions: {
      readByQuery: vi.fn().mockResolvedValue([
        {
          id: 'edition-1',
          headline: KANDIDAT_TITEL,
          lead: null,
          transcript: [
            { timestamp: '00:00:01', seconds: 1, text: 'In Aesch wird gebaut.' }
          ],
          extra_topics: [],
          broadcast_date: '2026-08-31',
          main_start_seconds: null,
          main_end_seconds: null
        }
      ]),
      createOne: vi.fn(),
      deleteMany: vi.fn()
    },
    kandidaten: {
      // Two queries land here: the lernDigest one (filter.quelle) and the
      // per-edition one (filter.punkt6_edition) - only the latter sees rows.
      readByQuery: vi.fn(async (query: { filter?: Record<string, unknown> }) =>
        query.filter?.['punkt6_edition'] !== undefined ? bestehende : []
      ),
      createOne: vi.fn(async (payload: Record<string, unknown>) => {
        angelegt.push(payload)
        return 'kandidat-neu'
      }),
      deleteMany: vi.fn(async (keys: string[]) => {
        geloescht.push(...keys)
      })
    },
    gemeinden: {
      readByQuery: vi
        .fn()
        .mockResolvedValue([{ id: 'gemeinde-aesch', name: 'Aesch' }]),
      createOne: vi.fn(),
      deleteMany: vi.fn()
    },
    logger: { warn: vi.fn() },
    send: vi.fn().mockResolvedValue(claudeMessage(ANTWORT))
  }

  return { dienste, angelegt, geloescht }
}

describe('sichteSendung', () => {
  it("replaces an edition's OPEN candidates on reprocessing instead of duplicating them", async () => {
    const { dienste, angelegt, geloescht } = baueDienste([
      {
        id: 'kandidat-alt',
        entscheid: 'offen',
        titel: KANDIDAT_TITEL,
        gemeinde: 'gemeinde-aesch'
      }
    ])

    const ergebnis = await sichteSendung(
      ['edition-1'],
      'punkt6',
      dienste as never
    )

    expect(geloescht).toEqual(['kandidat-alt'])
    expect(angelegt).toHaveLength(1)
    expect(ergebnis.kandidaten).toBe(1)
  })

  it('never re-creates a candidate the desk already decided', async () => {
    const { dienste, angelegt, geloescht } = baueDienste([
      {
        id: 'kandidat-entschieden',
        entscheid: 'abgelehnt',
        titel: KANDIDAT_TITEL,
        gemeinde: 'gemeinde-aesch'
      }
    ])

    const ergebnis = await sichteSendung(
      ['edition-1'],
      'punkt6',
      dienste as never
    )

    expect(geloescht).toEqual([])
    expect(angelegt).toHaveLength(0)
    expect(ergebnis.kandidaten).toBe(0)
  })
})
