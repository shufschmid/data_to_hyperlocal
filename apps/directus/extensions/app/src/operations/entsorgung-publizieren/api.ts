import { defineOperationApi } from '@directus/extensions-sdk'
import { heuteIso, morgenIso } from '../../redaktion/feiertage'

// Lets the approved reminders out, one day at a time.
//
// The whole year of reminders is written and approved weeks in advance — that
// is the point of the feature — so something has to decide when each of them
// becomes public. That is this, and the rule is one day: a reminder for Friday
// is published on Thursday, because the Dorfkönig assembles Friday's newsletter
// on Thursday evening. Publishing on the day itself would miss the edition it
// was written for.
//
// The only scheduled piece of the feature, and it costs nothing: no model call,
// no outbound request, just a status change on rows a human already approved.
// Reading a calendar and writing the year stay in the endpoint, where an editor
// asks for them.
//
// Attach to a Flow with a Schedule trigger at 05:00 (`0 5 * * *`). Crons fire
// in the process timezone, which the Dockerfile pins to Europe/Zurich.

export interface Options {
  hoechstens?: number | null
}

interface MeldungenService {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  updateOne(key: string, daten: Record<string, unknown>): Promise<unknown>
}

const STANDARD_HOECHSTENS = 50

export default defineOperationApi<Options>({
  id: 'entsorgung-publizieren',
  handler: async (
    { hoechstens },
    { services, database, getSchema, logger }
  ) => {
    const ItemsService = services.ItemsService as unknown as new (
      collection: string,
      options: unknown
    ) => MeldungenService

    const grenze = hoechstens ?? STANDARD_HOECHSTENS
    const schema = await getSchema()

    // No accountability: a cron has no user. The `meldung-status` hook still
    // judges the transition — `freigegeben → publiziert` is allowed for every
    // writer and stamps `publiziert_am` — so this bypasses nothing but the
    // permission layer.
    const meldungen = new ItemsService('meldungen', { schema, knex: database })

    const morgen = morgenIso()
    const heute = heuteIso()

    const faellig = (await meldungen.readByQuery({
      filter: {
        status: { _eq: 'freigegeben' },
        erscheint_am: { _eq: morgen }
      },
      fields: ['id', 'titel', 'erscheint_am'],
      sort: ['erscheint_am'],
      limit: grenze
    })) as Array<{ id: string; titel: string | null; erscheint_am: string }>

    let publiziert = 0
    const fehler: string[] = []

    for (const meldung of faellig) {
      try {
        await meldungen.updateOne(meldung.id, { status: 'publiziert' })
        publiziert += 1
      } catch (error) {
        // One rejected transition must not cost the rest of the edition.
        const grund = error instanceof Error ? error.message : String(error)
        logger.warn(
          error,
          `entsorgung-publizieren: ${meldung.titel ?? meldung.id} nicht publiziert`
        )
        fehler.push(`${meldung.titel ?? meldung.id}: ${grund}`)
      }
    }

    // Honesty pass. An approved reminder whose day has gone by is not published
    // late — a reminder after the collection is worse than none — but it is
    // said out loud, because silence would look exactly like "nothing was due".
    // `_lt` alone, deliberately: two operators inside one field object do not
    // combine the way they read — `{ _nnull: true, _lt: heute }` matched every
    // approved reminder, so the tomorrow one was reported as missed. `_lt`
    // already excludes NULL.
    const verpasst = (await meldungen.readByQuery({
      filter: {
        status: { _eq: 'freigegeben' },
        erscheint_am: { _lt: heute }
      },
      fields: ['id', 'titel', 'erscheint_am'],
      limit: grenze
    })) as Array<{ id: string; titel: string | null; erscheint_am: string }>

    for (const meldung of verpasst) {
      try {
        await meldungen.updateOne(meldung.id, {
          fehler: `Erscheinungstag ${meldung.erscheint_am} verpasst — nicht publiziert.`
        })
        logger.warn(
          `entsorgung-publizieren: Erscheinungstag ${meldung.erscheint_am} verpasst (${meldung.titel ?? meldung.id})`
        )
      } catch (error) {
        logger.warn(error, 'entsorgung-publizieren: Hinweis nicht notiert')
      }
    }

    return {
      erscheint_am: morgen,
      publiziert,
      verpasst: verpasst.length,
      fehler
    }
  }
})
