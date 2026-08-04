import { defineHook } from '@directus/extensions-sdk'
import { normalizeNotePayload, type NotePayload } from './normalize'

// The template's example of a hook.
//
// `filter` runs *before* the write and must return the payload — it is the only
// place that can still change what gets stored. `action` runs after the write and
// cannot change anything; use it for side effects (notify, enqueue, log).
//
// A hook fires for every write path: admin UI, REST, GraphQL, other extensions.
// That makes it the right place for invariants, and the wrong place for anything
// slow — a hook blocks the request. Long work belongs in a Flow (see
// operations/notes-summarize-pending).
export default defineHook(({ filter }) => {
  filter('notes.items.create', (payload) =>
    normalizeNotePayload(payload as NotePayload)
  )
  filter('notes.items.update', (payload) =>
    normalizeNotePayload(payload as NotePayload)
  )
})
