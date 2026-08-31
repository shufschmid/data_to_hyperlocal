import { defineOperationApi } from '@directus/extensions-sdk'
import { Readable } from 'node:stream'
import { ingestDossiersFromMailbox } from '../../dossiers/ingest-mailbox'
import { imapConfigFromEnv, fetchDossierMessages } from '../../dossiers/mailbox'
import type { ItemsServiceLike } from '../../dossiers/process-dossier'
import type { Dossier } from '../../types/schema'

// Scheduled work: attach to a Directus Flow with a Schedule (cron) trigger, same
// as dossiers-process-pending. This is the "ingestion" half of the split - it
// only creates `dossiers` rows (status='pending') from mailbox messages;
// dossiers-process-pending (a separate operation, independently scheduled) turns
// those into editions. Decoupled so the mailbox-specific part can be swapped
// later (e.g. for an inbound-email webhook) without touching processing at all.
// The actual selection/upload/create loop lives in dossiers/ingest-mailbox.ts,
// shared with the manual dossiers-ingest endpoint.

export interface Options {
  limit: number
}

export default defineOperationApi<Options>({
  id: 'dossiers-ingest-imap',
  handler: async ({ limit }, { services, getSchema, logger }) => {
    const schema = await getSchema()
    const { ItemsService, FilesService } = services

    // No accountability: a scheduled Flow has no user.
    const dossiers = new ItemsService('dossiers', {
      schema
    }) as unknown as ItemsServiceLike<Dossier>
    const files = new FilesService({ schema })

    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5

    const result = await ingestDossiersFromMailbox(safeLimit, {
      dossiers,
      uploadFile: async (buffer, filename) =>
        String(
          await files.uploadOne(Readable.from(buffer), {
            filename_download: filename,
            type: 'application/pdf'
          })
        ),
      fetchMessages: fetchDossierMessages,
      mailboxConfig: imapConfigFromEnv(), // throws via requireEnv, loudly and specifically, if unset
      logger
    })

    return result
  }
})
