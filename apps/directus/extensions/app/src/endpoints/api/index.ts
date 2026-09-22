import { defineEndpoint } from '@directus/extensions-sdk'
import type { Filter } from '@directus/types'
import { envFlag, optionalEnv } from '../../shared/env'
import { verdrahte, type Deps, type RouterLike } from './routen'
import type { Abfrage } from './routen'
import type { GemeindeZeile, Korrekturzeile, Rohzeile } from './projektion'
import type { BilanzZeile } from '../../redaktion/bilanz'

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
  // When the article counts, and whether it is announced early — the two
  // fields `termin` is computed from on the way out.
  'termin',
  'wichtig',
  // The dataset behind a statistics run — that is where its source address is
  // derived from (`statistikUrl`). The article's own text often carries none.
  'lauf.datensatz.externe_id',
  'lauf.datensatz.quelle.typ',
  // Which portal, and whose office — a second statistics portal must not be
  // delivered under the first one's address or the first one's office name.
  'lauf.datensatz.quelle.basis_url',
  'lauf.datensatz.quelle.konfiguration',
  'lauf.datensatz.ankuendigung.link',
  'kandidat',
  'sendungskandidat',
  // The second kind of statistics article; its address lives in
  // `datengrundlage`, not behind a run.
  'suedanflugquote',
  'abstimmung',
  'amtsblattmeldung.quelle_typ',
  'gemeindemitteilung',
  'veranstaltung',
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
  // The Pruefsiegel's own parts: what the checks said, whether a counter-check
  // answered, and whose signature stands under the publication.
  'zeit_warnungen',
  'entscheidung',
  'freigegeben_am',
  'publiziert_durch',
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

    /**
     * The conditions of a retraction query. Deliberately its own function: the
     * two share a shape but not a meaning — `seit` means `publiziert_am` for an
     * article and `zurueckgezogen_am` for a retraction, and folding them into
     * one filter would make that difference an argument nobody reads.
     *
     * `publiziert_am` must be set: an article that never went out cannot be
     * taken back. `zurueckgezogen_am` must be too, which is what keeps the
     * retractions from before this field existed out of the list — reporting
     * them without a date would be a guess.
     */
    function korrekturFilterVon(abfrage: Abfrage): Filter {
      const filter: Filter = {
        status: { _in: ['entwurf', 'verworfen'] },
        publiziert_am: { _nnull: true },
        zurueckgezogen_am: { _nnull: true }
      }
      if (abfrage.seit !== undefined)
        filter['zurueckgezogen_am'] = { _gte: abfrage.seit }
      return filter
    }

    /**
     * Everything the balance has to look at: what waits, plus what carries a
     * stamp inside the window.
     *
     * A day of slack on the window, and deliberately: this filter uses the
     * database's clock, the counting uses `deps.jetzt()`, and a row exactly on
     * the edge must not fall between the two. The pure function filters by the
     * stamps again, so a row too many costs nothing and a row too few would be a
     * wrong number.
     */
    function bilanzFilterVon(fensterTage: number): Filter {
      const ab = new Date(
        Date.now() - (fensterTage + 1) * 86_400_000
      ).toISOString()
      return {
        _or: [
          { status: { _in: ['entwurf', 'in_pruefung', 'freigegeben'] } },
          { publiziert_am: { _gte: ab } },
          { freigegeben_am: { _gte: ab } },
          { zurueckgezogen_am: { _gte: ab } }
        ]
      }
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

      async ladeKorrekturen(abfrage) {
        const dienst = await meldungen()
        return (await dienst.readByQuery({
          filter: korrekturFilterVon(abfrage),
          fields: [
            'id',
            'titel',
            'status',
            'publiziert_am',
            'zurueckgezogen_am',
            'gemeinde.id',
            'gemeinde.name',
            'gemeinde.bfs_nummer'
          ],
          sort: ['-zurueckgezogen_am'],
          limit: abfrage.grenze,
          offset: abfrage.versatz
        })) as unknown as Korrekturzeile[]
      },

      async zaehleKorrekturen(abfrage) {
        const dienst = await meldungen()
        const zaehlung = (await dienst.readByQuery({
          filter: korrekturFilterVon(abfrage),
          aggregate: { count: ['id'] }
        })) as unknown as { count?: { id?: unknown } }[]
        const roh = zaehlung[0]?.count?.id
        const zahl = Number(roh)
        return Number.isFinite(zahl) ? zahl : 0
      },

      async ladeBilanzZeilen(fensterTage) {
        const dienst = await meldungen()
        // No limit, on purpose: a capped read would quietly produce a wrong
        // number instead of a missing one, and there is no way for a reader to
        // tell. The window is bounded at a year and the field list is twelve
        // scalar columns, which is what keeps this affordable.
        return (await dienst.readByQuery({
          filter: bilanzFilterVon(fensterTage),
          fields: [
            'status',
            'lauf',
            'spiel',
            'kandidat',
            'amtsblattmeldung',
            'gemeindemitteilung',
            'veranstaltung',
            'sendungskandidat',
            'suedanflugquote',
            'abstimmung',
            'erscheint_am',
            'date_created',
            'freigegeben_am',
            'publiziert_am',
            'zurueckgezogen_am'
          ],
          limit: -1
        })) as unknown as BilanzZeile[]
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
      // Unset is not a failure, it is an unnamed house: the API keeps serving
      // and says so, exactly as `CRAWLER_KEY` does for the sport feeds.
      medium: () => optionalEnv('REDAKTION_MEDIUM', 'unbenannt'),
      jetzt: () => new Date().toISOString(),
      logger
    }

    verdrahte(router as unknown as RouterLike, deps)
  }
)
