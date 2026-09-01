import { defineOperationApi } from '@directus/extensions-sdk'
import { buffer } from 'node:stream/consumers'
import {
  processPunkt6Dossier,
  type ItemsServiceLike
} from '../../punkt6/process-punkt6-dossier'
import { createTelebaselClient } from '../../punkt6/telebasel-client'
import type { Punkt6Dossier, Punkt6Edition } from '../../types/schema'
import { selectPendingDossiers } from './pending'
import { raeumeKandidatenAuf, sichteSendung } from '../../redaktion/sendunglauf'

// Scheduled work: attach to a Directus Flow with a Schedule (cron) trigger
// (Settings -> Flows -> Create Flow -> Trigger "Schedule (cron)" -> add this
// operation -> Save, then `npm run schema:dump`). This is the "process" half of
// the ingestion/processing split for Punkt6, same shape as
// dossiers-process-pending - it only looks at punkt6_dossiers that already
// exist with status='pending'.
//
// Bounded (`limit`) and one bad dossier is logged and skipped rather than
// aborting the run - processPunkt6Dossier itself already turns a bad dossier
// into a 'failed' status rather than throwing.

export interface Options {
  limit: number
}

export default defineOperationApi<Options>({
  id: 'punkt6-dossiers-process-pending',
  handler: async ({ limit }, { services, getSchema, logger }) => {
    const schema = await getSchema()
    const { ItemsService, AssetsService } = services

    // No accountability: a scheduled Flow has no user, so this runs with full
    // access - read/write only what processPunkt6Dossier actually needs.
    const dossiers = new ItemsService('punkt6_dossiers', {
      schema
    }) as unknown as ItemsServiceLike<Punkt6Dossier>
    const editions = new ItemsService('punkt6_editions', {
      schema
    }) as unknown as ItemsServiceLike<Punkt6Edition>
    const assets = new AssetsService({ schema })

    const candidates = (await dossiers.readByQuery({
      filter: { status: { _eq: 'pending' } },
      sort: ['date_created'],
      limit: 100,
      fields: ['id']
    })) as { id: string }[]

    const pending = selectPendingDossiers(candidates, limit)

    const kandidaten = new ItemsService('sendungskandidaten', { schema })
    // Zuerst aufraeumen, dann Neues holen: ein Sendungs-Kandidat ist verderblich,
    // und Entschiedenes wird nie geloescht — das ist das Gedaechtnis.
    const aufgeraeumt = await raeumeKandidatenAuf(
      kandidaten as never,
      new Date().toISOString().slice(0, 10),
      logger
    )

    let processed = 0
    let failed = 0
    let wartend = 0
    let kandidatenNeu = 0

    for (const { id } of pending) {
      try {
        const result = await processPunkt6Dossier(id, {
          dossiers,
          editions,
          readSourceFile: async (fileId) => {
            const { stream } = await assets.getAsset(fileId)
            return buffer(stream)
          },
          telebaselClient: createTelebaselClient(),
          logger
        })
        if (result.status === 'processed') processed++
        else if (result.status === 'wartet') wartend++
        else failed++

        // Die Gemeinde-Sichtung faengt ihre Fehler selbst — sie darf die
        // Durchsicht, um die es hier zuerst geht, nie gefaehrden. Solange die
        // Beitragsmarken fehlen ('wartet'), wird bewusst NICHT gesichtet — die
        // richtigen Kandidaten folgen, sobald telebasel.ch die Marken setzt.
        const sichtung = await sichteSendung(
          result.status !== 'processed' || result.editionId === null
            ? []
            : [result.editionId],
          'punkt6',
          {
            editions: editions as never,
            kandidaten: kandidaten as never,
            gemeinden: new ItemsService('gemeinden', { schema }) as never,
            logger
          }
        )
        kandidatenNeu += sichtung.kandidaten
      } catch (error) {
        logger.warn(
          error,
          `punkt6-dossiers-process-pending: skipped dossier ${id}`
        )
        failed++
      }
    }

    // Shows up in the Flow log - make it worth reading.
    return {
      candidates: candidates.length,
      pending: pending.length,
      processed,
      failed,
      wartend,
      kandidaten: kandidatenNeu,
      aufgeraeumt
    }
  }
})
