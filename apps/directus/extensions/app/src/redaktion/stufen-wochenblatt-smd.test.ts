import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { MessageSender } from '../shared/claude'
import { regelnBlock, SICHTUNGSREGELN_UEBERSCHRIFT } from './lernen'
import {
  formulierbare,
  INVENTAR_SCHEMA,
  INVENTAR_SYSTEM_PROMPT,
  parseInventar
} from './presseschau'
import { formulierAuswahl } from './presseschaumeldungen'
import { SICHTUNG_SCHEMA, SMD_SICHTUNG_SYSTEM_PROMPT } from './smd'
import {
  gleicheSmdSchwelleAb,
  sichteSmdBeitraege,
  type ZeileFuerSmdSichtung
} from './smdlauf'
import {
  EINSTELLBARE_TISCHE,
  istEinstellbarerTisch,
  tischFelder
} from './tischeinstellungen'

// The relevance grades on the Wochenblätter and SMD desks (22 November 2026):
// the inventory and the SMD Sichtung grade 1–4, the desk's threshold says
// from which grade the run writes the draft, and nothing is published by it.

type Query = Record<string, unknown>
const STILL = { info: () => undefined, warn: () => undefined }

describe('tischeinstellungen — Wochenblätter und SMD', () => {
  it('kennt beide als benotende Tische', () => {
    expect(EINSTELLBARE_TISCHE).toContain('wochenblatt')
    expect(EINSTELLBARE_TISCHE).toContain('smd')
    expect(istEinstellbarerTisch('wochenblatt')).toBe(true)
    expect(istEinstellbarerTisch('smd')).toBe(true)
  })

  it('nimmt fuer beide nur die Schwelle', () => {
    for (const tisch of ['wochenblatt', 'smd'] as const) {
      expect(
        tischFelder(tisch, {
          schwelle: 2,
          vorlauf_stufe4: 45,
          dauerangebote_je_woche: 3
        })
      ).toEqual({ schwelle: 2 })
      expect(() => tischFelder(tisch, { vorlauf_stufe4: 45 })).toThrow(
        'Keine Einstellung angegeben.'
      )
      expect(() => tischFelder(tisch, { schwelle: 5 })).toThrow()
    }
  })

  it('gibt ihnen kein Auto-Publish — der Lauf schreibt Entwuerfe, publiziert wird von Hand', () => {
    expect(() =>
      tischFelder('wochenblatt', { auto_publizieren: true })
    ).toThrow()
    expect(() => tischFelder('smd', { auto_publizieren: true })).toThrow()
  })
})

describe('Inventar — die Stufe je Kandidat', () => {
  const kandidat = (ueber: Record<string, unknown> = {}) => ({
    titel: 'Die Schmiede schliesst',
    seite: 3,
    typ: 'reportage',
    gemeinde: 'Aesch',
    frontseite: false,
    warum_exklusiv: 'Nur das Blatt war dort.',
    zusammenfassung: 'Nach 80 Jahren schliesst die Schmiede.',
    perle_vorschlag: false,
    perle_begruendung: null,
    empfehlung: null,
    empfehlung_regel: null,
    zeitbezug: 'keiner',
    anlass_am: null,
    ...ueber
  })

  it('verlangt die Stufe im Schema und erklaert sie im Prompt', () => {
    const k = INVENTAR_SCHEMA.properties.kandidaten.items
    expect(k.required).toContain('stufe')
    expect(k.properties.stufe.enum).toEqual([1, 2, 3, 4])
    expect(INVENTAR_SYSTEM_PROMPT).toContain('"stufe", 1 bis 4')
  })

  it('liest die Stufe — und laesst sie leer, wo die Antwort keine brauchbare traegt', () => {
    const inventar = parseInventar(
      {
        kandidaten: [
          kandidat({ stufe: 4 }),
          kandidat({ titel: 'Turnerabend', stufe: 7 }),
          kandidat({ titel: 'Jubilar' })
        ],
        recherchehinweise: [],
        hinweise: []
      },
      8,
      ['Aesch']
    )
    expect(inventar.kandidaten.map((k) => k.stufe)).toEqual([4, null, null])
  })
})

