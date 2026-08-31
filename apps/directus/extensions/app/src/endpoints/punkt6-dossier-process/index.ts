import { createError, ErrorCode, isDirectusError } from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import type { NextFunction, Response } from 'express'
import { buffer } from 'node:stream/consumers'
import {
  processPunkt6Dossier,
  type ItemsServiceLike
} from '../../punkt6/process-punkt6-dossier'
import { createTelebaselClient } from '../../punkt6/telebasel-client'
import { isAuthenticated, type ApiRequest } from '../../shared/http'
import type { Punkt6Dossier, Punkt6Edition } from '../../types/schema'
import { sichteSendung } from '../../redaktion/sendunglauf'

// POST /punkt6-dossier-process/:id
//
// Manually triggers processPunkt6Dossier for one punkt6_dossiers row,
// authenticated - for testing without waiting for the
// punkt6-dossiers-process-pending Flow's schedule. Same shape as
// dossier-process: reads through a service (so permissions apply), does the
// work, returns the result. The actual PDF parsing / telebasel.ch resolution /
// Claude lead generation all live in ../../punkt6/process-punkt6-dossier, shared
// with the scheduled operation - this file is wiring only.

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
// One error for "does not exist" and "not yours", on purpose - see dossier-process
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
      const dossiers = new ItemsService('punkt6_dossiers', {
        schema,
        accountability: req.accountability
      }) as unknown as ItemsServiceLike<Punkt6Dossier>
      const editions = new ItemsService('punkt6_editions', {
        schema,
        accountability: req.accountability
      }) as unknown as ItemsServiceLike<Punkt6Edition>
      const assets = new AssetsService({
        schema,
        accountability: req.accountability
      })

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

        // Die Gemeinde-Sichtung haengt hinten dran und kann die Durchsicht
        // nicht gefaehrden: sie faengt ihre Fehler selbst.
        await sichteSendung(
          result.editionId === null ? [] : [result.editionId],
          'punkt6',
          {
            editions: editions as never,
            kandidaten: new ItemsService('sendungskandidaten', {
              schema
            }) as never,
            gemeinden: new ItemsService('gemeinden', { schema }) as never,
            logger
          }
        )

        return res.json({ data: result })
      } catch (error) {
        // processPunkt6Dossier's own readOne (a Directus service call) throws
        // ForbiddenError for a dossier that's missing *or* not readable by the
        // caller, and for a malformed key - same posture as dossier-process.
        if (isDirectusError(error, ErrorCode.Forbidden))
          return next(new DossierAccessError())

        logger.error(error, `punkt6-dossier-process failed for dossier ${id}`)
        return next(new ProcessingFailedError())
      }
    }
  )
})
