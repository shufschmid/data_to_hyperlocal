import { createError } from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import type { NextFunction, Response } from 'express'
import { Readable } from 'node:stream'
import { fetchDossierMessages } from '../../dossiers/mailbox'
import type { ItemsServiceLike } from '../../dossiers/process-dossier'
import {
  ingestPunkt6DossiersFromMailbox,
  punkt6ImapConfigFromEnv
} from '../../punkt6/ingest-mailbox'
import { isAuthenticated, type ApiRequest } from '../../shared/http'
import type { Punkt6Dossier } from '../../types/schema'

// POST /punkt6-dossiers-ingest
//
// Manually triggers a mailbox check for Punkt6 dossiers, authenticated - for the
// "Postfach jetzt pruefen" button in Punkt6DossiersPanel, without waiting for the
// scheduled punkt6-dossiers-ingest-imap Flow. Only creates `punkt6_dossiers` rows
// (status='pending'); it does not process them, same split as dossiers-ingest.
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
      const dossiers = new ItemsService('punkt6_dossiers', {
        schema,
        accountability: req.accountability
      }) as unknown as ItemsServiceLike<Punkt6Dossier>
      const files = new FilesService({
        schema,
        accountability: req.accountability
      })

      try {
        const result = await ingestPunkt6DossiersFromMailbox(limit, {
          dossiers,
          uploadFile: async (buffer, filename) =>
            String(
              await files.uploadOne(Readable.from(buffer), {
                filename_download: filename,
                type: 'application/pdf'
              })
            ),
          fetchMessages: fetchDossierMessages,
          mailboxConfig: punkt6ImapConfigFromEnv(),
          logger
        })

        return res.json({ data: result })
      } catch (error) {
        logger.error(error, 'punkt6-dossiers-ingest failed')
        return next(new IngestFailedError())
      }
    }
  )
})