describe('formulierbare — die Auswahl des Laufs', () => {
  const k = (id: string, wert: number | null, ueber: Query = {}) => ({
    id,
    entscheid: 'offen',
    zeitbezug: 'keiner',
    anlass_am: null,
    zusammenfassung: 'Fakten.',
    vorschlag_wert: wert,
    ...ueber
  })
  const alle = [k('a', 2), k('b', 3), k('c', null), k('d', 4), k('e', 3)]

  it('nimmt ab der Schwelle, die hoechste Stufe zuerst, Unbenotetes nie', () => {
    const { dran } = formulierbare(alle, new Set(), '2026-11-22', 20, 3)
    expect(dran.map((x) => x.id)).toEqual(['d', 'b', 'e'])
  })

  it('deckelt und nennt den Rest', () => {
    const r = formulierbare(alle, new Set(), '2026-11-22', 2, 3)
    expect(r.dran.map((x) => x.id)).toEqual(['d', 'b'])
    expect(r.wartend).toBe(1)
  })

  it('laesst dem Knopf, was der Lauf nicht schrieb: Tieferes und Unbenotetes', () => {
    const { dran } = formulierbare(alle, new Set(['d', 'b', 'e']), '2026-11-22')
    expect(dran.map((x) => x.id)).toEqual(['a', 'c'])
  })

  it('schreibt auch ab der Schwelle nichts zu Entschiedenem oder zu vergangenen Vorschauen', () => {
    const { dran } = formulierbare(
      [
        k('a', 4, { entscheid: 'weitergereicht' }),
        k('b', 4, { zeitbezug: 'vorschau', anlass_am: '2026-11-20' }),
        k('c', 3)
      ],
      new Set(),
      '2026-11-22',
      20,
      3
    )
    expect(dran.map((x) => x.id)).toEqual(['c'])
  })
})

