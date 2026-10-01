import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  cacheableSystem,
  ClaudeFormatError,
  ClaudeTruncatedError,
  completeChat,
  completeJson,
  completeText,
  extractJson,
  joinTextBlocks,
  registriereEinstellungen,
  registriereVerbrauch,
  thinkingFuer,
  tischVon,
  verbrauchAus,
  type MessageSender,
  type Modellaufruf
} from './claude'

function message(
  text: string,
  stopReason: Anthropic.Message['stop_reason'] = 'end_turn'
): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 }
  } as unknown as Anthropic.Message
}

describe('joinTextBlocks', () => {
  it('keeps text blocks and ignores everything else', () => {
    const mixed = {
      ...message('erster'),
      content: [
        { type: 'thinking', thinking: 'nicht sichtbar' },
        { type: 'text', text: 'erster' },
        { type: 'tool_use', id: 't1', name: 'x', input: {} },
        { type: 'text', text: 'zweiter' }
      ]
    } as unknown as Anthropic.Message

    expect(joinTextBlocks(mixed)).toBe('erster\nzweiter')
  })
})

describe('completeText', () => {
  it('sends model, max_tokens and system through to the API', async () => {
    const send = vi.fn<MessageSender>().mockResolvedValue(message('fertig'))

    const answer = await completeText(
      { prompt: 'frage', system: 'sei kurz', maxTokens: 128 },
      send
    )

    expect(answer).toBe('fertig')
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 128,
        system: 'sei kurz',
        messages: [{ role: 'user', content: 'frage' }]
      })
    )
  })

  // temperature, top_p and top_k are rejected with a 400 on the current models,
  // so the wrapper must never grow a way to send them.
  it('never sends sampling parameters', async () => {
    const send = vi.fn<MessageSender>().mockResolvedValue(message('ok'))

    await completeText({ prompt: 'frage' }, send)

    const body = send.mock.calls[0]?.[0]
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('top_k')
  })

  it('omits thinking and output_config unless they were asked for', async () => {
    const send = vi.fn<MessageSender>().mockResolvedValue(message('ok'))

    await completeText({ prompt: 'frage' }, send)

    const body = send.mock.calls[0]?.[0]
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('output_config')
  })

  it('passes thinking and effort through', async () => {
    const send = vi.fn<MessageSender>().mockResolvedValue(message('ok'))

    await completeText(
      { prompt: 'frage', thinking: 'disabled', effort: 'low' },
      send
    )

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' }
      })
    )
  })

  it('forwards a block system prompt unchanged, cache marker included', async () => {
    const send = vi.fn<MessageSender>().mockResolvedValue(message('ok'))
    const system = cacheableSystem('geteilte Regeln')

    await completeText({ prompt: 'frage', system }, send)

    expect(send.mock.calls[0]?.[0]?.system).toEqual([
      {
        type: 'text',
        text: 'geteilte Regeln',
        cache_control: { type: 'ephemeral' }
      }
    ])
  })

  it('throws instead of returning a truncated answer', async () => {
    const send = vi
      .fn<MessageSender>()
      .mockResolvedValue(message('{"summary": "halb', 'max_tokens'))

    await expect(
      completeText({ prompt: 'frage', maxTokens: 16 }, send)
    ).rejects.toBeInstanceOf(ClaudeTruncatedError)
  })
})

describe('completeChat', () => {
  it('sends the turn history as given', async () => {
    const send = vi.fn<MessageSender>().mockResolvedValue(message('antwort'))
    const messages = [
      { role: 'user' as const, content: 'kuerzer bitte' },
      { role: 'assistant' as const, content: 'gekuerzt' },
      { role: 'user' as const, content: 'und ohne Zahlen' }
    ]

    const answer = await completeChat({ messages, system: 'Regeln' }, send)

    expect(answer).toBe('antwort')
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ messages, system: 'Regeln' })
    )
  })

  it('treats a truncated answer as an error here too', async () => {
    const send = vi
      .fn<MessageSender>()
      .mockResolvedValue(message('halb', 'max_tokens'))

    await expect(
      completeChat(
        { messages: [{ role: 'user', content: 'frage' }], maxTokens: 16 },
        send
      )
    ).rejects.toBeInstanceOf(ClaudeTruncatedError)
  })
})

