// The route register — one data structure that drives BOTH the wiring and the
// documentation.
//
// That is rule R15 of the `wepublish-rest/1` convention, and it exists because
// of the most common failure of a documented API: someone adds a route and
// forgets the hand-written list, so the description lies. Here the router is
// built from this array (`routen.ts`) and so are `/beschreibung` and
// `/openapi.json` — a route that is not in the register does not exist, and one
// that is in it cannot be undocumented. A test compares both directions.

export const DIENST = 'redaktion'
export const API = 'v1'
export const KONVENTION = 'wepublish-rest/1'

/**
 * Hardcoded rather than read from the bundle's package.json: importing that
 * crosses the TypeScript `rootDir` and depends on how the extension bundler
 * inlines JSON. One string is not worth that risk.
 */
export const VERSION = '1.0.0'

/** Everything this API serves is public — see R4a and `BLOG_API_OFFEN`. */
export const MERKMAL = 'keines'

/** Paging bounds, documented in the contract and enforced in `parameter.ts`. */
export const GRENZE_VORGABE = 100
export const GRENZE_HOECHST = 500

export interface ParameterDoku {
  name: string
  ort: 'query' | 'pfad'
  typ: string
  beschreibung: string
  obligatorisch: boolean
}

export interface RouteEintrag {
  /** Express form, relative to the endpoint mount: `/v1/artikel/:id`. */
  pfad: string
  methoden: readonly ['GET']
  zweck: string
  merkmal_noetig: 'keines'
  /**
   * Whether this route serves CONTENT. The three open ways of R3 do not, which
   * is why they answer even while the API is switched off — a monitor has to be
   * able to ask what is wrong.
   */
  inhalt: boolean
  parameter: readonly ParameterDoku[]
}

const BLAETTERN: readonly ParameterDoku[] = [
  {
    name: 'grenze',
    ort: 'query',
    typ: 'integer',
    beschreibung: `Wie viele Beitraege eine Antwort hoechstens enthaelt (1 bis ${GRENZE_HOECHST}, Vorgabe ${GRENZE_VORGABE}).`,
    obligatorisch: false
  },
  {
    name: 'versatz',
    ort: 'query',
    typ: 'integer',
    beschreibung: 'Wie viele Beitraege uebersprungen werden (ab 0).',
    obligatorisch: false
  }
]

export const REGISTER: readonly RouteEintrag[] = [
  {
    pfad: '/v1/gesundheit',
    methoden: ['GET'],
    zweck: 'Sagt, ob der Dienst traegt und ob die Schnittstelle offen ist.',
    merkmal_noetig: 'keines',
    inhalt: false,
    parameter: []
  },
  {
    pfad: '/v1/beschreibung',
    methoden: ['GET'],
    zweck: 'Nennt jeden Endpunkt mit seinem Zweck und seinen Parametern.',
    merkmal_noetig: 'keines',
    inhalt: false,
    parameter: []
  },
  {
    pfad: '/v1/openapi.json',
    methoden: ['GET'],
    zweck: 'Das maschinenlesbare Schema dieser Schnittstelle.',
    merkmal_noetig: 'keines',
    inhalt: false,
    parameter: []
  },
  {
    pfad: '/v1/artikel',
    methoden: ['GET'],
    zweck:
      'Die publizierten Beitraege, neueste zuerst. Nur Publiziertes — Entwuerfe verlassen das Haus nie.',
    merkmal_noetig: 'keines',
    inhalt: true,
    parameter: [
      {
        name: 'gemeinde',
        ort: 'query',
        typ: 'string',
        beschreibung:
          'Gemeinde-Kennung (Slug), etwa "muenchenstein". Die gueltigen Werte nennt /api/v1/gemeinden.',
        obligatorisch: false
      },
      {
        name: 'seit',
        ort: 'query',
        typ: 'string (JJJJ-MM-TT)',
        beschreibung:
          'Nur Beitraege, die an diesem Tag oder danach publiziert wurden. Einschliesslich, ab 00:00 UTC.',
        obligatorisch: false
      },
      ...BLAETTERN
    ]
  },
  {
    pfad: '/v1/artikel/:id',
    methoden: ['GET'],
    zweck:
      'Ein einzelner publizierter Beitrag, in derselben Form wie in der Liste.',
    merkmal_noetig: 'keines',
    inhalt: true,
    parameter: [
      {
        name: 'id',
        ort: 'pfad',
        typ: 'string (uuid)',
        beschreibung: 'Die Kennung des Beitrags.',
        obligatorisch: true
      }
    ]
  },
  {
    pfad: '/v1/gemeinden',
    methoden: ['GET'],
    zweck:
      'Die bespielten Gemeinden mit ihren Kennungen — damit ein Abnehmer weiss, wonach er fragen darf.',
    merkmal_noetig: 'keines',
    inhalt: true,
    parameter: []
  }
] as const

