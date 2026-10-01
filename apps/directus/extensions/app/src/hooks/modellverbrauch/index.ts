import { defineHook } from '@directus/extensions-sdk'
import {
  registriereEinstellungen,
  registriereVerbrauch,
  tischVon,
  type Modellaufruf,
  type Modelleinstellung
} from '../../shared/claude'

// Every call to the Claude API leaves one row in `modellaufrufe`, and reads
// the newsroom's setting for its purpose from `modelleinstellungen`.
//
// The newsroom asked on 30 September 2026 to MEASURE before saving, and on
// 1 October to set model and budget per desk from the cost table itself.
// `shared/claude.ts` is the one client and sees every call, but it
// deliberately has no Directus services — so this hook hands it a writer and
// a reader at boot. The client records fire-and-forget (a lost row is a
// warning, never a failed call) and reads settings from a sixty-second
// cache that any write to `modelleinstellungen` empties, so a change in
// «Kosten» reaches the next call and not the next hour. Both run as the
// system: a usage record belongs to no user, and a setting to the house.

interface Dienst {
  createOne(payload: Record<string, unknown>): Promise<unknown>
  readByQuery(query: Record<string, unknown>): Promise<unknown>
}

interface EinstellungsZeile {
  zweck: string
  modell: string | null
  max_tokens: number | null
}

/** How long a loaded settings table is trusted before it is read again. */
export const EINSTELLUNGEN_CACHE_MS = 60_000

/**
 * The exact purpose wins over the desk, the desk over nothing — pure, so the
 * rule is tested without a database.
 */
export function einstellungAus(
  zeilen: ReadonlyMap<string, EinstellungsZeile>,
  zweck: string
): Modelleinstellung | null {
  const treffer = zeilen.get(zweck) ?? zeilen.get(tischVon(zweck))
  if (treffer === undefined) return null
  return {
    modell: treffer.modell ?? null,
    max_tokens: treffer.max_tokens ?? null
  }
}

export default defineHook(({ action }, { services, getSchema, logger }) => {
  const ItemsService = services.ItemsService as new (
    collection: string,
    options: unknown
  ) => Dienst

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

  let cache: {
    geladen: number
    zeilen: Map<string, EinstellungsZeile>
  } | null = null
  const leeren = (): void => {
    cache = null
  }
  for (const ereignis of ['create', 'update', 'delete'])
    action(`modelleinstellungen.items.${ereignis}`, leeren)

  registriereEinstellungen(async (zweck: string) => {
    if (cache === null || Date.now() - cache.geladen > EINSTELLUNGEN_CACHE_MS) {
      const dienst = new ItemsService('modelleinstellungen', {
        schema: await getSchema()
      })
      const zeilen = (await dienst.readByQuery({
        fields: ['zweck', 'modell', 'max_tokens'],
        limit: -1
      })) as EinstellungsZeile[]
      cache = {
        geladen: Date.now(),
        zeilen: new Map(zeilen.map((z) => [z.zweck, z]))
      }
    }
    return einstellungAus(cache.zeilen, zweck)
  })
})
