import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { MessageSender } from '../shared/claude'
import {
  ladeRegeln,
  lerneAusEntscheid,
  merkeWissenAus,
  pausiereAutomatikWennNoetig
} from './gedaechtnis'

type Query = Record<string, unknown>

function dienst(antwort: unknown[]) {
  const aufrufe: Query[] = []
  return {
    aufrufe,
    readByQuery: async (query: Query) => {
      aufrufe.push(query)
      return antwort
    }
  }
}

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

describe('ladeRegeln', () => {
  it('fragt fuer einen Tisch nach Bereich und Stufe — ohne Datensatz-Scope', async () => {
    const wissen = dienst([
      {
        id: 'r1',
        regel: 'Keine Vereinsjubilaeen.',
        bereich: 'presseschau',
        stufe: 'sichtung',
        wirkung: 'hinweis'
      }
    ])
    const regeln = await ladeRegeln(
      wissen,
      { bereich: 'presseschau', stufe: 'sichtung' },
      STILL
    )

    expect(regeln.map((r) => r.regel)).toEqual(['Keine Vereinsjubilaeen.'])
    expect(wissen.aufrufe[0]?.['filter']).toEqual({
      aktiv: { _eq: true },
      bereich: { _eq: 'presseschau' },
      stufe: { _eq: 'sichtung' }
    })
    expect(wissen.aufrufe[0]?.['sort']).toEqual(['-date_created'])
  })

  // Only the statistics feed scopes rules to a dataset or portal — and only
  // its rules may reach the cached article prefix.
  it('haelt fuer die Statistik den Datensatz- und Quellen-Scope bei', async () => {
    const wissen = dienst([])
    await ladeRegeln(
      wissen,
      {
        bereich: 'statistik',
        stufe: 'text',
        scope: { datensatz: 'ds-1', quelle: 'q-1' }
      },
      STILL
    )

    expect(wissen.aufrufe[0]?.['filter']).toEqual({
      aktiv: { _eq: true },
      bereich: { _eq: 'statistik' },
      stufe: { _eq: 'text' },
      _or: [
        { geltungsbereich: { _eq: 'global' } },
        { datensatz: { _eq: 'ds-1' } },
        { quelle: { _eq: 'q-1' } }
      ]
    })
  })

  it('deckelt und sagt es — die neueste Regel gilt immer', async () => {
    const viele = Array.from({ length: 31 }, (_, i) => ({
      id: `r${i}`,
      regel: `Regel ${i}`,
      bereich: 'amtsblatt',
      stufe: 'sichtung',
      wirkung: 'hinweis'
    }))
    const warn = vi.fn()
    const regeln = await ladeRegeln(
      dienst(viele),
      { bereich: 'amtsblatt', stufe: 'sichtung' },
      { warn }
    )

    expect(regeln).toHaveLength(30)
    expect(regeln[0]?.regel).toBe('Regel 0')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('mehr als 30 aktive Regeln')
    )
  })
})

