import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { MessageSender } from '../shared/claude'
import type { RegelZeile } from './gedaechtnis'
import {
  ladeAbfuhrkalender,
  raeumeMitteilungenAuf,
  sichteMitteilungen,
  type MitteilungenDienst,
  type ZeileFuerSichtung
} from './gemeindeseitenlauf'
import { regelnBlock, SICHTUNGSREGELN_UEBERSCHRIFT } from './lernen'

type Query = Record<string, unknown>

function nachricht(text: string): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 }
  } as unknown as Anthropic.Message
}

const STILL = { warn: vi.fn(), info: vi.fn() }

function mitteilungen(antwort: (q: Query) => unknown) {
  const aufrufe: Query[] = []
  const updates: Array<[string, Record<string, unknown>]> = []
  const updateMany = vi.fn(async () => undefined)
  const deleteMany = vi.fn(async () => undefined)
  const dienst: MitteilungenDienst & {
    aufrufe: Query[]
    updates: typeof updates
  } = {
    aufrufe,
    updates,
    readByQuery: async (q: Query) => {
      aufrufe.push(q)
      return antwort(q)
    },
    updateOne: async (key: string, payload: Record<string, unknown>) =>
      void updates.push([key, payload]),
    updateMany,
    deleteMany
  }
  return { dienst, updateMany, deleteMany }
}

const leer = { readByQuery: async () => [] }

describe('raeumeMitteilungenAuf', () => {
  it('laesst alte Vorschlaege verfallen und loescht altes Unvorgeschlagenes, in einem Schwung', async () => {
    const { dienst, updateMany, deleteMany } = mitteilungen(() => [
      {
        id: 'alt',
        entscheid: 'offen',
        vorschlag: null,
        publiziert_am: '2026-08-01',
        date_created: null
      },
      {
        id: 'vorschlag',
        entscheid: 'offen',
        vorschlag: true,
        publiziert_am: '2026-08-01',
        date_created: null
      },
      {
        id: 'frisch',
        entscheid: 'offen',
        vorschlag: null,
        publiziert_am: '2026-09-13',
        date_created: null
      }
    ])
    const ergebnis = await raeumeMitteilungenAuf(dienst, '2026-09-14', 4, STILL)
    expect(ergebnis).toEqual({ geloescht: 1, verfallen: 1 })
    expect(updateMany).toHaveBeenCalledWith(['vorschlag'], {
      entscheid: 'verfallen'
    })
    expect(deleteMany).toHaveBeenCalledWith(['alt'])
  })
})

describe('ladeAbfuhrkalender', () => {
  it('sagt, wenn keiner erfasst ist, und liest sonst das Fenster um heute', async () => {
    const termine = {
      readByQuery: vi.fn(async (_q: Query) => [
        { kategorie: 'Papier', zone: null, datum: '2026-09-22' }
      ])
    }
    const ohne = { readByQuery: async () => [] }
    expect(
      await ladeAbfuhrkalender(termine, ohne, 'g-1', '2026-09-14')
    ).toEqual({ vorhanden: false, termine: [], merkblatt: null })
    expect(termine.readByQuery).not.toHaveBeenCalled()

    const mit = {
      readByQuery: async () => [
        { id: 'k', jahr: 2026, merkblatt: 'Kehricht dienstags.' }
      ]
    }
    const kalender = await ladeAbfuhrkalender(termine, mit, 'g-1', '2026-09-14')
    expect(kalender).toEqual({
      vorhanden: true,
      termine: [{ kategorie: 'Papier', zone: null, datum: '2026-09-22' }],
      merkblatt: 'Kehricht dienstags.'
    })
    const frage = termine.readByQuery.mock.calls[0]?.[0] as Query
    expect(frage['filter']).toEqual({
      kalender: { gemeinde: { _eq: 'g-1' } },
      datum: { _between: ['2026-08-31', '2026-12-13'] }
    })
  })
})

