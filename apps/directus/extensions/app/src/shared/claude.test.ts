import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  ClaudeFormatError,
  ClaudeTruncatedError,
  completeJson,
  completeText,
  extractJson,
  joinTextBlocks,
  type MessageSender
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

  it('omits temperature when it was not requested', async () => {
    const send = vi.fn<MessageSender>().mockResolvedValue(message('ok'))

    await completeText({ prompt: 'frage' }, send)

    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('temperature')
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