describe('formulierAuswahl — die neueste Ausgabe jedes Blatts', () => {
  it('liest je Blatt nur die neueste Ausgabe und wendet die Schwelle an', async () => {
    const gefragt: Query[] = []
    const dienste = {
      blaetter: { readByQuery: async () => [{ id: 'b-1' }, { id: 'b-2' }] },
      ausgaben: {
        readByQuery: async (q: Query) => {
          gefragt.push(q)
          const blatt = (q['filter'] as { wochenblatt: { _eq: string } })
            .wochenblatt._eq
          return blatt === 'b-1' ? [{ id: 'a-neu' }] : []
        }
      },
      kandidaten: {
        readByQuery: async () => [
          {
            id: 'k-1',
            titel: 'Hoch',
            entscheid: 'offen',
            zeitbezug: null,
            anlass_am: null,
            zusammenfassung: 'Fakten.',
            vorschlag_wert: 4
          },
          {
            id: 'k-2',
            titel: 'Tief',
            entscheid: 'offen',
            zeitbezug: null,
            anlass_am: null,
            zusammenfassung: 'Fakten.',
            vorschlag_wert: 2
          },
          {
            id: 'k-3',
            titel: 'Schon beschrieben',
            entscheid: 'offen',
            zeitbezug: null,
            anlass_am: null,
            zusammenfassung: 'Fakten.',
            vorschlag_wert: 4
          }
        ]
      },
      meldungen: { readByQuery: async () => [{ kandidat: 'k-3' }] }
    }
    const lauf = await formulierAuswahl(dienste, {
      heute: '2026-11-22',
      abStufe: 3
    })
    expect(lauf.dran.map((k) => k.id)).toEqual(['k-1'])
    expect(gefragt[0]).toMatchObject({ sort: ['-datum'], limit: 1 })

    const knopf = await formulierAuswahl(dienste, { heute: '2026-11-22' })
    expect(knopf.dran.map((k) => k.id)).toEqual(['k-1', 'k-2'])
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

describe('SMD-Sichtung — benotet statt ja/nein', () => {
  const neue: ZeileFuerSmdSichtung[] = [
    {
      id: 's-1',
      titel: 'Aesch streitet um den Dorfplatz',
      lead: 'Der Gemeinderat will den Platz umbauen.',
      text: 'In Aesch regt sich Widerstand.',
      datum: '2026-11-21',
      medium: 'bzbasel.ch',
      blog: null,
      gemeinden_genannt: ['Aesch'],
      text_abgeschnitten: false
    },
    {
      id: 's-2',
      titel: 'Resultate vom Wochenende',
      lead: null,
      text: 'FC Aesch – FC Laufen 2:1.',
      datum: '2026-11-21',
      medium: 'bzbasel.ch',
      blog: null,
      gemeinden_genannt: ['Aesch'],
      text_abgeschnitten: false
    }
  ]

  function kontext(send: MessageSender, schwelle?: number) {
    const updates: Array<{ id: string; payload: Query }> = []
    const beitraege = {
      readByQuery: async () => [],
      createOne: async () => 'x',
      updateOne: async (id: string, payload: Query) => {
        updates.push({ id, payload })
        return id
      },
      updateMany: async () => [],
      deleteMany: async () => []
    }
    return {
      updates,
      k: {
        beitraege,
        hinweise: { readByQuery: async () => [], createOne: async () => 'h' },
        meldungen: { readByQuery: async () => [] },
        regelzeilen: [],
        sichtungsregeln: regelnBlock([], SICHTUNGSREGELN_UEBERSCHRIFT),
        heute: '2026-11-22',
        logger: STILL,
        ...(schwelle === undefined ? {} : { schwelle }),
        send
      }
    }
  }

  const antwort = JSON.stringify({
    urteile: [
      {
        nummer: 1,
        stufe: 3,
        begruendung: 'Konflikt im Dorf.',
        empfehlung: null,
        empfehlung_regel: null
      },
      {
        nummer: 2,
        stufe: 1,
        begruendung: 'Ein Name in einer Liste.',
        empfehlung: null,
        empfehlung_regel: null
      }
    ]
  })

  it('fragt nach Stufen', () => {
    expect(SMD_SICHTUNG_SYSTEM_PROMPT).toContain('"stufe": 3')
    expect(SMD_SICHTUNG_SYSTEM_PROMPT).not.toContain('Im Zweifel: nein')
    expect(
      SICHTUNG_SCHEMA.properties.urteile.items.properties.stufe.enum
    ).toEqual([1, 2, 3, 4])
  })

  it('speichert die Stufe und macht ab der Schwelle einen Vorschlag daraus', async () => {
    const send = vi.fn(async () =>
      claudeMessage(antwort)
    ) as unknown as MessageSender
    const { k, updates } = kontext(send)
    const r = await sichteSmdBeitraege(neue, { id: 'g', name: 'Aesch' }, k)
    expect(r).toMatchObject({ vorschlaege: 1, fehler: null })
    expect(updates).toEqual([
      {
        id: 's-1',
        payload: {
          vorschlag: true,
          vorschlag_wert: 3,
          vorschlag_begruendung: 'Konflikt im Dorf.'
        }
      },
      {
        id: 's-2',
        payload: {
          vorschlag: false,
          vorschlag_wert: 1,
          vorschlag_begruendung: 'Ein Name in einer Liste.'
        }
      }
    ])
  })

  it('folgt der Schwelle des Tischs: bei 4 ist eine Stufe 3 kein Vorschlag', async () => {
    const send = vi.fn(async () =>
      claudeMessage(antwort)
    ) as unknown as MessageSender
    const { k, updates } = kontext(send, 4)
    const r = await sichteSmdBeitraege(neue, { id: 'g', name: 'Aesch' }, k)
    expect(r.vorschlaege).toBe(0)
    expect(updates[0]?.payload).toMatchObject({
      vorschlag: false,
      vorschlag_wert: 3
    })
  })
})

describe('gleicheSmdSchwelleAb', () => {
  it('wendet die Schwelle auf benotete offene Zeilen an und laesst Passendes in Ruhe', async () => {
    const updates: Array<{ id: string; payload: Query }> = []
    let filter: Query = {}
    const dienst = {
      readByQuery: async (q: Query) => {
        filter = q['filter'] as Query
        return [
          { id: 'hoch', vorschlag: true, vorschlag_wert: 3 },
          { id: 'rauf', vorschlag: false, vorschlag_wert: 2 },
          { id: 'tief', vorschlag: false, vorschlag_wert: 1 }
        ]
      },
      createOne: async () => 'x',
      updateOne: async (id: string, payload: Query) => {
        updates.push({ id, payload })
        return id
      },
      updateMany: async () => [],
      deleteMany: async () => []
    }
    expect(await gleicheSmdSchwelleAb(dienst, 2, STILL)).toBe(1)
    expect(updates).toEqual([{ id: 'rauf', payload: { vorschlag: true } }])
    // Ungraded rows (read before 22.11.2026) keep their bit: never asked for.
    expect(filter).toMatchObject({
      entscheid: { _eq: 'offen' },
      vorschlag_wert: { _nnull: true }
    })
  })
})
