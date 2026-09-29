import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { MessageSender } from '../shared/claude'
import { parseDetail } from '../shared/kanton/api'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RegelZeile } from './gedaechtnis'
import {
  raeumeKantonsmitteilungenAuf,
  sichteKantonsmitteilungen,
  zeilenAus,
  type ZeileFuerKantonSichtung
} from './kantonlauf'
import { regelnBlock, SICHTUNGSREGELN_UEBERSCHRIFT } from './lernen'

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      join(__dirname, '..', 'shared', 'kanton', 'fixtures', name),
      'utf8'
    )
  )

const STILL = { info: () => undefined, warn: () => undefined }
type Query = Record<string, unknown>

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

function dienst(antwort: (q: Query) => unknown[] = () => []) {
  const updates: Array<{ id: string; payload: Query }> = []
  const geloescht: string[][] = []
  const verfallen: string[][] = []
  return {
    updates,
    geloescht,
    verfallen,
    d: {
      readByQuery: async (q: Query) => antwort(q),
      updateOne: async (id: string, payload: Query) => {
        updates.push({ id, payload })
        return id
      },
      updateMany: async (ids: string[], payload: Query) => {
        if (payload['entscheid'] === 'verfallen') verfallen.push(ids)
        return ids
      },
      deleteMany: async (ids: string[]) => {
        geloescht.push(ids)
        return ids
      }
    }
  }
}

describe('zeilenAus — eine Zeile je genannter Gemeinde', () => {
  const liste = {
    kennung: 'medienmitteilung' as const,
    pfad: '/startseite/ftw-news-newslistingblock',
    name: 'Kanton Basel-Landschaft'
  }
  const item = {
    id: 'https://bl-api.webcloud7.ch/politik-und-behorden/direktionen/sicherheitsdirektion/medienmitteilungen/tempo-30-antraegen-in-muenchenstein-und-birsfelden-wird-teilweise-zugestimmt',
    titel: 'Tempo 30',
    teaser: null,
    effective: '2026-09-02T08:00:00+00:00'
  }

  it('baut je Gemeinde eine Zeile mit derselben oeffentlichen Seite', () => {
    const detail = parseDetail(fixture('medienmitteilung-tempo30.json'))
    const zeilen = zeilenAus({
      item,
      detail,
      liste,
      getroffene: [
        { id: 'g-m', name: 'Münchenstein' },
        { id: 'g-b', name: 'Bottmingen' }
      ],
      seite: 'https://www.baselland.ch',
      heute: { jahr: 2026, monat: 9, tag: 29 },
      gelesenAm: '2026-09-29T12:00:00.000Z'
    })
    expect(zeilen).toHaveLength(2)
    expect(zeilen.map((z) => z.gemeinde)).toEqual(['g-m', 'g-b'])
    expect(new Set(zeilen.map((z) => z.url)).size).toBe(1)
    expect(zeilen[0]?.url).toBe(
      'https://www.baselland.ch/politik-und-behorden/direktionen/sicherheitsdirektion/medienmitteilungen/tempo-30-antraegen-in-muenchenstein-und-birsfelden-wird-teilweise-zugestimmt'
    )
    expect(zeilen[0]).toMatchObject({
      quelle: 'medienmitteilung',
      behoerde: 'Sicherheitsdirektion',
      publiziert_am: '2026-09-02',
      gemeinden_genannt: ['Münchenstein', 'Bottmingen'],
      entscheid: 'offen',
      hinweise: null
    })
  })

  it('sagt auf der Zeile, woher das Datum kam, und laesst ohne Gemeinde nichts entstehen', () => {
    const detail = {
      ...parseDetail(fixture('medienmitteilung-tempo30.json')),
      newsDate: '1969-12-30T22:00:00'
    }
    const [zeile] = zeilenAus({
      item,
      detail,
      liste,
      getroffene: [{ id: 'g-m', name: 'Münchenstein' }],
      seite: 'https://www.baselland.ch',
      heute: { jahr: 2026, monat: 9, tag: 29 },
      gelesenAm: 'x'
    })
    expect(zeile?.publiziert_am).toBe('2026-09-02')
    expect(zeile?.hinweise).toEqual([
      'Datum aus dem Publikationszeitpunkt der Liste abgeleitet'
    ])
    expect(
      zeilenAus({
        item,
        detail,
        liste,
        getroffene: [],
        seite: 'https://www.baselland.ch',
        heute: { jahr: 2026, monat: 9, tag: 29 },
        gelesenAm: 'x'
      })
    ).toEqual([])
  })
})

describe('raeumeKantonsmitteilungenAuf', () => {
  it('loescht altes Unvorgeschlagenes, laesst alte Vorschlaege verfallen, schont das Fenster', async () => {
    const { d, geloescht, verfallen } = dienst(() => [
      {
        id: 'alt',
        entscheid: 'offen',
        vorschlag: null,
        publiziert_am: '2026-09-10',
        date_created: null
      },
      {
        id: 'vorschlag',
        entscheid: 'offen',
        vorschlag: true,
        publiziert_am: '2026-09-01',
        date_created: null
      },
      {
        id: 'frisch',
        entscheid: 'offen',
        vorschlag: null,
        publiziert_am: '2026-09-28',
        date_created: null
      }
    ])
    const r = await raeumeKantonsmitteilungenAuf(d, '2026-09-29', 4, STILL)
    expect(r).toEqual({ geloescht: 1, verfallen: 1 })
    expect(geloescht).toEqual([['alt']])
    expect(verfallen).toEqual([['vorschlag']])
  })
})

