import Anthropic from '@anthropic-ai/sdk'
import { optionalEnv, requireEnv } from './env'

// The single place where this application talks to a language model.
//
// This template runs on CPU-only hardware — there is no local model, no GPU,
// no inference container. Every LLM call goes to the Claude API over HTTPS via
// the official SDK. If you find yourself adding a second way to reach a model,
// put it here instead.

export const DEFAULT_MODEL = 'claude-sonnet-5'
export const DEFAULT_MAX_TOKENS = 4096

/**
 * The seam every call goes through. Handlers take a `MessageSender` so tests can
 * pass a stub and never touch the network.
 */
export type MessageSender = (
  body: Anthropic.MessageCreateParamsNonStreaming
) => Promise<Anthropic.Message>

let cached: Anthropic | undefined

export function getClaude(): Anthropic {
  if (!cached) {
    cached = new Anthropic({
      apiKey: requireEnv('ANTHROPIC_API_KEY'),
      maxRetries: 3
    })
  }
  return cached
}

export const sendToClaude: MessageSender = (body) =>
  getClaude().messages.create(body)

export interface ClaudeRequest {
  prompt: string
  system?: string
  /** Defaults to ANTHROPIC_MODEL, then DEFAULT_MODEL. */
  model?: string
  maxTokens?: number
  temperature?: number
}

/**
 * Thrown when the model hit `max_tokens` before finishing. Always an error, never
 * a partial result: a truncated answer looks like a valid one to the caller, and
 * truncated JSON is the classic way an LLM feature fails silently in production.
 */
export class ClaudeTruncatedError extends Error {
  constructor(readonly maxTokens: number) {
    super(
      `Claude stopped at max_tokens (${maxTokens}). Raise maxTokens or ask for a shorter answer.`
    )
    this.name = 'ClaudeTruncatedError'
  }
}

export class ClaudeFormatError extends Error {
  constructor(readonly raw: string) {
    super(
      `Claude did not return parseable JSON. Raw answer: ${raw.slice(0, 500)}`
    )
    this.name = 'ClaudeFormatError'
  }
}

export function joinTextBlocks(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

export async function completeText(
  request: ClaudeRequest,
  send: MessageSender = sendToClaude
): Promise<string> {
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS
  const message = await send({
    model: request.model ?? optionalEnv('ANTHROPIC_MODEL', DEFAULT_MODEL),
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: request.prompt }],
    ...(request.system === undefined ? {} : { system: request.system }),
    ...(request.temperature === undefined
      ? {}
      : { temperature: request.temperature })
  })

  if (message.stop_reason === 'max_tokens')
    throw new ClaudeTruncatedError(maxTokens)

  return joinTextBlocks(message)
}

/**
 * Pulls the JSON value out of an answer that may be fenced (```json … ```) or
 * wrapped in prose ("Sure, here you go: { … }"). Asking for JSON in the prompt
 * is not a guarantee; this is the guard.
 */
export function extractJson(raw: string): string {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim()

  const start = unfenced.search(/[[{]/)
  if (start === -1) throw new ClaudeFormatError(raw)

  const closing = unfenced[start] === '{' ? '}' : ']'
  const end = unfenced.lastIndexOf(closing)
  if (end <= start) throw new ClaudeFormatError(raw)

  return unfenced.slice(start, end + 1)
}

/**
 * Same as completeText, but parses the answer as JSON. `T` is a promise, not a
 * proof — validate the shape at the call site before writing it to a collection.
 */
export async function completeJson<T>(
  request: ClaudeRequest,
  send: MessageSender = sendToClaude
): Promise<T> {
  const raw = await completeText(request, send)
  const json = extractJson(raw)
  try {
    return JSON.parse(json) as T
  } catch {
    throw new ClaudeFormatError(raw)
  }
}