describe('extractJson', () => {
  it('accepts bare JSON', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}')
  })

  it('strips a fenced code block', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('strips prose around the JSON', () => {
    expect(extractJson('Gerne! {"a":1} Passt das?')).toBe('{"a":1}')
  })

  it('handles arrays', () => {
    expect(extractJson('[1, 2]')).toBe('[1, 2]')
  })

  it('rejects an answer without JSON', () => {
    expect(() => extractJson('Dazu kann ich nichts sagen.')).toThrow(
      ClaudeFormatError
    )
  })
})

describe('completeJson', () => {
  it('parses a fenced object answer', async () => {
    const send = vi
      .fn<MessageSender>()
      .mockResolvedValue(
        message('```json\n{"summary":"kurz","tags":["a"]}\n```')
      )

    await expect(completeJson({ prompt: 'frage' }, send)).resolves.toEqual({
      summary: 'kurz',
      tags: ['a']
    })
  })

  it('reports unparseable JSON as a format error', async () => {
    const send = vi
      .fn<MessageSender>()
      .mockResolvedValue(message('{"summary": "kurz",}'))

    await expect(
      completeJson({ prompt: 'frage' }, send)
    ).rejects.toBeInstanceOf(ClaudeFormatError)
  })
})

// Seit 30.09.2026 zeichnet der Client jeden Aufruf auf — was die Antwort
// gekostet hat, unter welchem Zweck, und ob sie abgebrochen wurde oder der
// Aufruf scheiterte. Ohne registrierten Schreiber bleibt alles still.
describe('Verbrauch', () => {
  it('meldet Zweck, Modell und Tokens einer vollstaendigen Antwort', async () => {
    const eintraege: Modellaufruf[] = []
    registriereVerbrauch(async (e) => {
      eintraege.push(e)
    })
    try {
      const sender = vi.fn<MessageSender>().mockResolvedValue({
        ...message('{"ok": true}'),
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 0
        }
      } as unknown as Anthropic.Message)
      await completeJson(
        { prompt: 'x', zweck: 'veranstaltungen:sichtung' },
        sender
      )
      await new Promise((r) => setTimeout(r, 0))
      expect(eintraege).toHaveLength(1)
      expect(eintraege[0]).toMatchObject({
        zweck: 'veranstaltungen:sichtung',
        modell: 'claude-sonnet-5',
        eingabe_tokens: 120,
        ausgabe_tokens: 30,
        cache_gelesen_tokens: 1000,
        cache_geschrieben_tokens: 0,
        abgebrochen: false,
        fehler: null
      })
    } finally {
      registriereVerbrauch(null)
    }
  })

  it('zaehlt eine abgebrochene Antwort und einen gescheiterten Aufruf — und wirft trotzdem', async () => {
    const eintraege: Modellaufruf[] = []
    registriereVerbrauch(async (e) => {
      eintraege.push(e)
    })
    try {
      const abgebrochen = vi
        .fn<MessageSender>()
        .mockResolvedValue(message('{"halb', 'max_tokens'))
      await expect(
        completeText({ prompt: 'x', maxTokens: 50 }, abgebrochen)
      ).rejects.toThrow(ClaudeTruncatedError)
      const kaputt = vi
        .fn<MessageSender>()
        .mockRejectedValue(new Error('overloaded'))
      await expect(
        completeText({ prompt: 'x', zweck: 'lernen:wissen' }, kaputt)
      ).rejects.toThrow('overloaded')
      await new Promise((r) => setTimeout(r, 0))
      expect(eintraege.map((e) => [e.zweck, e.abgebrochen, e.fehler])).toEqual([
        ['unbekannt', true, null],
        ['lernen:wissen', false, 'overloaded']
      ])
    } finally {
      registriereVerbrauch(null)
    }
  })

  it('ein Schreiber, der scheitert, kostet den Aufruf nichts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registriereVerbrauch(async () => {
      throw new Error('Datenbank weg')
    })
    try {
      const sender = vi.fn<MessageSender>().mockResolvedValue(message('ok'))
      await expect(completeText({ prompt: 'x' }, sender)).resolves.toBe('ok')
      await new Promise((r) => setTimeout(r, 0))
      expect(warn).toHaveBeenCalled()
    } finally {
      registriereVerbrauch(null)
      warn.mockRestore()
    }
  })

  it('tischVon nimmt den Teil vor dem Doppelpunkt, verbrauchAus nullt Fehlendes', () => {
    expect(tischVon('amtsblatt:meldung:nachfassen')).toBe('amtsblatt')
    expect(tischVon('unbekannt')).toBe('unbekannt')
    expect(verbrauchAus(null)).toEqual({
      eingabe_tokens: 0,
      ausgabe_tokens: 0,
      cache_gelesen_tokens: 0,
      cache_geschrieben_tokens: 0
    })
    expect(verbrauchAus({ input_tokens: 5 })).toMatchObject({
      eingabe_tokens: 5,
      ausgabe_tokens: 0
    })
  })
})

