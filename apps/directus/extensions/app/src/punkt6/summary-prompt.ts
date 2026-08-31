// Prompt building and answer validation for an optional, short editorial lead per
// Punkt6 Beitrag. Unlike dossiers/topics-prompt.ts, this Claude call has nothing to
// figure out about *where* a topic is covered - telebasel.ch already gives exact
// segment boundaries (see telebasel-client.ts, segment-slicer.ts) - so the only
// job left for the model is turning a transcript slice into 1-2 clean Hochdeutsch
// sentences. Kept pure and unit-testable without a network call, per the
// notes-summary/prompt.ts pattern.

export interface SegmentSummaryInput {
  headline: string
  paragraphs: { timestamp: string; text: string }[]
}

export interface SegmentLead {
  headline: string
  lead: string | null
}

export class NoSegmentsError extends Error {
  constructor() {
    super('No segments to build a summary prompt for.')
    this.name = 'NoSegmentsError'
  }
}

export const SUMMARY_SYSTEM_PROMPT = [
  'Du schreibst je einen kurzen redaktionellen Lead-Satz fuer Beitraege der TV-Sendung Punkt6 von Tele Basel.',
  'Du bekommst pro Beitrag dessen Schlagzeile und den zugehoerigen, absatzweise transkribierten Textausschnitt.',
  '',
  'Schreibe pro Beitrag hoechstens zwei Saetze auf sauberem Hochdeutsch, die den Inhalt zusammenfassen - auch',
  'wenn das Transkript selbst holprige, aus gesprochenem Schweizerdeutsch automatisch transkribierte',
  'Grammatik enthaelt. Erfinde nichts, was nicht im Transkript steht.',
  '',
  'Falls der Textausschnitt zu einem Beitrag leer oder zu kurz fuer eine sinnvolle Zusammenfassung ist,',
  'setze lead auf null statt zu raten.',
  '',
  'Antworte ausschliesslich mit JSON in der Form:',
  '{"leads": [{"headline": string, "lead": string oder null}]}'
].join('\n')

export function buildSummaryPrompt(segments: SegmentSummaryInput[]): string {
  if (segments.length === 0) throw new NoSegmentsError()

  const body = segments
    .map((segment, i) => {
      const transcript = segment.paragraphs
        .map((p) => `${p.timestamp}: ${p.text}`)
        .join('\n')
      return [
        `${i + 1}. ${segment.headline}`,
        transcript || '(kein Transkript)'
      ].join('\n')
    })
    .join('\n\n')

  return ['Beitraege:', '', body].join('\n')
}

/**
 * Validates Claude's answer before it's written to a collection. Returns exactly
 * one entry per input segment, in input order (matching by headline text rather
 * than trusting the model's ordering) - a missing or empty lead degrades to null
 * rather than losing the other segments' leads.
 */
export function parseSummaryAnswer(
  value: unknown,
  segments: SegmentSummaryInput[]
): SegmentLead[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Claude-Antwort ist kein Objekt.')
  }

  const rawLeads = Array.isArray((value as { leads?: unknown }).leads)
    ? (value as { leads: unknown[] }).leads
    : []

  return segments.map((segment) => {
    const match = rawLeads.find(
      (l) =>
        typeof l === 'object' &&
        l !== null &&
        (l as { headline?: unknown }).headline === segment.headline
    ) as { lead?: unknown } | undefined

    const rawLead =
      match && typeof match.lead === 'string' ? match.lead.trim() : ''
    return { headline: segment.headline, lead: rawLead !== '' ? rawLead : null }
  })
}
