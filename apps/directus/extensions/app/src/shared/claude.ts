import Anthropic from '@anthropic-ai/sdk'
import { optionalEnv, requireEnv } from './env'

// The single place where this application talks to a language model.
//
// This template runs on CPU-only hardware — there is no local model, no GPU,
// no inference container. Every LLM call goes to the Claude API over HTTPS via
// the official SDK. If you find yourself adding a second way to reach a model,
// put it here instead.
//
// Deliberately absent: `temperature`, `top_p` and `top_k`. On claude-sonnet-5
// and claude-opus-5 any non-default value is rejected with a 400. Steer the
// model with the prompt, not with sampling parameters.

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

/**
 * Above this budget the request streams under the hood.
 *
 * The SDK refuses a plain request whose `max_tokens` implies a run longer than
 * about ten minutes ("Streaming is required for operations that may take
 * longer…"), and a year's waste calendar legitimately needs such a budget —
 * the cap carries the model's thinking as well as the answer.
 * `finalMessage()` accumulates the stream into the same `Anthropic.Message` a
 * plain create returns, so callers cannot tell the difference.
 */
const STREAMEN_AB_TOKENS = 8192

export const sendToClaude: MessageSender = (body) =>
  body.max_tokens >= STREAMEN_AB_TOKENS
    ? getClaude().messages.stream(body).finalMessage()
    : getClaude().messages.create(body)

/** How much the model may deliberate. Defaults to `high` when unset. */
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ClaudeOptions {
  /**
   * A plain string, or blocks when a part of the prompt should be cached —
   * see `cacheableSystem`.
   */
  system?: string | Anthropic.TextBlockParam[]
  /** Defaults to ANTHROPIC_MODEL, then DEFAULT_MODEL. */
  model?: string
  /**
   * Caps thinking **and** answer text together. A model that thinks adaptively
   * can spend most of a small budget before writing a word, so size this for
   * both parts, not just the answer you expect.
   */
  maxTokens?: number
  /**
   * Omitted means adaptive on the current models. Pass `'disabled'` for cheap,
   * high-volume calls where the whole budget should go to the answer.
   *
   * On claude-opus-5, `'disabled'` is rejected above `effort: 'high'`.
   */
  thinking?: 'adaptive' | 'disabled'
  effort?: ClaudeEffort
  /**
   * A JSON Schema the answer must satisfy.
   *
   * Prefer this over hoping `extractJson` copes. German prose is full of the
   * characters that break a "first `{` to last `}`" heuristic — quotation
   * marks, dashes, newlines inside strings — and the failure is a whole
   * generated article lost to a parse error.
   *
   * It guarantees the answer is valid JSON of this shape. It guarantees nothing
   * about your business rules: length limits and value checks stay in the
   * parse function at the call site.
   */
  schema?: Record<string, unknown>
}

export interface ClaudeRequest extends ClaudeOptions {
  prompt: string
}

export interface ClaudeChatRequest extends ClaudeOptions {
  /** Full turn history, oldest first. Must start with a `user` turn. */
  messages: Anthropic.MessageParam[]
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

/**
 * Marks a system prompt as cacheable.
 *
 * Caching is a prefix match over `tools` → `system` → `messages`, so everything
 * that is byte-identical across a batch of calls belongs in here and everything
 * that varies belongs in the user turn. One interpolated name in the system
 * prompt and every call pays full price with zero cache reads.
 *
 * Below roughly 1024 tokens nothing is cached and no error is raised — check
 * `usage.cache_read_input_tokens` rather than assuming it worked.
 */
export function cacheableSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
}

export function joinTextBlocks(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function buildBody(
  options: ClaudeOptions,
  messages: Anthropic.MessageParam[],
  maxTokens: number
): Anthropic.MessageCreateParamsNonStreaming {
  const outputConfig: Anthropic.OutputConfig = {}
  if (options.effort !== undefined) outputConfig.effort = options.effort
  if (options.schema !== undefined) {
    outputConfig.format = {
      type: 'json_schema',
      schema: options.schema
    } as Anthropic.JSONOutputFormat
  }

  return {
    model: options.model ?? optionalEnv('ANTHROPIC_MODEL', DEFAULT_MODEL),
    max_tokens: maxTokens,
    messages,
    ...(options.system === undefined ? {} : { system: options.system }),
    ...(options.thinking === undefined
      ? {}
      : { thinking: { type: options.thinking } }),
    ...(Object.keys(outputConfig).length === 0
      ? {}
      : { output_config: outputConfig })
  }
}

async function send(
  body: Anthropic.MessageCreateParamsNonStreaming,
  maxTokens: number,
  sender: MessageSender
): Promise<string> {
  const message = await sender(body)

  if (message.stop_reason === 'max_tokens')
    throw new ClaudeTruncatedError(maxTokens)

  return joinTextBlocks(message)
}

export async function completeText(
  request: ClaudeRequest,
  sender: MessageSender = sendToClaude
): Promise<string> {
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: request.prompt }
  ]

  return send(buildBody(request, messages, maxTokens), maxTokens, sender)
}

/**
 * Multi-turn variant, for the editorial chat. The caller owns the history and
 * persists it; this function stays stateless.
 */
export async function completeChat(
  request: ClaudeChatRequest,
  sender: MessageSender = sendToClaude
): Promise<string> {
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS

  return send(
    buildBody(request, request.messages, maxTokens),
    maxTokens,
    sender
  )
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

function parseJson<T>(raw: string): T {
  const json = extractJson(raw)
  try {
    return JSON.parse(json) as T
  } catch {
    throw new ClaudeFormatError(raw)
  }
}

/**
 * Same as completeText, but parses the answer as JSON. `T` is a promise, not a
 * proof — validate the shape at the call site before writing it to a collection.
 */
export async function completeJson<T>(
  request: ClaudeRequest,
  sender: MessageSender = sendToClaude
): Promise<T> {
  return parseJson<T>(await completeText(request, sender))
}

/** completeChat, parsed as JSON. Same caveat about `T` as completeJson. */
export async function completeChatJson<T>(
  request: ClaudeChatRequest,
  sender: MessageSender = sendToClaude
): Promise<T> {
  return parseJson<T>(await completeChat(request, sender))
}
