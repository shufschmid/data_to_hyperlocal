import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { MessageSender } from '../shared/claude'
import type { RegelZeile } from './gedaechtnis'
import {
  ladeKalenderAnlaesse,
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

const JASSABEND = {
  titel: 'Jassabend',
  lokalitaet: 'Mehrzweckhalle',
  von: '2026-09-22',
  bis: null,
  termine: ['2026-09-22'],
  rhythmus: 'einmalig'
}

describe('ladeKalenderAnlaesse', () => {
  it('sagt, wenn kein Kalender erfasst ist, und liest sonst die Anlaesse ab heute', async () => {
    const anlaesse = {
      readByQuery: vi.fn(async (_q: Query) => [JASSABEND])
    }
    const ohne = { readByQuery: async () => [] }
    expect(
      await ladeKalenderAnlaesse(ohne, anlaesse, 'g-1', '2026-09-14')
    ).toEqual({ vorhanden: false, anlaesse: [] })
    expect(anlaesse.readByQuery).not.toHaveBeenCalled()

    const mit = { readByQuery: async () => [{ id: 'q-1' }] }
    const stand = await ladeKalenderAnlaesse(mit, anlaesse, 'g-1', '2026-09-14')
    expect(stand).toEqual({ vorhanden: true, anlaesse: [JASSABEND] })
    const frage = anlaesse.readByQuery.mock.calls[0]?.[0] as Query
    expect(frage['filter']).toEqual({
      gemeinde: { _eq: 'g-1' },
      _or: [{ bis: { _gte: '2026-09-14' } }, { von: { _gte: '2026-09-14' } }]
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
      anhaenge: [],
      veranstaltung_am: null
    },
    {
      id: 'm-2',
      titel: 'Budget 2027 verabschiedet',
      teaser: 'Steuerfuss bleibt.',
      text: 'Der Gemeinderat …',
      publiziert_am: '2026-09-14',
      kategorie: 'politik_info',
      text_abgeschnitten: false,
      anhaenge: [{ gelesen: true }],
      veranstaltung_am: null
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
    const anlaesse = {
      readByQuery: vi.fn(async () => [JASSABEND])
    }
    const quellen = {
      readByQuery: vi.fn(async () => [{ id: 'q-1' }])
    }
    return {
      dienst,
      hinweise,
      anlaesse,
      quellen,
      k: {
        mitteilungen: dienst,
        hinweise,
        meldungen: leer,
        anlaesse,
        quellen,
        regelzeilen,
        sichtungsregeln,
        heute: '2026-09-14',
        logger: STILL,
        send,
        ...ueber
      }
    }
  }

  it('gibt dem Modell den Kalender-Abgleich, Regeln und Beispiele im User-Turn, schreibt die Urteile zurueck und reicht nach Regel weiter', async () => {
    const send = vi.fn<MessageSender>().mockResolvedValue(
      nachricht(
        JSON.stringify({
          urteile: [
            {
              nummer: 1,
              stufe: 1,
              begruendung: 'Steht im Abfuhrkalender.',
              empfehlung: null,
              empfehlung_regel: null
            },
            {
              nummer: 2,
              stufe: 3,
              begruendung: 'Beschluss mit Wirkung.',
              empfehlung: 'weiterreichen',
              empfehlung_regel: 'R1'
            }
          ]
        })
      )
    )
    const { k, dienst, hinweise, anlaesse } = kontext(send)

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
    // In Paketen, ohne Nachdenken, mit gecachtem Praefix (30.09.2026): der
    // Etat deckt ein Paket, und ein abgeschnittenes kostet nur seine Zeilen.
    expect(anfrage?.max_tokens).toBe(4000)
    expect(anfrage?.thinking).toEqual({ type: 'disabled' })
    const system = Array.isArray(anfrage?.system)
      ? anfrage.system.map((b) => b.text).join('\n')
      : (anfrage?.system ?? '')
    expect(
      Array.isArray(anfrage?.system) && anfrage.system[0]?.cache_control
    ).toEqual({
      type: 'ephemeral'
    })
    const prompt = (anfrage?.messages[0]?.content as string) ?? ''
    expect(system).not.toContain('Aesch')
    expect(prompt).toContain('Gemeinde: Aesch')
    expect(prompt).toContain(
      'Kalender-Abgleich: 22. September 2026: im Kalender «Jassabend» (Mehrzweckhalle)'
    )
    expect(prompt).not.toContain('Abfuhrkalender')
    expect(prompt).toContain(
      'R1: Budgetbeschluesse gehen an die Chefredaktion.'
    )
    expect(anlaesse.readByQuery).toHaveBeenCalledTimes(1)
    expect(dienst.updates).toEqual([
      [
        'm-1',
        {
          vorschlag: false,
          vorschlag_wert: 1,
          vorschlag_begruendung: 'Steht im Abfuhrkalender.'
        }
      ],
      [
        'm-2',
        {
          vorschlag: true,
          vorschlag_wert: 3,
          vorschlag_begruendung: 'Beschluss mit Wirkung.'
        }
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

  it('liest den Kalender nur, wenn eine Mitteilung einen kuenftigen Tag nennt', async () => {
    const send = vi
      .fn<MessageSender>()
      .mockResolvedValue(nachricht(JSON.stringify({ urteile: [] })))
    const { k, anlaesse, quellen } = kontext(send)
    await sichteMitteilungen([neue[1]!], { id: 'g-1', name: 'Aesch' }, k)
    expect(quellen.readByQuery).not.toHaveBeenCalled()
    expect(anlaesse.readByQuery).not.toHaveBeenCalled()
    const prompt =
      (send.mock.calls[0]?.[0]?.messages[0]?.content as string) ?? ''
    expect(prompt).not.toContain('Kalender-Abgleich')
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

describe('sichteMitteilungen: Termine', () => {
  // Der Termin von gestern kostet keinen Token: das entscheidet Code, und die
  // Zeile sagt auf dem Tisch, warum sie kein Vorschlag ist.
  it('urteilt ueber vergangene Termine selbst und fragt das Modell nur zum Rest', async () => {
    const send = vi.fn<MessageSender>().mockResolvedValue(
      nachricht(
        JSON.stringify({
          urteile: [
            {
              nummer: 1,
              stufe: 3,
              begruendung: 'Einwohnerratssitzung.',
              empfehlung: null,
              empfehlung_regel: null
            }
          ]
        })
      )
    )
    const updates: Array<[string, Record<string, unknown>]> = []
    const dienst: MitteilungenDienst = {
      readByQuery: async () => [],
      updateOne: async (key, payload) => {
        updates.push([key, payload])
        return undefined
      },
      updateMany: async () => undefined,
      deleteMany: async () => undefined
    }
    const ergebnis = await sichteMitteilungen(
      [
        {
          id: 'v-1',
          titel: 'Einwohnerratssitzung',
          teaser: null,
          text: null,
          publiziert_am: null,
          kategorie: null,
          text_abgeschnitten: false,
          anhaenge: [],
          veranstaltung_am: '2026-10-13'
        },
        {
          id: 'v-2',
          titel: 'Flohmaert',
          teaser: null,
          text: null,
          publiziert_am: null,
          kategorie: null,
          text_abgeschnitten: false,
          anhaenge: [],
          veranstaltung_am: '2026-09-13'
        }
      ],
      { id: 'g-1', name: 'Allschwil' },
      {
        mitteilungen: dienst,
        hinweise: { readByQuery: async () => [], createOne: async () => 'h' },
        meldungen: leer,
        anlaesse: leer,
        quellen: leer,
        regelzeilen: [],
        sichtungsregeln: { text: '', nummern: new Map() },
        heute: '2026-09-14',
        logger: STILL,
        send
      }
    )

    const prompt = String(
      (send.mock.calls[0]?.[0] as { messages: Array<{ content: string }> })
        .messages[0]?.content
    )
    expect(prompt).toContain('Einwohnerratssitzung')
    expect(prompt).not.toContain('Flohmaert')
    expect(prompt).toContain('Termin am 13. Oktober 2026')
    expect(ergebnis.vorschlaege).toBe(1)
    expect(updates).toContainEqual([
      'v-2',
      {
        vorschlag: false,
        vorschlag_begruendung:
          'Der Termin hat vor der Sichtung stattgefunden — kein Vorschlag.'
      }
    ])
  })

  it('ruft gar kein Modell, wenn alle Termine vorbei sind', async () => {
    const send = vi.fn<MessageSender>()
    const ergebnis = await sichteMitteilungen(
      [
        {
          id: 'v-1',
          titel: 'Gestern',
          teaser: null,
          text: null,
          publiziert_am: null,
          kategorie: null,
          text_abgeschnitten: false,
          anhaenge: [],
          veranstaltung_am: '2026-09-13'
        }
      ],
      { id: 'g-1', name: 'Allschwil' },
      {
        mitteilungen: {
          readByQuery: async () => [],
          updateOne: async () => undefined,
          updateMany: async () => undefined,
          deleteMany: async () => undefined
        },
        hinweise: { readByQuery: async () => [], createOne: async () => 'h' },
        meldungen: leer,
        anlaesse: leer,
        quellen: leer,
        regelzeilen: [],
        sichtungsregeln: { text: '', nummern: new Map() },
        heute: '2026-09-14',
        logger: STILL,
        send
      }
    )

    expect(send).not.toHaveBeenCalled()
    expect(ergebnis).toEqual({
      vorschlaege: 0,
      weitergereicht: 0,
      fehler: null
    })
  })
})
