// Prompt building and answer validation for matching a dossier segment's
// "Ausserdem" (secondary topic) headlines to where they're actually covered in
// the transcript, and summarising that coverage in clean Hochdeutsch.
//
// This replaces the Python PoC's position-based keyword-matching heuristic and its
// hand-curated Hochdeutsch-correction lookup table (both explicitly documented
// there as fragile and not generalizable) with one Claude call per segment that
// has secondary topics - the model can actually read the transcript, rather than
// approximate "where is this topic really covered" from keyword position alone.
//
// The "Ausserdem: · ..." bullet-list parsing itself stays plain string logic
// (parseExtraTopicHeadlines) - there's nothing for a model to interpret there.
//
// Kept pure and unit-testable without a network call, per the notes-summary/
// prompt.ts pattern: index.ts (the endpoint) and process-dossier.ts (used by both
// the endpoint and the scheduled operation) only wire this up to completeJson.

export interface TranscriptParagraphInput {
  timestamp: string // "HH:MM:SS"
  seconds: number
  text: string
}

export interface ResolvedExtraTopic {
  headline: string
  paragraphTimestamp: string | null
  paragraphSeconds: number | null
  summary: string | null
}

const BULLET_SEPARATOR = '·'

/** Parses the "Ausserdem[ in der Sendung]: · Topic one · Topic two" field into a plain headline list. */
export function parseExtraTopicHeadlines(description: string | null): string[] {
  if (!description) return []
  const colonIndex = description.indexOf(':')
  if (colonIndex === -1) return []

  return description
    .slice(colonIndex + 1)
    .split(BULLET_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

export class NoExtraTopicsError extends Error {
  constructor() {
    super('No extra topic headlines to build a prompt for.')
    this.name = 'NoExtraTopicsError'
  }
}

export const TOPICS_SYSTEM_PROMPT = [
  'Du ordnest Nebenthemen eines Regionaljournal-Beitrags ihrem tatsaechlichen Vorkommen im Transkript zu.',
  'Du bekommst das vollstaendige, absatzweise mit Timecodes versehene Transkript einer Sendung sowie eine',
  'Liste von "Ausserdem"-Schlagzeilen, die am Anfang der Sendung nur kurz angerissen werden, bevor die',
  'eigentliche Berichterstattung dazu spaeter folgt.',
  '',
  'Fuer jede Schlagzeile: finde den Timecode, ab dem das Thema wirklich inhaltlich behandelt wird (nicht',
  'die blosse Erwaehnung am Anfang) und schreibe eine kurze, saubere Zusammenfassung dieses Abschnitts auf',
  'Hochdeutsch - auch wenn das Transkript selbst holprige, aus gesprochenem Schweizerdeutsch automatisch',
  'transkribierte Grammatik enthaelt (fehlende Verben, "am + Infinitiv"-Konstruktionen, "die/der + Name"',
  'statt nur dem Namen). Erfinde nichts, was nicht im Transkript steht.',
  '',
  'Falls ein Thema im Transkript gar nicht eigenstaendig behandelt wird (nur die Anfangserwaehnung',
  'existiert), setze timestamp und summary auf null statt zu raten.',
  '',
  'Antworte ausschliesslich mit JSON in der Form:',
  '{"topics": [{"headline": string, "timestamp": "HH:MM:SS" oder null, "summary": string oder null}]}',
  'Der Timecode muss exakt einem der im Transkript angegebenen Timecodes entsprechen.',
  'Die Zusammenfassung ist hoechstens drei Saetze lang.'
].join('\n')

export function buildTopicsPrompt(
  paragraphs: TranscriptParagraphInput[],
  headlines: string[]
): string {
  if (headlines.length === 0) throw new NoExtraTopicsError()

  const transcript = paragraphs
    .map((p) => `${p.timestamp}: ${p.text}`)
    .join('\n')
  const headlineList = headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')

  return [
    'Transkript:',
    '',
    transcript,
    '',
    'Ausserdem-Schlagzeilen:',
    '',
    headlineList
  ].join('\n')
}

/**
 * Validates Claude's answer before it's written to a collection. The model was
 * asked for this shape; that's not the same as having been given it.
 *
 * Returns exactly one entry per input headline, in the input order (matching by
 * headline text rather than trusting the model's ordering). A missing entry, a
 * timestamp that doesn't correspond to a real paragraph, or an empty summary all
 * degrade to "unmatched" (nulls) rather than throwing - one malformed topic must
 * not lose the others, and an unmatched topic is exactly the old PoC's fallback
 * behaviour (headline shown without a listen link) rather than a hard failure.
 */
export function parseTopicsAnswer(
  value: unknown,
  headlines: string[],
  paragraphs: TranscriptParagraphInput[]
): ResolvedExtraTopic[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Claude-Antwort ist kein Objekt.')
  }

  const rawTopics = Array.isArray((value as { topics?: unknown }).topics)
    ? (value as { topics: unknown[] }).topics
    : []

  const secondsByTimestamp = new Map(
    paragraphs.map((p) => [p.timestamp, p.seconds])
  )

  return headlines.map((headline) => {
    const match = rawTopics.find(
      (t) =>
        typeof t === 'object' &&
        t !== null &&
        (t as { headline?: unknown }).headline === headline
    ) as { timestamp?: unknown; summary?: unknown } | undefined

    const rawTimestamp =
      match && typeof match.timestamp === 'string' ? match.timestamp : null
    const knownSeconds =
      rawTimestamp !== null
        ? (secondsByTimestamp.get(rawTimestamp) ?? null)
        : null
    const paragraphTimestamp = knownSeconds !== null ? rawTimestamp : null

    const rawSummary =
      match && typeof match.summary === 'string' ? match.summary.trim() : ''
    const summary =
      paragraphTimestamp !== null && rawSummary !== '' ? rawSummary : null

    return {
      headline,
      paragraphTimestamp,
      paragraphSeconds: knownSeconds,
      summary
    }
  })
}
