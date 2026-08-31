import { defineOperationApi } from '@directus/extensions-sdk'
import { Readable } from 'node:stream'
import { fetchDossierMessages } from '../../dossiers/mailbox'
import type { ItemsServiceLike } from '../../dossiers/process-dossier'
import {
  ingestPunkt6DossiersFromMailbox,
  punkt6ImapConfigFromEnv
} from '../../punkt6/ingest-mailbox'
import type { Punkt6Dossier } from '../../types/schema'

// Scheduled work: attach to a Directus Flow with a Schedule (cron) trigger, same
// as dossiers-ingest-imap. This is the "ingestion" half of the split for
// Punkt6 - it only creates `punkt6_dossiers` rows (status='pending') from
// mailbox messages; punkt6-dossiers-process-pending (a separate, independently
// scheduled operation) turns those into editions. Reuses the same IMAP client
// (dossiers/mailbox.ts) as the Regionaljournal ingest, just with
// PUNKT6_IMAP_SUBJECT_FILTER instead of IMAP_SUBJECT_FILTER (see
// punkt6/ingest-mailbox.ts) - same mailbox, different message filter.

export interface Options {
  limit: number
}

export default defineOperationApi<Options>({
  id: 'punkt6-dossiers-ingest-imap',
  handler: async ({ limit }, { services, getSchema, logger }) => {
    const schema = await getSchema()
    const { ItemsService, FilesService } = services

    // No accountability: a scheduled Flow has no user.
    const dossiers = new ItemsService('punkt6_dossiers', {
      schema
    }) as unknown as ItemsServiceLike<Punkt6Dossier>
    const files = new FilesService({ schema })

    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5

    const result = await ingestPunkt6DossiersFromMailbox(safeLimit, {
      dossiers,
      uploadFile: async (buffer, filename) =>
        String(
          await files.uploadOne(Readable.from(buffer), {
            filename_download: filename,
            type: 'application/pdf'
          })
        ),
      fetchMessages: fetchDossierMessages,
      mailboxConfig: punkt6ImapConfigFromEnv(), // throws via requireEnv, loudly and specifically, if unset
      logger
    })

    return result
  }
})
