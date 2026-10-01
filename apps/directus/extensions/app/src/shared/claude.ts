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
 * How long a request may take before it is given up on — per shape, not global.
 *
 * `drain` deliberately runs one pass at a time, so a single sticky call holds up
 * every article and every revision queued behind it; from the workspace that is
 * indistinguishable from a hung queue. The SDK's own default is ten minutes and
 * `maxRetries: 3` multiplies it, which is far too much slack for an article.
 *
 * But the limit cannot be one number. The streaming path exists precisely
 * because some work legitimately runs long: a dense waste calendar takes Opus
 * eight to ten minutes, and cutting that off at four would break a feature that
 * works today. So the short leash goes on the ordinary path only.
 */
const TIMEOUT_KURZ_MS = 4 * 60 * 1000
const TIMEOUT_STROM_MS = 20 * 60 * 1000

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
    ? getClaude()
        .messages.stream(body, { timeout: TIMEOUT_STROM_MS })
        .finalMessage()
    : getClaude().messages.create(body, { timeout: TIMEOUT_KURZ_MS })

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
  thinking?: 'adaptive' | 'disabled' | 'between_tools'
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
  /**
   * Which desk and purpose this call serves, as `tisch:zweck` — what the
   * usage record is filed under (`modellaufrufe`). Since 30.09.2026 every
   * call site names one; a call without it is filed under `unbekannt`.
   */
  zweck?: string
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

// ---------------------------------------------------------------------------
// Verbrauch — what every call cost, recorded where the newsroom can see it
// ---------------------------------------------------------------------------

/** One call's usage, as the API reports it — what `modellaufrufe` stores. */
export interface Modellaufruf {
  zweck: string
  modell: string
  eingabe_tokens: number
  ausgabe_tokens: number
  cache_gelesen_tokens: number
  cache_geschrieben_tokens: number
  dauer_ms: number
  /** The budget the call went out with — read against `ausgabe_tokens`. */
  max_tokens: number
  /** The answer hit `max_tokens` — paid for and thrown away. */
  abgebrochen: boolean
  /** The API's refusal or a transport failure; null on a completed call. */
  fehler: string | null
}

export type VerbrauchsSchreiber = (eintrag: Modellaufruf) => Promise<void>

let verbrauchsSchreiber: VerbrauchsSchreiber | null = null

/**
 * Where usage records go. Registered once at boot by the `modellverbrauch`
 * hook, which has the Directus services this module deliberately has not.
 * Without a writer nothing is recorded — tests and scripts stay silent.
 */
export function registriereVerbrauch(
  schreiber: VerbrauchsSchreiber | null
): void {
  verbrauchsSchreiber = schreiber
}

/** `gemeindeseiten:sichtung` → `gemeindeseiten`; a label without a colon is its own desk. */
export function tischVon(zweck: string): string {
  const doppelpunkt = zweck.indexOf(':')
  return doppelpunkt === -1 ? zweck : zweck.slice(0, doppelpunkt)
}

/** The usage block of an answer as a record — zeros where the API says nothing. */
export function verbrauchAus(
  usage: Partial<Anthropic.Usage> | null | undefined
): Pick<
  Modellaufruf,
  | 'eingabe_tokens'
  | 'ausgabe_tokens'
  | 'cache_gelesen_tokens'
  | 'cache_geschrieben_tokens'
> {
  const zahl = (wert: unknown): number =>
    typeof wert === 'number' && Number.isFinite(wert) ? wert : 0
  return {
    eingabe_tokens: zahl(usage?.input_tokens),
    ausgabe_tokens: zahl(usage?.output_tokens),
    cache_gelesen_tokens: zahl(usage?.cache_read_input_tokens),
    cache_geschrieben_tokens: zahl(usage?.cache_creation_input_tokens)
  }
}

/** Fire-and-forget: a lost usage record is a warning's worth, never a failed call. */
function vermerkeVerbrauch(eintrag: Modellaufruf): void {
  if (verbrauchsSchreiber === null) return
  void verbrauchsSchreiber(eintrag).catch((fehler: unknown) => {
    console.warn('claude: Verbrauch nicht vermerkt', fehler)
  })
}

// ---------------------------------------------------------------------------
// Einstellungen — what the newsroom set per purpose, applied on every call
// ---------------------------------------------------------------------------

/** What `modelleinstellungen` may override for a purpose; null means the code's own. */
export interface Modelleinstellung {
  modell: string | null
  max_tokens: number | null
}

export type EinstellungsLeser = (
  zweck: string
) => Promise<Modelleinstellung | null>

let einstellungsLeser: EinstellungsLeser | null = null

/** Registered at boot by the `modellverbrauch` hook, like the usage writer. */
export function registriereEinstellungen(
  leser: EinstellungsLeser | null
): void {
  einstellungsLeser = leser
}