describe('sichteMitteilungen', () => {
  const neue: ZeileFuerSichtung[] = [
    {
      id: 'm-1',
      titel: 'Papiersammlung am 22. September 2026',
      teaser: null,
      text: 'Bitte bis 7 Uhr bereitstellen.',
      publiziert_am: '2026-09-14',
      kategorie: null,
      text_abgeschnitten: false,
      anhaenge: []
    },
    {
      id: 'm-2',
      titel: 'Budget 2027 verabschiedet',
      teaser: 'Steuerfuss bleibt.',
      text: 'Der Gemeinderat …',
      publiziert_am: '2026-09-14',
      kategorie: 'politik_info',
      text_abgeschnitten: false,
      anhaenge: [{ gelesen: true }]
    }
  ]
  const regelzeilen: RegelZeile[] = [
    {
      id: 'r-1',
      regel: 'Budgetbeschluesse gehen an die Chefredaktion.',
      bereich: 'gemeinde',
      stufe: 'sichtung',
      wirkung: 'weiterreichen'
    }
  ]
  const sichtungsregeln = regelnBlock(regelzeilen, SICHTUNGSREGELN_UEBERSCHRIFT)

  function kontext(send: MessageSender, ueber: Record<string, unknown> = {}) {
    const { dienst } = mitteilungen((q) => {
      const felder = (q['fields'] ?? []) as string[]
      if (felder.includes('gemeinde.id')) {
        return [
          {
            ...neue[1],
            url: 'https://www.aesch.bl.ch/_rte/information/2',
            url_kanonisch: null,
            vorschlag_begruendung: 'Beschluss.',
            gemeinde: { id: 'g-1' }
          }
        ]
      }
      return []
    })
    const hinweise = {
      readByQuery: async () => [],
      createOne: vi.fn(async () => 'h-1')
    }
    const termine = {
      readByQuery: vi.fn(async () => [
        { kategorie: 'Papier', zone: null, datum: '2026-09-22' }
      ])
    }
    const kalender = {
      readByQuery: vi.fn(async () => [{ id: 'k', jahr: 2026, merkblatt: null }])
    }
    return {
      dienst,
      hinweise,
      termine,
      kalender,
      k: {
        mitteilungen: dienst,
        hinweise,
        meldungen: leer,
        termine,
        kalender,
        regelzeilen,
        sichtungsregeln,
        heute: '2026-09-14',
        logger: STILL,
        send,
        ...ueber
      }
    }
  }

  it('gibt dem Modell Kalender, Abgleich, Regeln und Beispiele im User-Turn, schreibt die Urteile zurueck und reicht nach Regel weiter', async () => {
    const send = vi.fn<MessageSender>().mockResolvedValue(
      nachricht(
        JSON.stringify({
          urteile: [
            {
              nummer: 1,
              vorschlag: false,
              begruendung: 'Steht im Abfuhrkalender.',
              empfehlung: null,
              empfehlung_regel: null
            },
            {
              nummer: 2,
              vorschlag: true,
              begruendung: 'Beschluss mit Wirkung.',
              empfehlung: 'weiterreichen',
              empfehlung_regel: 'R1'
            }
          ]
        })
      )
    )
    const { k, dienst, hinweise, termine } = kontext(send)

    const ergebnis = await sichteMitteilungen(
      neue,
      { id: 'g-1', name: 'Aesch' },
      k
    )

    expect(ergebnis).toEqual({
      vorschlaege: 1,
      weitergereicht: 1,
      fehler: null
    })
    const anfrage = send.mock.calls[0]?.[0]
    const system = typeof anfrage?.system === 'string' ? anfrage.system : ''
    const prompt = (anfrage?.messages[0]?.content as string) ?? ''
    expect(system).not.toContain('Aesch')
    expect(prompt).toContain('Gemeinde: Aesch')
    expect(prompt).toContain(
      'Abfuhrkalender Aesch (bekannte Termine, 1 im Fenster):'
    )
    expect(prompt).toContain(
      'Abfuhr-Abgleich: 22. September 2026: im Abfuhrkalender (Papier)'
    )
    expect(prompt).toContain(
      'R1: Budgetbeschluesse gehen an die Chefredaktion.'
    )
    expect(termine.readByQuery).toHaveBeenCalledTimes(1)
    expect(dienst.updates).toEqual([
      [
        'm-1',
        { vorschlag: false, vorschlag_begruendung: 'Steht im Abfuhrkalender.' }
      ],
      [
        'm-2',
        { vorschlag: true, vorschlag_begruendung: 'Beschluss mit Wirkung.' }
      ],
      ['m-2', { entscheid: 'weitergereicht' }]
    ])
    expect(hinweise.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        gemeindemitteilung: 'm-2',
        automatisch: true,
        regel: 'r-1',
        begruendung: expect.stringContaining(
          'Automatisch weitergereicht nach Regel'
        )
      })
    )
  })

  it('laedt den Kalender nur, wenn eine Mitteilung von Abfuhren handelt', async () => {
    const send = vi
      .fn<MessageSender>()
      .mockResolvedValue(nachricht(JSON.stringify({ urteile: [] })))
    const { k, termine, kalender } = kontext(send)
    await sichteMitteilungen([neue[1]!], { id: 'g-1', name: 'Aesch' }, k)
    expect(kalender.readByQuery).not.toHaveBeenCalled()
    expect(termine.readByQuery).not.toHaveBeenCalled()
    const prompt =
      (send.mock.calls[0]?.[0]?.messages[0]?.content as string) ?? ''
    expect(prompt).not.toContain('Abfuhrkalender')
  })

  it('ein gescheiterter Modellaufruf laesst die Urteile leer — nicht beurteilt ist nicht nein', async () => {
    const send = vi.fn<MessageSender>().mockRejectedValue(new Error('Netz weg'))
    const { k, dienst } = kontext(send)
    const ergebnis = await sichteMitteilungen(
      neue,
      { id: 'g-1', name: 'Aesch' },
      k
    )
    expect(ergebnis).toEqual({
      vorschlaege: 0,
      weitergereicht: 0,
      fehler: 'Netz weg'
    })
    expect(dienst.updates).toEqual([])
    expect(STILL.warn).toHaveBeenCalled()
  })
})
