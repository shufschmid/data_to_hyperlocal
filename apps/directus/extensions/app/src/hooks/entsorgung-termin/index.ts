import { defineHook } from '@directus/extensions-sdk'
import { beruehrtInhalt, ruecksetzungTermin } from '../../redaktion/entsorgung'

// Keeps a reminder honest when the date under it moves.
//
// A reminder is a cache of the Termin it was written from, and this project's
// rule for anything derived by a model is that its cache is invalidated where
// the source changes — not where we happen to call a function. That has to be a
// hook here for a concrete reason: Sämi is an administrator, so he can open a
// Termin in the Directus admin UI and fix a date the PDF got wrong. No endpoint
// sees that write.
//
// Two things happen, and they are deliberately split across the two hook kinds.
// The confirmation is dropped in a `filter`, because that is the last moment the
// stored row can still be amended. The reminder is discarded in an `action`,
// because it touches other rows and must not be part of the same payload.

interface TermineService {
  readMany(keys: string[], query?: Record<string, unknown>): Promise<unknown[]>
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  updateOne(key: string, daten: Record<string, unknown>): Promise<unknown>
  readOne(key: string, query?: Record<string, unknown>): Promise<unknown>
}

export default defineHook(({ filter, action }, { services, logger }) => {
  const ItemsService = services.ItemsService as new (
    collection: string,
    options: unknown
  ) => TermineService

  /**
   * A corrected date is an unconfirmed date.
   *
   * Whoever confirmed the old value confirmed a different fact; letting the
   * flag survive would mean the calendar claims a human checked something
   * nobody has seen.
   */
  filter('entsorgungstermine.items.update', (payload) => {
    const ruecksetzung = ruecksetzungTermin(payload as Record<string, unknown>)
    return ruecksetzung === null
      ? payload
      : { ...(payload as object), ...ruecksetzung }
  })

  action('entsorgungstermine.items.update', async (meta, context) => {
    const daten = (meta['payload'] as Record<string, unknown> | undefined) ?? {}
    const keys = (meta['keys'] as string[] | undefined) ?? []
    if (keys.length === 0) return

    // Only a change to the facts invalidates. Linking a Termin to its reminder
    // is itself an update, and that one must obviously not discard what it just
    // linked. Deliberately NOT `ruecksetzungTermin`: the filter above has
    // already merged `geprueft: false` into this very payload, and the
    // geprueft-guard in there would mistake that for a confirmation write —
    // the invalidation would then never fire at all.
    if (!beruehrtInhalt(daten)) return

    const optionen = { schema: context.schema, knex: context.database }
    const termine = new ItemsService('entsorgungstermine', optionen)
    const meldungen = new ItemsService('meldungen', optionen)

    try {
      const betroffene = (await termine.readMany(keys, {
        fields: ['id', 'meldung']
      })) as Array<{ id: string; meldung: string | null }>

      const meldungIds = [
        ...new Set(
          betroffene
            .map((termin) => termin.meldung)
            .filter((id): id is string => id !== null)
        )
      ]

      for (const meldungId of meldungIds) {
        const meldung = (await meldungen.readOne(meldungId, {
          fields: ['id', 'status']
        })) as { id: string; status: string }

        if (meldung.status === 'publiziert') {
          // Un-publishing behind an editor's back is not this system's call.
          // The note is what makes a wrong published reminder findable.
          await meldungen.updateOne(meldungId, {
            fehler:
              'Ein Termin dieser Erinnerung wurde nachtraeglich geaendert. Bitte den publizierten Text pruefen.'
          })
          logger.warn(
            `entsorgung-termin: publizierte Erinnerung ${meldungId} beruht auf einem geaenderten Termin`
          )
          continue
        }

        await meldungen.updateOne(meldungId, { status: 'verworfen' })

        // A merged reminder speaks for several dates. All of them lose the
        // link, or the next generation would believe they were still covered
        // and leave a newsletter day silently empty.
        const geschwister = (await termine.readByQuery({
          filter: { meldung: { _eq: meldungId } },
          fields: ['id'],
          limit: -1
        })) as Array<{ id: string }>

        for (const geschwisterTermin of geschwister) {
          await termine.updateOne(geschwisterTermin.id, { meldung: null })
        }
      }
    } catch (fehler) {
      // A failure here must not swallow the editor's correction — the date is
      // already stored, and a stale reminder is visible in the workspace.
      logger.warn(
        fehler,
        'entsorgung-termin: Erinnerung konnte nach der Terminaenderung nicht verworfen werden'
      )
    }
  })
})