/**
 * The thinking mode a model accepts for what the call site asked. The call
 * sites say `'disabled'` for sorting work; the 5.5 generation spells that
 * differently — Sonnet 5.5 takes `between_tools`, Opus 5.5 cannot switch
 * thinking off at all and takes a low effort instead. Measured on
 * 01.10.2026 with this house's call shape, so a model picked in «Kosten» is
 * never a 400 the next morning.
 */
export function thinkingFuer(
  model: string,
  gewuenscht: ClaudeOptions['thinking'],
  effort: ClaudeEffort | undefined
): { thinking?: ClaudeOptions['thinking']; effort?: ClaudeEffort } {
  if (gewuenscht !== 'disabled')
    return {
      ...(gewuenscht === undefined ? {} : { thinking: gewuenscht }),
      ...(effort === undefined ? {} : { effort })
    }
  if (/^claude-sonnet-5-5/.test(model))
    return {
      thinking: 'between_tools',
      ...(effort === undefined ? {} : { effort })
    }
  if (/^claude-(opus-5-5|fable|mythos)/.test(model))
    return { effort: effort ?? 'low' }
  return {
    thinking: 'disabled',
    ...(effort === undefined ? {} : { effort })
  }
}

/**
 * The options a call really goes out with: the newsroom's setting for its
 * purpose (exact purpose, else the desk) over the call site's own, over the
 * environment's default — model and budget — and the thinking mode the
 * chosen model accepts.
 */
export async function wirksameOptionen(
  request: ClaudeOptions
): Promise<{ optionen: ClaudeOptions; maxTokens: number }> {
  let einstellung: Modelleinstellung | null = null
  if (einstellungsLeser !== null && request.zweck !== undefined) {
    try {
      einstellung = await einstellungsLeser(request.zweck)
    } catch {
      einstellung = null
    }
  }
  const model =
    einstellung?.modell ??
    request.model ??
    optionalEnv('ANTHROPIC_MODEL', DEFAULT_MODEL)
  const maxTokens =
    einstellung?.max_tokens ?? request.maxTokens ?? DEFAULT_MAX_TOKENS
  const { thinking, effort } = thinkingFuer(
    model,
    request.thinking,
    request.effort
  )
  const optionen: ClaudeOptions = { ...request, model, maxTokens }
  delete optionen.thinking
  delete optionen.effort
  if (thinking !== undefined) optionen.thinking = thinking
  if (effort !== undefined) optionen.effort = effort
  return { optionen, maxTokens }
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
      : {
          thinking: {
            type: options.thinking
          } as Anthropic.ThinkingConfigParam
        }),
    ...(Object.keys(outputConfig).length === 0
      ? {}
      : { output_config: outputConfig })
  }
}

async function send(
  body: Anthropic.MessageCreateParamsNonStreaming,
  maxTokens: number,
  sender: MessageSender,
  zweck: string = 'unbekannt'
): Promise<string> {
  const start = Date.now()
  let message: Anthropic.Message
  try {
    message = await sender(body)
  } catch (fehler) {
    // A refusal or a dead connection carries no usage, but it is a call the
    // desk waited for — counted, with its reason, so a broken schema or a
    // rate limit shows up as a row and not only in a log nobody reads.
    vermerkeVerbrauch({
      zweck,
      modell: body.model,
      ...verbrauchAus(null),
      dauer_ms: Date.now() - start,
      max_tokens: body.max_tokens,
      abgebrochen: false,
      fehler:
        fehler instanceof Error ? fehler.message.slice(0, 500) : String(fehler)
    })
    throw fehler
  }

  const abgebrochen = message.stop_reason === 'max_tokens'
  vermerkeVerbrauch({
    zweck,
    modell: message.model || body.model,
    ...verbrauchAus(message.usage),
    dauer_ms: Date.now() - start,
    max_tokens: body.max_tokens,
    abgebrochen,
    fehler: null
  })

  if (abgebrochen) throw new ClaudeTruncatedError(maxTokens)

  return joinTextBlocks(message)
}

export async function completeText(
  request: ClaudeRequest,
  sender: MessageSender = sendToClaude
): Promise<string> {
  const { optionen, maxTokens } = await wirksameOptionen(request)
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: request.prompt }
  ]

  return send(
    buildBody(optionen, messages, maxTokens),
    maxTokens,
    sender,
    request.zweck
  )
}

/**
 * Multi-turn variant, for the editorial chat. The caller owns the history and
 * persists it; this function stays stateless.
 */
export async function completeChat(
  request: ClaudeChatRequest,
  sender: MessageSender = sendToClaude
): Promise<string> {
  const { optionen, maxTokens } = await wirksameOptionen(request)

  return send(
    buildBody(optionen, request.messages, maxTokens),
    maxTokens,
    sender,
    request.zweck
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
