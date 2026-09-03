import { defineEndpoint } from '@directus/extensions-sdk'
import type { Filter } from '@directus/types'
import { envFlag } from '../../shared/env'
import { verdrahte, type Deps, type RouterLike } from './routen'
import type { Abfrage } from './routen'
import type { GemeindeZeile, Rohzeile } from './projektion'

// The public read-only API for the published articles, mounted at `/api/v1/…`.
//
// Wiring only: every rule lives next door — the routes in `register.ts`, the
// checks in `parameter.ts`, the shape in `projektion.ts`, the handlers in
// `routen.ts`. That split is what lets the whole API be tested without a
// database.
//
// DELIBERATELY PUBLIC, and gated by one explicit switch (`BLOG_API_OFFEN`).
// The safety argument is the same as for `/redaktion/blog` and it is the
// narrowness of the projection, not the caller: the filter is hard-wired to
// `status = publiziert`, the field list names only what a reader may see, and
// `datengrundlage` is read but never returned (`projektion` drops it — for a
// statistics article it holds sixty raw rows of working material). The service
// runs as the system because an anonymous caller has no accountability to act
// under.
//
// The contract for consumers is apps/directus/SCHNITTSTELLE.md.

/** Only what a reader may see. Nothing here is a draft, a token or a note. */
const FELDER = [
  'id',
  'titel',
  'lead',
  'text',
  'publiziert_am',
  'erscheint_am',
  'perle',
  // The dataset behind a statistics run — that is where its source address is
  // derived from (`statistikUrl`). The article's own text often carries none.
  'lauf.datensatz.externe_id',
  'lauf.datensatz.quelle.typ',
  'lauf.datensatz.ankuendigung.link',
  'kandidat',
  'sendungskandidat',
  'amtsblattmeldung.quelle_typ',
  'spiel.sportart',
  'spiel.wettbewerb',
  'spiel.heim',
  'spiel.gast',
  'spiel.tore_heim',
  'spiel.tore_gast',
  'spiel.datum',
  'gemeinde.id',
  'gemeinde.name',
  'gemeinde.bfs_nummer',
  // Read for the source computation, never delivered.
  'datengrundlage'
] as const

export default defineEndpoint(
  (router, { services, database, getSchema, logger }) => {
    const { ItemsService } = services

    /**
     * The conditions of a query, in ONE place so the list and the count cannot
     * drift. Two queries with their own conditions means two truths on the day
     * someone touches only one of them.
     */
    function filterVon(abfrage: Abfrage): Filter {
      const filter: Filter = {
        status: { _eq: 'publiziert' }
      }
      if (abfrage.id !== undefined) filter['id'] = { _eq: abfrage.id }
      if (abfrage.gemeinde !== undefined)
        filter['gemeinde'] = { _eq: abfrage.gemeinde.id }
      if (abfrage.seit !== undefined)
        filter['publiziert_am'] = { _gte: abfrage.seit }
      return filter
    }

    async function meldungen(): Promise<InstanceType<typeof ItemsService>> {
      return new ItemsService('meldungen', { schema: await getSchema() })
    }

    const deps: Deps = {
      async ladeArtikel(abfrage) {
        const dienst = await meldungen()
        return (await dienst.readByQuery({
          filter: filterVon(abfrage),
          fields: [...FELDER],
          sort: ['-publiziert_am'],
          limit: abfrage.grenze,
          offset: abfrage.versatz
        })) as unknown as Rohzeile[]
      },

      async zaehleArtikel(abfrage) {
        const dienst = await meldungen()
        const zaehlung = (await dienst.readByQuery({
          filter: filterVon(abfrage),
          aggregate: { count: ['id'] }
        })) as unknown as { count?: { id?: unknown } }[]
        // Postgres answers a count as a string through this path — parsed
        // defensively so a shape change becomes 0 rather than NaN in the body.
        const roh = zaehlung[0]?.count?.id
        const zahl = Number(roh)
        return Number.isFinite(zahl) ? zahl : 0
      },

      async ladeGemeinden() {
        const dienst = new ItemsService('gemeinden', {
          schema: await getSchema()
        })
        return (await dienst.readByQuery({
          filter: { aktiv: { _eq: true } },
          fields: ['id', 'name', 'bfs_nummer', 'bezirk'],
          sort: ['name'],
          limit: -1
        })) as unknown as GemeindeZeile[]
      },

      async datenbankBereit() {
        try {
          await database.raw('select 1')
          return true
        } catch (problem) {
          logger.error(problem, 'api: Datenbank nicht erreichbar')
          return false
        }
      },

      // Read per request: switching the API on or off is an environment change
      // and a restart, never a code change.
      istOffen: () => envFlag('BLOG_API_OFFEN'),
      jetzt: () => new Date().toISOString(),
      logger
    }

    verdrahte(router as unknown as RouterLike, deps)
  }
)