describe('merkeWissenAus', () => {
  it('speichert eine dauerhafte Desk-Regel global, mit Bereich und Beleg', async () => {
    const send = vi.fn<MessageSender>().mockResolvedValue(
      nachricht(
        JSON.stringify({
          dauerhaft: true,
          regel: 'Nenne nie den Architekten.',
          geltungsbereich: 'global'
        })
      )
    )
    const gespeichert: Record<string, unknown>[] = []
    const wissen = {
      createOne: async (p: Record<string, unknown>) => void gespeichert.push(p)
    }

    await merkeWissenAus(
      { wissen, logger: STILL },
      'Bitte den Architekten nicht mehr nennen.',
      { bereich: 'amtsblatt', titel: 'Amtsblatt-Meldung', erlaubt: ['global'] },
      send
    )

    expect(gespeichert).toHaveLength(1)
    expect(gespeichert[0]).toMatchObject({
      regel: 'Nenne nie den Architekten.',
      bereich: 'amtsblatt',
      stufe: 'text',
      wirkung: 'hinweis',
      geltungsbereich: 'global',
      herkunft: 'chat',
      beleg: 'Bitte den Architekten nicht mehr nennen.',
      datensatz: null,
      quelle: null
    })
    // Der Prompt sagt dem Modell, dass es hier keinen Datensatz gibt.
    const body = send.mock.calls[0]?.[0]
    const inhalt = JSON.stringify(body?.messages)
    expect(inhalt).toContain('Kontext: Amtsblatt-Meldung')
    expect(inhalt).toContain('ist immer')
  })

  it('speichert nichts bei einer einmaligen Anweisung', async () => {
    const send = vi.fn<MessageSender>().mockResolvedValue(
      nachricht(
        JSON.stringify({
          dauerhaft: false,
          regel: null,
          geltungsbereich: 'global'
        })
      )
    )
    const wissen = { createOne: vi.fn() }

    await merkeWissenAus(
      { wissen, logger: STILL },
      'Tippfehler im zweiten Satz.',
      { bereich: 'sendung', titel: 'Sendungs-Meldung', erlaubt: ['global'] },
      send
    )

    expect(wissen.createOne).not.toHaveBeenCalled()
  })

  it('schluckt einen Fehler — eine verlorene Regel kostet nie die Ueberarbeitung', async () => {
    const send = vi.fn<MessageSender>().mockRejectedValue(new Error('Netz weg'))
    const warn = vi.fn()

    await expect(
      merkeWissenAus(
        { wissen: { createOne: vi.fn() }, logger: { info: vi.fn(), warn } },
        'Kuerzer.',
        { bereich: 'sport', titel: 'Spielbericht', erlaubt: ['global'] },
        send
      )
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

describe('lerneAusEntscheid', () => {
  type Query = Record<string, unknown>
  const felderVon = (q: Query): string[] => (q['fields'] ?? []) as string[]

  function zeilenDienst(vorgaenger: string[]) {
    return {
      readByQuery: async (q: Query) =>
        felderVon(q).includes('typ')
          ? [
              {
                id: 'k-1',
                titel: 'Turnverein feiert 100 Jahre',
                typ: 'vereinsleben',
                zusammenfassung: 'Fest im Oktober.',
                warum_exklusiv: 'Nur hier.',
                ausgabe: {
                  wochenblatt: { id: 'b-1', name: 'Binninger Wochenblatt' }
                }
              }
            ]
          : vorgaenger.map((titel) => ({ titel }))
    }
  }
  function wissenDienst(regeln: unknown[]) {
    const angelegt: Record<string, unknown>[] = []
    const aktualisiert: Array<[string, Record<string, unknown>]> = []
    return {
      angelegt,
      aktualisiert,
      readByQuery: async (q: Query) =>
        felderVon(q).includes('beleg')
          ? [{ id: 'r-1', beleg: 'alter Beleg' }]
          : regeln,
      createOne: async (p: Record<string, unknown>) => void angelegt.push(p),
      updateOne: async (k: string, p: Record<string, unknown>) =>
        void aktualisiert.push([k, p])
    }
  }
  const leer = { readByQuery: async () => [] }
  const antwort = (json: Record<string, unknown>) =>
    vi.fn<MessageSender>().mockResolvedValue(nachricht(JSON.stringify(json)))

  it('legt aus einem kommentierten Entscheid eine Sichtungsregel an', async () => {
    const wissen = wissenDienst([])
    const send = antwort({
      urteil: 'neu',
      regel_nr: null,
      regel: 'Vereinsjubilaeen ohne besondere Zutaten nicht vorschlagen.',
      wirkung: 'hinweis'
    })

    await lerneAusEntscheid(
      { zeilen: zeilenDienst([]), hinweise: leer, wissen, logger: STILL, send },
      {
        tisch: 'presseschau',
        art: 'entscheid',
        zeileId: 'k-1',
        entscheid: 'abgelehnt',
        grund: 'nicht_relevant',
        kommentar: 'ohne Zutaten'
      }
    )

    expect(wissen.angelegt).toHaveLength(1)
    expect(wissen.angelegt[0]).toMatchObject({
      bereich: 'presseschau',
      stufe: 'sichtung',
      herkunft: 'kommentar',
      regel: 'Vereinsjubilaeen ohne besondere Zutaten nicht vorschlagen.'
    })
    // Der Prompt traegt den Fall und den Kommentar.
    const inhalt = JSON.stringify(send.mock.calls[0]?.[0]?.messages)
    expect(inhalt).toContain('Turnverein feiert 100 Jahre')
    expect(inhalt).toContain('ohne Zutaten')
  })

  it('ruft ohne Worte und ohne Wiederholung gar nicht erst an', async () => {
    const wissen = wissenDienst([])
    const send = antwort({
      urteil: 'neu',
      regel_nr: null,
      regel: 'x',
      wirkung: 'hinweis'
    })

    await lerneAusEntscheid(
      {
        zeilen: zeilenDienst(['Nur einer']),
        hinweise: leer,
        wissen,
        logger: STILL,
        send
      },
      {
        tisch: 'presseschau',
        art: 'entscheid',
        zeileId: 'k-1',
        entscheid: 'abgelehnt',
        grund: 'nicht_relevant',
        kommentar: null
      }
    )

    expect(send).not.toHaveBeenCalled()
    expect(wissen.angelegt).toHaveLength(0)
  })

  it('lernt aus einer Doublette nie — auch nicht mit Wiederholung', async () => {
    const send = antwort({
      urteil: 'neu',
      regel_nr: null,
      regel: 'x',
      wirkung: 'hinweis'
    })
    await lerneAusEntscheid(
      {
        zeilen: zeilenDienst(['a', 'b', 'c']),
        hinweise: leer,
        wissen: wissenDienst([]),
        logger: STILL,
        send
      },
      {
        tisch: 'presseschau',
        art: 'entscheid',
        zeileId: 'k-1',
        entscheid: 'abgelehnt',
        grund: 'doublette',
        kommentar: null
      }
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('ergaenzt bei "abgedeckt" den Beleg der zitierten Regel statt eine zweite anzulegen', async () => {
    const wissen = wissenDienst([
      {
        id: 'r-1',
        regel: 'Vereinsjubilaeen nicht vorschlagen.',
        bereich: 'presseschau',
        stufe: 'sichtung',
        wirkung: 'hinweis'
      }
    ])
    const send = antwort({
      urteil: 'abgedeckt',
      regel_nr: 'R1',
      regel: null,
      wirkung: 'hinweis'
    })

    await lerneAusEntscheid(
      {
        zeilen: zeilenDienst(['Frauenverein', 'Schuetzen']),
        hinweise: leer,
        wissen,
        logger: STILL,
        send
      },
      {
        tisch: 'presseschau',
        art: 'entscheid',
        zeileId: 'k-1',
        entscheid: 'abgelehnt',
        grund: 'nicht_relevant',
        kommentar: null
      }
    )

    expect(wissen.angelegt).toHaveLength(0)
    expect(wissen.aktualisiert).toHaveLength(1)
    expect(wissen.aktualisiert[0]?.[0]).toBe('r-1')
    expect(String(wissen.aktualisiert[0]?.[1]['beleg'])).toContain(
      'alter Beleg\n+ "Turnverein feiert 100 Jahre"'
    )
  })

  it('schluckt einen Fehler des Modells — der Entscheid ist laengst geschrieben', async () => {
    const warn = vi.fn()
    const send = vi.fn<MessageSender>().mockRejectedValue(new Error('Netz weg'))
    await expect(
      lerneAusEntscheid(
        {
          zeilen: zeilenDienst([]),
          hinweise: leer,
          wissen: wissenDienst([]),
          logger: { info: vi.fn(), warn },
          send
        },
        {
          tisch: 'presseschau',
          art: 'entscheid',
          zeileId: 'k-1',
          entscheid: 'abgelehnt',
          grund: 'nicht_relevant',
          kommentar: 'x'
        }
      )
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

describe('pausiereAutomatikWennNoetig', () => {
  function wissenMit(wirkung: string) {
    const aktualisiert: Array<[string, Record<string, unknown>]> = []
    return {
      aktualisiert,
      readByQuery: async () => [
        {
          id: 'r-1',
          regel: 'Leserbriefe an die Chefredaktion.',
          wirkung,
          beleg: 'alt'
        }
      ],
      updateOne: async (k: string, p: Record<string, unknown>) =>
        void aktualisiert.push([k, p])
    }
  }

  it('stellt die Regel nach zwei Rueckweisungen auf hinweis zurueck und sagt es im Beleg', async () => {
    const wissen = wissenMit('weiterreichen')
    const hinweise = {
      readByQuery: async () => [
        { status: 'kein_hinweis' },
        { status: 'zurueckgegeben' }
      ]
    }

    const pausiert = await pausiereAutomatikWennNoetig(
      { hinweise, wissen, logger: STILL },
      'r-1',
      '2026-09-13'
    )

    expect(pausiert).toBe(true)
    expect(wissen.aktualisiert[0]?.[0]).toBe('r-1')
    expect(wissen.aktualisiert[0]?.[1]).toMatchObject({ wirkung: 'hinweis' })
    expect(String(wissen.aktualisiert[0]?.[1]['beleg'])).toContain(
      'alt\nAutomatik pausiert am 13.09.2026'
    )
  })

  it('laesst die Regel nach einer Rueckweisung und nach einer Bestaetigung in Ruhe', async () => {
    const wissen = wissenMit('weiterreichen')
    expect(
      await pausiereAutomatikWennNoetig(
        {
          hinweise: { readByQuery: async () => [{ status: 'kein_hinweis' }] },
          wissen,
          logger: STILL
        },
        'r-1',
        '2026-09-13'
      )
    ).toBe(false)
    expect(
      await pausiereAutomatikWennNoetig(
        {
          hinweise: {
            readByQuery: async () => [
              { status: 'brauchbar' },
              { status: 'kein_hinweis' }
            ]
          },
          wissen,
          logger: STILL
        },
        'r-1',
        '2026-09-13'
      )
    ).toBe(false)
    expect(wissen.aktualisiert).toHaveLength(0)
  })
})
