import { createError } from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import type { NextFunction, Response } from 'express'
import { Readable } from 'node:stream'
import { ingestDossiersFromMailbox } from '../../dossiers/ingest-mailbox'
import { imapConfigFromEnv, fetchDossierMessages } from '../../dossiers/mailbox'
import type { ItemsServiceLike } from '../../dossiers/process-dossier'
import { isAuthenticated, type ApiRequest } from '../../shared/http'
import type { Dossier } from '../../types/schema'

// POST /dossiers-ingest
//
// Manually triggers a mailbox check, authenticated - for the "Postfach jetzt
// pruefen" button in DossiersPanel, without waiting for the scheduled
// dossiers-ingest-imap Flow. Only creates `dossiers` rows (status='pending');
// it does not process them (that stays the separate, per-dossier
// dossier-process call the frontend already makes) - chaining several 15-35s
// processing calls into one request would risk a reverse-proxy timeout on a
// real deployment. Same shape as dossier-process: reads through a service so
// permissions apply, does the work, returns the result.
//
// Body: { limit?: number }, defaults to 5.

const NotSignedInError = createError(
  'FORBIDDEN',
  'Anmeldung erforderlich.',
  401
)
const IngestFailedError = createError(
  'INGEST_FAILED',
  'Das Postfach konnte nicht abgefragt werden.',
  502
)

export default defineEndpoint((router, { services, getSchema, logger }) => {
  const { ItemsService, FilesService } = services

  router.post(
    '/',
    async (req: ApiRequest, res: Response, next: NextFunction) => {
      if (!isAuthenticated(req)) return next(new NotSignedInError())

      const rawLimit = (req.body as { limit?: unknown } | undefined)?.limit
      const limit =
        typeof rawLimit === 'number' &&
        Number.isFinite(rawLimit) &&
        rawLimit > 0
          ? Math.floor(rawLimit)
          : 5

      const schema = await getSchema()
      const dossiers = new ItemsService('dossiers', {
        schema,
        accountability: req.accountability
      }) as unknown as ItemsServiceLike<Dossier>
      const files = new FilesService({
        schema,
        accountability: req.accountability
      })

      try {
        const result = await ingestDossiersFromMailbox(limit, {
          dossiers,
          uploadFile: async (buffer, filename) =>
            String(
              await files.uploadOne(Readable.from(buffer), {
                filename_download: filename,
                type: 'application/pdf'
              })
            ),
          fetchMessages: fetchDossierMessages,
          mailboxConfig: imapConfigFromEnv(),
          logger
        })

        return res.json({ data: result })
      } catch (error) {
        logger.error(error, 'dossiers-ingest failed')
        return next(new IngestFailedError())
      }
    }
  )
})
