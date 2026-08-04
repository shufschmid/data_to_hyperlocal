// Pure payload normalisation for the notes collection.

export interface NotePayload {
  title?: string | null
  body?: string | null
  ai_summary?: string | null
  ai_summary_tags?: string[] | null
  ai_summary_generated_at?: string | null
  status?: string | null
}

/**
 * Trims the title and, when the source text changes, clears every generated
 * summary field so a stale AI artefact can never outlive the text it describes.
 *
 * Anything an LLM derived from a record is a cache. Invalidate it in a hook
 * (one place, every write path) rather than in each endpoint that edits data.
 */
export function normalizeNotePayload(payload: NotePayload): NotePayload {
  const next: NotePayload = { ...payload }

  if (typeof next.title === 'string') next.title = next.title.trim()

  const bodyChanged = Object.prototype.hasOwnProperty.call(payload, 'body')
  const summaryWrittenExplicitly = Object.prototype.hasOwnProperty.call(
    payload,
    'ai_summary'
  )

  if (bodyChanged && !summaryWrittenExplicitly) {
    next.ai_summary = null
    next.ai_summary_tags = null
    next.ai_summary_generated_at = null
  }

  return next
}
