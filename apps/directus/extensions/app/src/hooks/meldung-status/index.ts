import { createError } from '@directus/errors'
import { defineHook } from '@directus/extensions-sdk'
import {
  inhaltGeaendert,
  pruefeUebergang,
  ruecksetzungNachAenderung,
  type MeldungZustand
} from '../../redaktion/status'
import type { MeldungStatus } from '../../types/schema'

// Enforces the editorial state machine on every write path.
//
// A hook and not endpoint logic, because the endpoints are not the only door.
// Sämi is an administrator: he can open a message in the Directus admin UI and
// set `status` to `publiziert` by hand. A rule checked only where we happen to
// call it is not a rule — it is a convention, and this one is load-bearing:
// it is what stands between "sent out for checking" and "published without
// anyone approving it".
//
// `filter` rather than `action`: this is the last point at which the write can
// still be refused or amended.

const UebergangError = createError<{ grund: string }>(
  'MELDUNG_STATUS',
  ({ grund }) => grund,
  422
)

interface MeldungenService {
  readMany(keys: string[], query?: Record<string, unknown>): Promise<unknown[]>
}

export default defineHook(({ filter }, { services }) => {
  const ItemsService = services.ItemsService as new (
    collection: string,
    options: unknown
  ) => MeldungenService

  filter('meldungen.items.update', async (payload, meta, context) => {
    const daten = payload as Record<string, unknown>
    const keys = (meta['keys'] as string[] | undefined) ?? []
    if (keys.length === 0) return payload

    const meldungen = new ItemsService('meldungen', {
      schema: context.schema,
      // Deliberately without accountability: this validates an invariant and
      // must see the real current state, not the caller's filtered view.
      knex: context.database
    })

    const aktuelle = (await meldungen.readMany(keys, {
      fields: [
        'id',
        'status',
        'titel',
        'lead',
        'text',
        'entscheidung',
        'freigegeben_am'
      ]
    })) as (MeldungZustand & { id: string })[]

    let ergebnis = daten

    for (const aktuell of aktuelle) {
      // An edit to the text invalidates an approval that was given for the
      // old text. Checked before the transition, so the reset is part of the
      // same write rather than a second one that could fail on its own.
      if (inhaltGeaendert(aktuell, daten)) {
        const zuruecksetzen = ruecksetzungNachAenderung(aktuell)
        if (zuruecksetzen !== null) {
          ergebnis = { ...zuruecksetzen, ...ergebnis }
          // The caller did not ask for a status change, so the reset decides.
          if (!('status' in daten)) {
            ergebnis = { ...ergebnis, status: zuruecksetzen['status'] }
          }
        }
      }

      const gewuenscht = ergebnis['status']
      if (typeof gewuenscht !== 'string') continue

      const pruefung = pruefeUebergang(aktuell, gewuenscht as MeldungStatus)
      if (!pruefung.erlaubt) {
        throw new UebergangError({
          grund: pruefung.grund ?? 'Der Statuswechsel ist nicht zulaessig.'
        })
      }
    }

    // Stamp the moments the state machine relies on, so they can never be
    // missing when a later transition checks for them.
    if (
      ergebnis['status'] === 'publiziert' &&
      ergebnis['publiziert_am'] === undefined
    ) {
      ergebnis = { ...ergebnis, publiziert_am: new Date().toISOString() }
    }

    return ergebnis
  })
})
