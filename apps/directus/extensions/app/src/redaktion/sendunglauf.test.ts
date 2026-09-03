import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { beitraegeAusEdition, sichteSendung } from './sendunglauf'

// A reprocessed edition (telebasel.ch markers arriving late, a second button
// press) must diff like the press review's re-inventory: open candidates are
// replaced by the fresh Sichtung, decided ones stay and are never re-created.

// Die echte Sendung vom 27.08.2026, gekuerzt: die Anmoderation reisst ALLE
// Themen in einem Atemzug an — Bottmingen inklusive — dann kommt der
// Hauptbeitrag, danach die Nebenthemen mit ihrer eigenen Berichterstattung,
// zuletzt eine Abmoderation. Genau diese Form hat die Doppel erzeugt.
const SENDUNG = {
  headline: 'Tod wegen Überdosis Methadon: Gericht muss erneut entscheiden',
  lead: 'Der Fall beschäftigt seit heute das Basler Appellgericht.',
  transcript: [
    {
      timestamp: '00:00:00',
      seconds: 0,
      text: 'Das Regionaljournal aus Basel.'
    },
    {
      timestamp: '00:00:06',
      seconds: 6,
      text:
        'Eine junge Frau stirbt an einer Überdosis Methadon. Das Land zahlt weniger, ' +
        'die Stadt mehr. Und: temporäre Kunst in Bottmingen.'
    },
    {
      timestamp: '00:00:40',
      seconds: 40,
      text: 'Der Fall ist heute in Basel vor Gericht.'
    },
    {
      timestamp: '00:03:30',
      seconds: 210,
      text: 'Die Verteidigung plädiert auf Freispruch.'
    },
    {
      timestamp: '00:07:11',
      seconds: 431,
      text: 'Die Primeo hat Strom gekauft, als er tief war.'
    },
    {
      timestamp: '00:10:36',
      seconds: 636,
      text: 'Die Weinproduzenten sind zuversichtlich.'
    },
    {
      timestamp: '00:12:17',
      seconds: 737,
      text: 'Sven entscheidet spontan, was er an die Wand sprüht.'
    },
    {
      timestamp: '00:14:01',
      seconds: 841,
      text: 'Finanziell unterstützt wurde das Projekt von Bottmingen.'
    },
    {
      timestamp: '00:15:46',
      seconds: 946,
      text: 'Das Streetartkunstprojekt Temporary ist noch zu sehen.'
    }
  ],
  extra_topics: [
    {
      headline: 'Strompreise in den beiden Basel unterschiedlich',
      paragraphTimestamp: '00:06:37',
      paragraphSeconds: 397,
      summary: 'Unterschiedliche Preise.'
    },
    {
      headline: 'Temporäre Kunst in Bottmingen',
      paragraphTimestamp: '00:11:49',
      paragraphSeconds: 709,
      summary: '30 Künstler bemalen ein Haus.'
    }
  ]
}

describe('beitraegeAusEdition', () => {
  it('gibt jedem Thema seine eigene Passage, statt allen den Volltext', () => {
    const beitraege = beitraegeAusEdition(SENDUNG)

    expect(beitraege).toHaveLength(3)
    const [haupt, strom, kunst] = beitraege

    // Der Kunst-Beitrag bekommt seine Passage ab 709s — und die Abmoderation,
    // die noch dazugehoert.
    expect(kunst!.zeitmarkeSekunden).toBe(709)
    expect(kunst!.text).toContain('Sven entscheidet spontan')
    expect(kunst!.text).toContain('Finanziell unterstützt')
    expect(kunst!.text).toContain('noch zu sehen')

    // Das Strompreis-Thema endet dort, wo die Kunst anfaengt.
    expect(strom!.text).toContain('Primeo')
    expect(strom!.text).not.toContain('Sven entscheidet')

    // Der Kern: Der Hauptbeitrag sieht die Kunst-Passage NICHT mehr. Sonst
    // wird dasselbe Ereignis zweimal gesichtet und zweimal vorgeschlagen —
    // einmal ohne Zeitmarke, was auf keine Stelle im Audio zeigt.
    expect(haupt!.zeitmarkeSekunden).toBeNull()
    expect(haupt!.text).toContain('vor Gericht')
    expect(haupt!.text).not.toContain('Sven entscheidet')
    expect(haupt!.text).not.toContain('Finanziell unterstützt')
  })

  it('behaelt beim Hauptbeitrag, was die Sendung ohne "Ausserdem" brachte', () => {
    // Gemessen: "Tempo 30 in Münchenstein", der Tramnetz-Umbau in Muttenz und
    // die Süd-Anfluege über Allschwil hatten kein eigenes Nebenthema und waren
    // nur so zu finden. Der Anriss der Anmoderation bleibt ebenfalls stehen —
    // ein Satz, den der Sichtungs-Prompt als blosse Erwaehnung lesen soll.
    const haupt = beitraegeAusEdition(SENDUNG)[0]!
    expect(haupt.text).toContain('temporäre Kunst in Bottmingen')
    expect(haupt.text).toContain('Das Regionaljournal aus Basel')
  })

  it('laesst ein Thema ohne aufgeloeste Stelle bei Titel und Zusammenfassung', () => {
    const beitraege = beitraegeAusEdition({
      ...SENDUNG,
      extra_topics: [
        {
          headline: 'Unauffindbares Thema',
          paragraphTimestamp: null,
          paragraphSeconds: null,
          summary: 'Kurz.'
        }
      ]
    })

    expect(beitraege).toHaveLength(2)
    expect(beitraege[1]!.text).toBe('Unauffindbares Thema\n\nKurz.')
    // Ohne Grenze bleibt dem Hauptbeitrag der ganze Volltext — es gibt keine
    // Passage, die ihm streitig gemacht wuerde.
    expect(beitraege[0]!.text).toContain('Sven entscheidet spontan')
  })

  it('vertraegt eine Sendung ohne Nebenthemen', () => {
    const beitraege = beitraegeAusEdition({ ...SENDUNG, extra_topics: [] })
    expect(beitraege).toHaveLength(1)
    expect(beitraege[0]!.text).toContain('Sven entscheidet spontan')
  })
})

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
