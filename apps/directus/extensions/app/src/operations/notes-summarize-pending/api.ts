import { defineOperationApi } from '@directus/extensions-sdk'
import { completeJson } from '../../shared/claude'
import {
  buildSummaryPrompt,
  parseSummary,
  SUMMARY_SYSTEM_PROMPT,
  summaryFields
} from '../../endpoints/notes-summary/prompt'
import type { Note } from '../../types/schema'
import { selectPendingNotes } from './pending'

// The template's example of scheduled work.
//
// There is no cron daemon and no extra container in this stack. Recurring work is
// a Directus Flow with a Schedule (cron) trigger that calls this operation:
//   Settings → Flows → Create Flow → Trigger "Schedule (cron)" → add this
//   operation → Save, then `npm run schema:dump` to commit the Flow.
//   https://directus.com/docs/guides/flows/triggers
//
// Keep the handler idempotent and bounded (`limit`): a scheduled run may overlap
// with a previous one, and an unbounded run is how a nightly job turns into a
// surprise API bill.

export interface Options {
  limit: number
  model?: string | null
}

export default defineOperationApi<Options>({
  id: 'notes-summarize-pending',
  handler: async ({ limit, model }, { services, getSchema, logger }) => {
    const { ItemsService } = services

    // No accountability: a scheduled Flow has no user. This service therefore
    // runs with full access — read and write only what the job needs.
    const notes = new ItemsService('notes', { schema: await getSchema() })

    const candidates = (await notes.readByQuery({
      filter: { status: { _eq: 'published' } },
      sort: ['-date_created'],
      limit: 200,
      fields: ['id', 'title', 'body', 'ai_summary']
    })) as Array<Pick<Note, 'id' | 'title' | 'body' | 'ai_summary'>>

    const pending = selectPendingNotes(candidates, limit)
    const summarized: string[] = []

    for (const note of pending) {
      try {
        const answer = await completeJson<unknown>({
          system: SUMMARY_SYSTEM_PROMPT,
          prompt: buildSummaryPrompt(note),
          maxTokens: 1024,
          ...(model ? { model } : {})
        })

        await notes.updateOne(
          note.id,
          summaryFields(parseSummary(answer), new Date())
        )

        summarized.push(note.id)
      } catch (error) {
        // One bad note must not abort the run — the next scheduled run retries it.
        logger.warn(error, `notes-summarize-pending: skipped note ${note.id}`)
      }
    }

    // The return value shows up in the Flow log; make it worth reading.
    return {
      candidates: candidates.length,
      pending: pending.length,
      summarized
    }
  }
})
