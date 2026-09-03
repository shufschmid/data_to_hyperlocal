// Reading simap.ch — the network half.
//
// simap.ch is the joint public procurement platform of the Confederation and
// the cantons. The project search and the publication details are open: no
// login, no key, a documented OpenAPI spec at /api/specifications/simap.yaml.
// We identify ourselves, read once a day, and only what belongs to the
// municipalities an editor registered.
//
// Two things measured on 2 September 2026 and worth keeping:
//
//   1. `https://simap.ch` answers 301 to the www host, and the SPA link needs
//      the language segment (`/de/project-detail/…`; without it, 302).
//   2. The search REQUIRES either a text query or one of the two quick-filters
//      (`issuedByOrganizations`, `projectSubTypes`). A filter-only request
//      without one of those is refused — which is why the Erfüllungsort query
//      carries the full subtype list rather than no quick-filter at all.
//
// Parsing lives in ./parse and is pure.

import { buildUserAgent } from '../agenda'
import { parseSuche, type SimapProjekt, type SimapSuchergebnis } from './parse'

export {
  angabenAusDetail,
  fristAusDetail,
  kantonVonBezirk,
  ordneZuErfuellungsort,
  parseSuche,
  projektIdAusLink,
  pubTypText,
  textVon,
  webLink,
  type SimapAdresse,
  type SimapGemeinde,
  type SimapProjekt,
  type SimapSuchergebnis
} from './parse'

const BASIS = 'https://www.simap.ch/api'

/**
 * Every order subtype simap knows, from `ProjectSubType` in its own spec.
 *
 * Needed as a quick-filter so the place-of-performance query is legal at all
 * (see the header). Listing them all means "no restriction by subtype" — the
 * newsroom wants every kind, and the triage sorts.
 */
const ALLE_UNTERTYPEN = [
  'construction',
  'service',
  'supply',
  'project_competition',
  'idea_competition',
  'overall_performance_competition',
  'project_study',
  'idea_study',
  'overall_performance_study',
  'request_for_information'
] as const

export class SimapFehler extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message)
    this.name = 'SimapFehler'
  }
}

export interface AbrufOptionen {
  kontakt: string
  fetchImpl?: typeof fetch
}

/**
 * One request, with the same manners as the gazette connector: identified,
 * never overlapping its own requests, spaced retries, and a 4xx taken as an
 * answer rather than a hiccup.
 */
async function hole(
  url: string,
  options: AbrufOptionen,
  versuche = 3
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch
  let zuletzt: unknown = null

  for (let i = 0; i < versuche; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 4000 * 2 ** (i - 1)))
    try {
      const antwort = await fetchImpl(url, {
        headers: {
          'User-Agent': buildUserAgent(options.kontakt),
          Accept: 'application/json',
          'Accept-Language': 'de-CH,de;q=0.9'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(60_000)
      })
      if (antwort.ok) return antwort.json()
      if (antwort.status < 500)
        throw new SimapFehler(`simap.ch antwortete mit ${antwort.status}.`, url)
      zuletzt = new SimapFehler(`HTTP ${antwort.status}`, url)
    } catch (cause) {
      if (cause instanceof SimapFehler && !cause.message.startsWith('HTTP'))
        throw cause
      zuletzt = cause
    }
  }

  throw new SimapFehler(
    `simap.ch nach ${versuche} Versuchen nicht erreichbar: ` +
      `${zuletzt instanceof Error ? zuletzt.message : String(zuletzt)}`,
    url
  )
}

/**
 * How many pages one query walks. 20 rows a page.
 *
 * Measured: a whole MONTH of BL+BS+SO procurement is about 100 publications,
 * so at the daily two-day look-back a query sees well under one page. Five is
 * therefore generous — but it is a cap, and a cap that is reached silently
 * loses rows, so `sucheAlle` says when it hits it.
 */
const MAX_SEITEN = 5

/** What one search returned, and whether the page cap cut it short. */
export interface SimapSuche {
  projekte: SimapProjekt[]
  /**
   * True when there were more pages than MAX_SEITEN.
   *
   * Reported, never thrown: the rows already read are perfectly good, and
   * throwing them away would cost more than the missing tail. The run puts
   * this on the source row so the banner says it — an absence is otherwise
   * indistinguishable from "nothing was published".
   */
  abgeschnitten: boolean
}

async function sucheAlle(
  params: URLSearchParams,
  options: AbrufOptionen
): Promise<SimapSuche> {
  const alle: SimapProjekt[] = []
  const gesehen = new Set<string>()
  let weiter: string | null = null
  let abgeschnitten = false

  for (let seite = 0; seite < MAX_SEITEN; seite++) {
    const such = new URLSearchParams(params)
    if (weiter !== null) such.set('lastItem', weiter)
    const url = `${BASIS}/publications/v2/project/project-search?${such.toString()}`
    // Sequential on purpose, like the gazette connector.
    const ergebnis: SimapSuchergebnis = parseSuche(await hole(url, options))

    let neue = 0
    for (const p of ergebnis.projekte) {
      // The cursor is (date|projectNumber), so the row it points at comes back
      // on the next page — dedup here rather than trusting the pagination.
      if (gesehen.has(p.publicationId)) continue
      gesehen.add(p.publicationId)
      alle.push(p)
      neue += 1
    }

    weiter = ergebnis.weiter
    if (weiter === null || neue === 0) break
    // Still a cursor after the last allowed page: there is more than we read.
    if (seite === MAX_SEITEN - 1) abgeschnitten = true
  }

  return { projekte: alle, abgeschnitten }
}

/**
 * What one municipality's own procurement offices published since a date.
 *
 * Asked PER MUNICIPALITY rather than for all offices at once, although the
 * filter would take every uuid in one request: a search row names the office
 * only by `procOfficeName`, so a combined query would have to attribute rows
 * back to municipalities by name — the very thing that goes wrong here
 * ("Gemeinde Reinach" exists in two cantons). One request per municipality
 * gives the attribution by construction.
 */
export async function fetchVergabestellen(
  vergabestellen: readonly string[],
  seit: string,
  options: AbrufOptionen
): Promise<SimapSuche> {
  if (vergabestellen.length === 0) return { projekte: [], abgeschnitten: false }
  const such = new URLSearchParams()
  such.set('issuedByOrganizations', vergabestellen.join(','))
  such.set('newestPublicationFrom', seit)
  return sucheAlle(such, options)
}

/**
 * Everything published since a date whose place of performance is in one of the
 * given cantons — the half that catches what the CANTON or the Confederation
 * builds in one of our municipalities, which is local news the municipality
 * itself never publishes.
 *
 * The postcode match happens in `ordneZuErfuellungsort`, not here: the API
 * filters by canton, and only our own `gemeinden.plz` can tell Reinach BL from
 * Reinach AG.
 */
export async function fetchErfuellungsort(
  kantone: readonly string[],
  seit: string,
  options: AbrufOptionen
): Promise<SimapSuche> {
  if (kantone.length === 0) return { projekte: [], abgeschnitten: false }
  const such = new URLSearchParams()
  for (const t of ALLE_UNTERTYPEN) such.append('projectSubTypes', t)
  such.set('orderAddressCantons', kantone.join(','))
  such.set('newestPublicationFrom', seit)
  return sucheAlle(such, options)
}

/** One publication in full — the facts a Meldung is written from. */
export async function fetchDetail(
  projektId: string,
  publikationsId: string,
  options: AbrufOptionen
): Promise<unknown> {
  const url =
    `${BASIS}/publications/v1/project/${projektId}` +
    `/publication-details/${publikationsId}`
  return hole(url, options)
}
