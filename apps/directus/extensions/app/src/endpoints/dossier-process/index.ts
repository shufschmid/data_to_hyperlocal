import { createError, ErrorCode, isDirectusError } from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import type { NextFunction, Response } from 'express'
import { buffer } from 'node:stream/consumers'
import {
  processDossier,
  type ItemsServiceLike
} from '../../dossiers/process-dossier'
import { createSrgssrClient } from '../../dossiers/srgssr-client'
import { optionalEnv } from '../../shared/env'
import { isAuthenticated, type ApiRequest } from '../../shared/http'
import type { Dossier, Edition } from '../../types/schema'
import { sichteSendung } from '../../redaktion/sendunglauf'

// POST /dossier-process/:id
//
// Manually triggers processDossier for one dossier, authenticated - for testing
// without waiting for the dossiers-process-pending Flow's schedule. Same shape as
// notes-summary: reads through a service (so permissions apply), does the work,
// returns the result. The actual PDF parsing / SRGSSR resolution / Claude topic
// extraction all live in ../../dossiers/process-dossier, shared with the
// scheduled operation - this file is wiring only.

const NotSignedInError = createError(
  'FORBIDDEN',
  'Anmeldung erforderlich.',
  401
)
const InvalidDossierIdError = createError(
  'INVALID_DOSSIER_ID',
  'Ungueltige Dossier-ID.',
  400
)
// One error for "does not exist" and "not yours", on purpose - see notes-summary
// for why this ambiguity is deliberate (it stops a caller probing which ids exist).
const DossierAccessError = createError(
  'FORBIDDEN',
  'Dossier nicht gefunden oder nicht freigegeben.',
  403
)
const ProcessingFailedError = createError(
  'PROCESSING_FAILED',
  'Die Verarbeitung ist fehlgeschlagen.',
  502
)

export default defineEndpoint((router, { services, getSchema, logger }) => {
  const { ItemsService, AssetsService } = services

  router.post(
    '/:id',
    async (req: ApiRequest, res: Response, next: NextFunction) => {
      if (!isAuthenticated(req)) return next(new NotSignedInError())

      const id = req.params['id']
      if (id === undefined || id === '')
        return next(new InvalidDossierIdError())

      const schema = await getSchema()
      // Passing accountability makes every read/write obey the caller's permissions,
      // same as notes-summary.
      const dossiers = new ItemsService('dossiers', {
        schema,
        accountability: req.accountability
      }) as unknown as ItemsServiceLike<Dossier>
      const editions = new ItemsService('editions', {
        schema,
        accountability: req.accountability
      }) as unknown as ItemsServiceLike<Edition>
      const assets = new AssetsService({
        schema,
        accountability: req.accountability
      })

      try {
        // Deliberately optionalEnv, not requireEnv: missing/wrong credentials must
        // fail per segment (resolveEpisode throws, resolveSegmentEpisode records it
        // as resolution_error) rather than aborting the whole dossier - see the
        // SRGSSR section of the root .env.example.
        const showId = optionalEnv('SRGSSR_SHOW_ID', '')
        const srgssrClient = createSrgssrClient({
          clientId: optionalEnv('SRGSSR_CLIENT_ID', ''),
          clientSecret: optionalEnv('SRGSSR_CLIENT_SECRET', ''),
          showId: showId === '' ? null : showId
        })

        const result = await processDossier(id, {
          dossiers,
          editions,
          readSourceFile: async (fileId) => {
            const { stream } = await assets.getAsset(fileId)
            return buffer(stream)
          },
          srgssrClient,
          logger
        })

        // Die Gemeinde-Sichtung haengt hinten dran und kann die Durchsicht
        // nicht gefaehrden: sie faengt ihre Fehler selbst.
        await sichteSendung(result.editionIds, 'regionaljournal', {
          editions: editions as never,
          kandidaten: new ItemsService('sendungskandidaten', {
            schema
          }) as never,
          gemeinden: new ItemsService('gemeinden', { schema }) as never,
          logger
        })

        return res.json({ data: result })
      } catch (error) {
        // processDossier's own readOne (a Directus service call) throws
        // ForbiddenError for a dossier that's missing *or* not readable by the
        // caller, and for a malformed key - same posture as notes-summary.
        if (isDirectusError(error, ErrorCode.Forbidden))
          return next(new DossierAccessError())

        logger.error(error, `dossier-process failed for dossier ${id}`)
        return next(new ProcessingFailedError())
      }
    }
  )
})
