import { createError, ErrorCode, isDirectusError } from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import type { NextFunction, Response } from 'express'
import { completeJson } from '../../shared/claude'
import { isAuthenticated, type ApiRequest } from '../../shared/http'
import type { Note } from '../../types/schema'
import {
  buildSummaryPrompt,
  EmptyNoteError,
  parseSummary,
  SUMMARY_SYSTEM_PROMPT,
  summaryFields
} from './prompt'

// POST /notes-summary/:id
//
// The template's example of a custom endpoint: authenticated, reads through a
// Directus service (so permissions and hooks apply), calls Claude, writes the
// result back. Copy this shape for your own endpoints.

const NotSignedInError = createError(
  'FORBIDDEN',
  'Anmeldung erforderlich.',
  401
)
const InvalidNoteIdError = createError(
  'INVALID_NOTE_ID',
  'Ungueltige Notiz-ID.',
  400
)
// One error for "does not exist" and "not yours", on purpose: two different
// answers would let a caller probe which ids exist. Same status Directus itself
// returns, only with a German message.
const NoteAccessError = createError(
  'FORBIDDEN',
  'Notiz nicht gefunden oder nicht freigegeben.',
  403
)
const EmptyNoteBodyError = createError(
  'NOTE_EMPTY',
  'Die Notiz enthaelt keinen Text, der zusammengefasst werden kann.',
  400
)
const SummaryFailedError = createError(
  'SUMMARY_FAILED',
  'Die Zusammenfassung konnte nicht erzeugt werden.',
  502
)

export default defineEndpoint((router, { services, getSchema, logger }) => {
  const { ItemsService } = services

  router.post(
    '/:id',
    async (req: ApiRequest, res: Response, next: NextFunction) => {
      if (!isAuthenticated(req)) return next(new NotSignedInError())

      const id = req.params['id']
      if (id === undefined || id === '') return next(new InvalidNoteIdError())

      // Passing `accountability` makes the read obey the caller's permissions.
      // Omit it only where an endpoint must deliberately act as the system.
      const notes = new ItemsService('notes', {
        schema: await getSchema(),
        accountability: req.accountability
      })

      let note: Pick<Note, 'id' | 'title' | 'body'>

      try {
        note = (await notes.readOne(id, {
          fields: ['id', 'title', 'body']
        })) as Pick<Note, 'id' | 'title' | 'body'>
      } catch (error) {
        // `readOne` never returns null: it throws ForbiddenError for an item that
        // is missing *or* not readable, and on a malformed key. Keep that one
        // status and that ambiguity — only the message becomes German. Anything
        // else here is a real fault (database down, schema mismatch): log it and
        // let Directus answer 500 rather than mislabel it as a permission problem.
        if (isDirectusError(error, ErrorCode.Forbidden)) {
          return next(new NoteAccessError())
        }

        logger.error(error, `notes-summary could not read note ${id}`)
        return next(error)
      }

      try {
        const answer = await completeJson<unknown>({
          system: SUMMARY_SYSTEM_PROMPT,
          prompt: buildSummaryPrompt(note),
          maxTokens: 1024
        })

        const summary = parseSummary(answer)

        await notes.updateOne(id, summaryFields(summary, new Date()))

        return res.json({ data: { id, ...summary } })
      } catch (error) {
        // A note with nothing to summarise is the caller's problem, not a fault:
        // answer 400 rather than hiding it in the generic 502 below.
        if (error instanceof EmptyNoteError) {
          return next(new EmptyNoteBodyError())
        }

        // Log the cause, return a stable error to the client. Never leak a raw
        // provider error (it can contain the prompt) to the browser.
        logger.error(error, `notes-summary failed for note ${id}`)
        return next(new SummaryFailedError())
      }
    }
  )
})