// Seit 1.10.2026 stellt die Redaktion Modell und Etat je Zweck ein; der
// Client wendet es bei jedem Aufruf an und uebersetzt den Thinking-Modus, den
// das gewaehlte Modell braucht (gemessen an der Aufruf-Form des Hauses).
describe('Einstellungen je Zweck', () => {
  it('die Einstellung schlaegt Aufrufstelle und Umgebung, der Rest bleibt', async () => {
    registriereEinstellungen(async (zweck) =>
      zweck === 'amtsblatt:sichtung'
        ? { modell: 'claude-haiku-4-5-20251001', max_tokens: 3000 }
        : null
    )
    try {
      const sender = vi
        .fn<MessageSender>()
        .mockResolvedValue(message('{"ok": true}'))
      await completeJson(
        {
          prompt: 'x',
          zweck: 'amtsblatt:sichtung',
          model: 'claude-sonnet-5',
          maxTokens: 4000,
          thinking: 'disabled'
        },
        sender
      )
      const anfrage = sender.mock.calls[0]?.[0]
      expect(anfrage?.model).toBe('claude-haiku-4-5-20251001')
      expect(anfrage?.max_tokens).toBe(3000)
      expect(anfrage?.thinking).toEqual({ type: 'disabled' })
      await completeJson(
        {
          prompt: 'x',
          zweck: 'kanton:sichtung',
          model: 'claude-sonnet-5',
          maxTokens: 4000
        },
        sender
      )
      expect(sender.mock.calls[1]?.[0]?.model).toBe('claude-sonnet-5')
      expect(sender.mock.calls[1]?.[0]?.max_tokens).toBe(4000)
    } finally {
      registriereEinstellungen(null)
    }
  })

  it('ein Leser, der scheitert, kostet den Aufruf nichts', async () => {
    registriereEinstellungen(async () => {
      throw new Error('Datenbank weg')
    })
    try {
      const sender = vi.fn<MessageSender>().mockResolvedValue(message('ok'))
      await expect(
        completeText(
          { prompt: 'x', zweck: 'kanton:sichtung', maxTokens: 500 },
          sender
        )
      ).resolves.toBe('ok')
      expect(sender.mock.calls[0]?.[0]?.max_tokens).toBe(500)
    } finally {
      registriereEinstellungen(null)
    }
  })

  it('uebersetzt „Thinking aus" in die Form, die das Modell annimmt', () => {
    expect(thinkingFuer('claude-sonnet-5', 'disabled', undefined)).toEqual({
      thinking: 'disabled'
    })
    expect(
      thinkingFuer('claude-haiku-4-5-20251001', 'disabled', undefined)
    ).toEqual({ thinking: 'disabled' })
    expect(thinkingFuer('claude-sonnet-5-5', 'disabled', undefined)).toEqual({
      thinking: 'between_tools'
    })
    expect(thinkingFuer('claude-opus-5-5', 'disabled', undefined)).toEqual({
      effort: 'low'
    })
    expect(thinkingFuer('claude-opus-5-5', 'disabled', 'medium')).toEqual({
      effort: 'medium'
    })
    expect(thinkingFuer('claude-opus-5-5', undefined, undefined)).toEqual({})
    expect(thinkingFuer('claude-sonnet-5', 'adaptive', 'high')).toEqual({
      thinking: 'adaptive',
      effort: 'high'
    })
  })

  it('schreibt den Etat in den Verbrauch', async () => {
    const eintraege: Modellaufruf[] = []
    registriereVerbrauch(async (e) => {
      eintraege.push(e)
    })
    try {
      const sender = vi.fn<MessageSender>().mockResolvedValue(message('ok'))
      await completeText({ prompt: 'x', maxTokens: 777 }, sender)
      await new Promise((r) => setTimeout(r, 0))
      expect(eintraege[0]?.max_tokens).toBe(777)
    } finally {
      registriereVerbrauch(null)
    }
  })
})