/**
 * The path as a reader sees it: Express' `:id` becomes OpenAPI's `{id}`, and
 * the endpoint's own mount point is prefixed. Directus mounts a bundle's
 * endpoint entry under its name, so the entry `api` plus `/v1/artikel` is
 * `/api/v1/artikel`.
 */
export function dokuPfad(pfad: string): string {
  return `/api${pfad.replace(/:([a-z_]+)/gi, '{$1}')}`
}

export interface Gesundheit {
  dienst: string
  version: string
  api: string
  konvention: string
  zeit: string
  bereit: boolean
  merkmal: string
  datenbank: boolean
  offen: boolean
}

/**
 * `bereit` is false when the API is switched off, and that is R5 read
 * literally: a service that is not serving says so, rather than reporting
 * health while every content path answers 503. The two separate booleans say
 * WHICH of the two reasons it is, so nobody has to guess.
 */
export function buildGesundheit(zustand: {
  datenbank: boolean
  offen: boolean
  zeit: string
}): Gesundheit {
  return {
    dienst: DIENST,
    version: VERSION,
    api: API,
    konvention: KONVENTION,
    zeit: zustand.zeit,
    bereit: zustand.datenbank && zustand.offen,
    merkmal: MERKMAL,
    datenbank: zustand.datenbank,
    offen: zustand.offen
  }
}

export function buildBeschreibung(): Record<string, unknown> {
  return {
    dienst: DIENST,
    version: VERSION,
    api: API,
    konvention: KONVENTION,
    merkmal: MERKMAL,
    openapi: dokuPfad('/v1/openapi.json'),
    endpunkte: REGISTER.map((eintrag) => ({
      pfad: dokuPfad(eintrag.pfad),
      methoden: [...eintrag.methoden],
      zweck: eintrag.zweck,
      merkmal_noetig: eintrag.merkmal_noetig,
      ...(eintrag.parameter.length === 0
        ? {}
        : { parameter: eintrag.parameter.map((p) => ({ ...p })) })
    }))
  }
}

function openapiParameter(p: ParameterDoku): Record<string, unknown> {
  return {
    name: p.name,
    in: p.ort === 'pfad' ? 'path' : 'query',
    required: p.obligatorisch,
    description: p.beschreibung,
    schema: { type: p.typ.startsWith('integer') ? 'integer' : 'string' }
  }
}

export function buildOpenapi(): Record<string, unknown> {
  const paths: Record<string, unknown> = {}
  for (const eintrag of REGISTER) {
    paths[dokuPfad(eintrag.pfad)] = {
      get: {
        summary: eintrag.zweck,
        ...(eintrag.parameter.length === 0
          ? {}
          : { parameters: eintrag.parameter.map(openapiParameter) }),
        responses: {
          '200': { description: 'ok' },
          ...(eintrag.inhalt
            ? {
                '503': {
                  description:
                    'Die Schnittstelle ist abgeschaltet (BLOG_API_OFFEN).'
                }
              }
            : {})
        }
      }
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Die Redaktion — publizierte Beitraege',
      version: VERSION,
      description: `Nur lesend, nach der Konvention ${KONVENTION}. Offener Modus: kein Merkmal noetig.`
    },
    servers: [{ url: '/' }],
    paths
  }
}
