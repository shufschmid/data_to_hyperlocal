import { defineHook } from '@directus/extensions-sdk'
import {
  registriereVerbrauch,
  tischVon,
  type Modellaufruf
} from '../../shared/claude'

// Every call to the Claude API leaves one row in `modellaufrufe`.
//
// The newsroom asked on 30 September 2026 to MEASURE before saving: which
// desk spends what. `shared/claude.ts` is the one client and sees every
// call's usage, but it deliberately has no Directus services — so this hook
// hands it a writer at boot, and the client records fire-and-forget. A lost
// row is a warning in the log, never a failed call; the row is written as
// the system, because a usage record belongs to no user.

interface ModellaufrufeService {
  createOne(payload: Record<string, unknown>): Promise<unknown>
}

export default defineHook((_register, { services, getSchema, logger }) => {
  const ItemsService = services.ItemsService as new (
    collection: string,
    options: unknown
  ) => ModellaufrufeService

  let gewarnt = false
  registriereVerbrauch(async (eintrag: Modellaufruf) => {
    try {
      const aufrufe = new ItemsService('modellaufrufe', {
        schema: await getSchema()
      })
      await aufrufe.createOne({ ...eintrag, tisch: tischVon(eintrag.zweck) })
    } catch (fehler) {
      // Once per process: a missing collection would otherwise warn on every
      // call, and the call itself is unaffected either way.
      if (!gewarnt) {
        gewarnt = true
        logger.warn(fehler, 'modellverbrauch: Aufruf nicht vermerkt.')
      }
    }
  })
})