describe('sichteKantonsmitteilungen', () => {
  const neue: ZeileFuerKantonSichtung[] = [
    {
      id: 'k-1',
      titel:
        'Tempo-30-Anträgen in Münchenstein und Birsfelden wird teilweise zugestimmt',
      teaser: null,
      text: 'Die Anträge werden teilweise gutgeheissen.',
      publiziert_am: '2026-09-02',
      quelle: 'medienmitteilung',
      behoerde: 'Sicherheitsdirektion',
      gemeinden_genannt: ['Münchenstein'],
      text_abgeschnitten: false
    },
    {
      id: 'k-2',
      titel: 'Brand in Einstellhalle',
      teaser: 'In Allschwil brannte es.',
      text: 'Niemand wurde verletzt.',
      publiziert_am: '2026-09-22',
      quelle: 'polizeimeldung',
      behoerde: 'Polizei Basel-Landschaft',
      gemeinden_genannt: ['Allschwil', 'Münchenstein'],
      text_abgeschnitten: false
    }
  ]
  const regelzeilen: RegelZeile[] = [
    {
      id: 'r-1',
      regel: 'Tempo-30-Entscheide gehen an die Chefredaktion.',
      bereich: 'kanton',
      stufe: 'sichtung',
      wirkung: 'weiterreichen'
    }
  ]
  const sichtungsregeln = regelnBlock(regelzeilen, SICHTUNGSREGELN_UEBERSCHRIFT)
  const gemeinde = { id: 'g-m', name: 'Münchenstein' }

  function kontext(send: MessageSender) {
    const { d, updates } = dienst((q) => {
      const felder = (q['fields'] ?? []) as string[]
      if (felder.includes('gemeinde.id'))
        return [
          {
            ...neue[0],
            url: 'https://www.baselland.ch/x',
            vorschlag_begruendung: 'Entscheid.',
            gemeinde: { id: 'g-m' }
          }
        ]
      return []
    })
    const hinweise = {
      readByQuery: async () => [],
      createOne: vi.fn(async (_payload: Record<string, unknown>) => 'h-1')
    }
    return {
      updates,
      hinweise,
      k: {
        mitteilungen: d,
        hinweise,
        meldungen: { readByQuery: async () => [] },
        regelzeilen,
        sichtungsregeln,
        heute: '2026-09-29',
        logger: STILL,
        send
      }
    }
  }

  it('schreibt je Zeile das Urteil, nennt die weiteren Gemeinden im Prompt und reicht nach Regel weiter', async () => {
    const send = vi.fn(
      async (params: { messages: Array<{ content: unknown }> }) => {
        const prompt = String(params.messages[0]?.content)
        expect(prompt).toContain(
          '(nennt auch Allschwil — beurteile nur den Bezug zu Münchenstein)'
        )
        expect(prompt).toContain(
          '[Polizeimeldung · Polizei Basel-Landschaft · 22. September 2026]'
        )
        return claudeMessage(
          JSON.stringify({
            urteile: [
              {
                nummer: 1,
                vorschlag: true,
                begruendung: 'Trifft die Hauptstrasse.',
                empfehlung: 'weiterreichen',
                empfehlung_regel: 'R1'
              },
              {
                nummer: 2,
                vorschlag: false,
                begruendung: 'Nur beilaeufig genannt.',
                empfehlung: null,
                empfehlung_regel: null
              }
            ]
          })
        )
      }
    ) as unknown as MessageSender
    const { k, updates, hinweise } = kontext(send)
    const r = await sichteKantonsmitteilungen(neue, gemeinde, k)
    expect(r).toEqual({ vorschlaege: 1, weitergereicht: 1, fehler: null })
    expect(updates.find((u) => u.id === 'k-1')?.payload).toEqual({
      vorschlag: true,
      vorschlag_begruendung: 'Trifft die Hauptstrasse.'
    })
    expect(updates.find((u) => u.id === 'k-2')?.payload).toEqual({
      vorschlag: false,
      vorschlag_begruendung: 'Nur beilaeufig genannt.'
    })
    expect(hinweise.createOne).toHaveBeenCalledTimes(1)
    const hinweis = hinweise.createOne.mock.calls[0]?.[0] ?? {}
    expect(hinweis['kantonsmitteilung']).toBe('k-1')
    expect(hinweis['fundort']).toContain(
      'Medienmitteilung des Kantons Basel-Landschaft vom 2. September 2026 (Sicherheitsdirektion)'
    )
  })

  it('laesst bei einer kaputten Antwort jedes Urteil auf null und sagt es', async () => {
    const send = vi.fn(async () =>
      claudeMessage('{"urteile": "kaputt"}')
    ) as unknown as MessageSender
    const { k, updates } = kontext(send)
    const r = await sichteKantonsmitteilungen(neue, gemeinde, k)
    expect(r.vorschlaege).toBe(0)
    expect(r.fehler).not.toBeNull()
    expect(updates).toEqual([])
  })

  it('kostet ohne neue Zeilen keinen Aufruf', async () => {
    const send = vi.fn() as unknown as MessageSender
    const { k } = kontext(send)
    expect(await sichteKantonsmitteilungen([], gemeinde, k)).toEqual({
      vorschlaege: 0,
      weitergereicht: 0,
      fehler: null
    })
    expect(send).not.toHaveBeenCalled()
  })
})
