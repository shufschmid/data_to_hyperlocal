// Reading the Zettelkasten — the network half.
//
// The Zettelkasten is a service in the house, not a public source: a REST door
// (`wepublish-rest/1`) in front of an evidence-bound store of both Basel
// gazettes since 2018, behind a bearer token. It is read for ONE purpose: to
// put the earlier publications about an address or a company next to the gazette
// row an editor is looking at. One request, one page, no model call.
//
// Three properties worth keeping:
//
//   1. **Off by default.** Without `ZETTELKASTEN_TOKEN` this module asks
//      nothing and answers `nicht_konfiguriert`. A newsroom that never switched
//      it on must not see errors about a door it does not have.
//   2. **One page.** An editor waits for this answer, so the timeout is six
//      seconds and there is no paging: the door reports `weitere`, and that
//      becomes `abgeschnitten` on the result instead of five more requests.
//   3. **The door refuses unknown parameters.** It derives its query parameters
//      from the tool signature and answers 400 for anything else — including
//      `format`, which it sets itself. Only documented parameters go out.
//
// Parsing and the organisations-only rule live in ./parse.

import { buildUserAgent } from '../agenda'
import { optionalEnv } from '../env'
import {
  nurOrganisationen,
  parseTreffer,
  ZettelkastenFehler,
  type Vorgeschichte
} from './parse'

export {
  nurOrganisationen,
  parseTreffer,
  rubrikVon,
  ZettelkastenFehler,
  type Vorgeschichte,
  type Vorgeschichten
} from './parse'

/** The public door of the Zettelkasten on the house's own tunnel. */
const TUER = 'https://zettelkasten-tuer.raumschiffenterprise.ch'

/** How long an editor waits before the desk gives up on the Vorgeschichte. */
const ZEITGRENZE_MS = 6_000

/**
 * How many rows one search returns.
 *
 * A Vorgeschichte is read, not scrolled. Twenty rows is already more than a
 * desk reads next to one gazette row, and the count says how many there were.
 */
const GRENZE = 20

export interface ZettelkastenKonfiguration {
  url: string
  token: string
  mandant: string
}

/**
 * The three variables, with their defaults. An empty token means off.
 *
 * `optionalEnv` rather than `requireEnv`: a missing Zettelkasten is a state
 * this newsroom runs in perfectly well, and a loud failure would be a lie.
 */
export function konfiguration(
  env: NodeJS.ProcessEnv = process.env
): ZettelkastenKonfiguration {
  return {
    url: optionalEnv('ZETTELKASTEN_URL', TUER, env).replace(/\/+$/, ''),
    token: optionalEnv('ZETTELKASTEN_TOKEN', '', env),
    mandant: optionalEnv('ZETTELKASTEN_MANDANT', 'bajour', env)
  }
}

export interface VorgeschichteFrage {
  /** FTS expression over title and content, e.g. an address or a company. */
  suche?: string
  /** One sub-rubric, e.g. `BP-BL05` for building applications in Baselland. */
  rubrik?: string
  /** Only from this publication date, ISO. */
  von?: string
  /** Only this municipality, as its BFS number. */
  gemeindeBfs?: number
}

export interface VorgeschichteOptionen extends ZettelkastenKonfiguration {
  kontakt: string
  fetchImpl?: typeof fetch
}

export type VorgeschichteErgebnis =
  | { status: 'nicht_konfiguriert' }
  | {
      status: 'ok'
      treffer: Vorgeschichte[]
      /** What the door found, before the organisations-only filter. */
      gesamt: number
      /** True when the door has more rows than it returned. */
      abgeschnitten: boolean
      vorbehalt: string
    }

/**
 * The earlier publications about a search term, organisations only.
 *
 * Throws `ZettelkastenFehler` when the door answers badly — the caller decides
 * what a missing Vorgeschichte costs, and at the desk it costs nothing: the
 * section stays empty and the run carries on (fail-open per row).
 */
export async function sucheVorgeschichte(
  frage: VorgeschichteFrage,
  optionen: VorgeschichteOptionen
): Promise<VorgeschichteErgebnis> {
  if (optionen.token.trim() === '') return { status: 'nicht_konfiguriert' }

  const such = new URLSearchParams()
  if (frage.suche !== undefined && frage.suche.trim() !== '')
    such.set('suche', frage.suche.trim())
  if (frage.gemeindeBfs !== undefined)
    such.set('gemeinde_bfs', String(frage.gemeindeBfs))
  // The door refuses a search that is neither a term nor a municipality, and it
  // is right to: a rubric and a date alone are a full dump of five years. Said
  // here too, so the refusal costs no request.
  if (!such.has('suche') && !such.has('gemeinde_bfs'))
    throw new ZettelkastenFehler(
      'Eine Vorgeschichte braucht einen Suchausdruck oder eine Gemeinde.'
    )
  if (frage.rubrik !== undefined && frage.rubrik !== '')
    such.set('rubrik', frage.rubrik)
  if (frage.von !== undefined && frage.von !== '') such.set('von', frage.von)
  such.set('grenze', String(GRENZE))

  const url =
    `${optionen.url}/api/v1/mandanten/${encodeURIComponent(optionen.mandant)}` +
    `/publikation_suche?${such.toString()}`

  const fetchImpl = optionen.fetchImpl ?? fetch
  let antwort: Response
  try {
    antwort = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${optionen.token}`,
        'User-Agent': buildUserAgent(optionen.kontakt),
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(ZEITGRENZE_MS)
    })
  } catch (cause) {
    throw new ZettelkastenFehler(
      `Die Tuer des Zettelkastens antwortete nicht: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`
    )
  }

  if (antwort.status === 401 || antwort.status === 403)
    throw new ZettelkastenFehler(
      `Die Tuer des Zettelkastens wies das Token ab (HTTP ${antwort.status}). ` +
        `Traegt ZETTELKASTEN_TOKEN das Token fuer den Mandanten ` +
        `${optionen.mandant}?`
    )
  if (!antwort.ok)
    throw new ZettelkastenFehler(
      `Die Tuer des Zettelkastens antwortete mit HTTP ${antwort.status}.`
    )

  let json: unknown
  try {
    json = await antwort.json()
  } catch {
    throw new ZettelkastenFehler(
      'Die Tuer des Zettelkastens antwortete nicht mit JSON.'
    )
  }

  const gelesen = parseTreffer(json)
  return {
    status: 'ok',
    treffer: nurOrganisationen(gelesen.treffer),
    gesamt: gelesen.gesamt,
    abgeschnitten: gelesen.weitere,
    vorbehalt: gelesen.vorbehalt
  }
}
