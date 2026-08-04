export interface PendingCandidate {
  id: string
  title: string
  body: string | null
  ai_summary: string | null
}

/**
 * Picks the notes a scheduled run should summarise: those without a summary that
 * actually have text, capped at `limit`.
 *
 * Filtering in TypeScript rather than in the query keeps the rule testable and
 * keeps "what counts as summarisable" in one place. Push it into the `filter`
 * above once the collection is large enough that reading candidates hurts.
 */
export function selectPendingNotes(
  candidates: PendingCandidate[],
  limit: number
): PendingCandidate[] {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10

  return candidates
    .filter((note) => note.ai_summary === null || note.ai_summary.trim() === '')
    .filter(
      (note) => (note.body ?? '').trim() !== '' || note.title.trim() !== ''
    )
    .slice(0, safeLimit)
}
