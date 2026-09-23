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
export const VERSION = '1.5.0'

/** Everything this API serves is public — see R4a and `BLOG_API_OFFEN`. */
export const MERKMAL = 'keines'

/**
 * The one write on this API — a consumer confirming where it got to — needs
 * a key, because it changes what the next reader is offered. It travels in a
 * header of its own, never in `Authorization` (Directus owns that one).
 */
export const ABNEHMER_KOPF = 'X-Abnehmer-Key'
export const ABNEHMER_MERKMAL = 'X-Abnehmer-Key (BLOG_API_ABNEHMER_KEY)'

/** Paging bounds, documented in the contract and enforced in `parameter.ts`. */
export const GRENZE_VORGABE = 100
export const GRENZE_HOECHST = 500

/**
 * How far the weekly figures of `/v1/bilanz` look back.
 *
 * Seven days by default because that is the rhythm the newsroom works in. The
 * ceiling is a year: the balance reads every waiting article to compute it, and
 * an unbounded window would turn a monitoring call into a table scan.
 */
export const FENSTER_VORGABE = 7
export const FENSTER_HOECHST = 365

export type Methode = 'GET' | 'POST'

export interface ParameterDoku {
  name: string
  /** Where it travels: the query, the path, a header, or the JSON body. */
  ort: 'query' | 'pfad' | 'kopf' | 'koerper'
  typ: string
  beschreibung: string
  obligatorisch: boolean
}

export interface RouteEintrag {
  /** Express form, relative to the endpoint mount: `/v1/artikel/:id`. */
  pfad: string
  methoden: readonly Methode[]
  zweck: string
  merkmal_noetig: typeof MERKMAL | typeof ABNEHMER_MERKMAL
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

const KENNUNG: ParameterDoku = {
  name: 'kennung',
  ort: 'pfad',
  typ: 'string',
  beschreibung:
    'Die Kennung des Abnehmers: Kleinbuchstaben, Ziffern, Bindestriche, 2 bis 40 Zeichen. Der Dorfkoenig ist «dorfkoenig».',
  obligatorisch: true
}

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
          'Nur Beitraege, die an diesem Tag oder danach publiziert wurden. Einschliesslich, ab 00:00 UTC. Mit «abnehmer» nur vor der ersten Bestaetigung erlaubt.',
        obligatorisch: false
      },
      {
        name: 'abnehmer',
        ort: 'query',
        typ: 'string (Kennung)',
        beschreibung:
          'Die Kennung des Abnehmers, etwa «dorfkoenig». Dann kommen nur Beitraege, die hinter seinem bestaetigten Stand liegen — aelteste zuerst, ohne «gemeinde» und ohne «versatz» — und die Antwort traegt unter «abholung.stand», was nach dem Speichern zu bestaetigen ist (POST /api/v1/abnehmer/{kennung}/abgeholt).',
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
    pfad: '/v1/korrekturen',
    methoden: ['GET'],
    zweck:
      'Beitraege, die publiziert waren und zurueckgezogen wurden, neueste zuerst. Ein Abnehmer, der einen Beitrag ausgespielt hat, erfaehrt hier, dass er nicht mehr gilt.',
    merkmal_noetig: 'keines',
    inhalt: true,
    parameter: [
      {
        name: 'seit',
        ort: 'query',
        typ: 'string (JJJJ-MM-TT)',
        beschreibung:
          'Nur Rueckzuege von diesem Tag an. Einschliesslich, ab 00:00 UTC, gemessen am Zeitpunkt des Rueckzugs.',
        obligatorisch: false
      },
      ...BLAETTERN
    ]
  },
  {
    pfad: '/v1/bilanz',
    methoden: ['GET'],
    zweck:
      'Wie viel auf welchem Tisch liegt und wie lange schon. Nur Mengen und Tage, kein Titel und kein Text.',
    merkmal_noetig: 'keines',
    // Content, although it carries no article: the switch means «this instance
    // serves the outside world», and how much unpublished work lies inside is
    // not less private than what has already gone out. A monitor that only
    // needs to know whether the service carries asks /v1/gesundheit, and that
    // one answers either way.
    inhalt: true,
    parameter: [
      {
        name: 'fenster',
        ort: 'query',
        typ: 'integer',
        beschreibung: `Wie viele Tage die Wochenzahlen zurueckreichen (1 bis ${FENSTER_HOECHST}, Vorgabe ${FENSTER_VORGABE}).`,
        obligatorisch: false
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
  },
  {
    pfad: '/v1/abnehmer/:kennung',
    methoden: ['GET'],
    zweck:
      'Wo ein Abnehmer steht: sein bestaetigter Stand, wann er ihn bestaetigt hat und wie viele Beitraege dahinter liegen. Ohne Bestaetigung sind alle Werte null und alles ist offen.',
    merkmal_noetig: 'keines',
    inhalt: true,
    parameter: [KENNUNG]
  },
  {
    pfad: '/v1/abnehmer/:kennung/abgeholt',
    methoden: ['POST'],
    zweck:
      'Der Abnehmer bestaetigt, bis wohin er die Beitraege gespeichert hat. Von da an bietet ihm /v1/artikel?abnehmer=… nur noch, was danach kam. Ein aelterer Stand setzt ihn zurueck und liefert erneut — das ist der Weg, einen Verlust auf seiner Seite zu heilen.',
    merkmal_noetig: ABNEHMER_MERKMAL,
    inhalt: true,
    parameter: [
      KENNUNG,
      {
        name: ABNEHMER_KOPF,
        ort: 'kopf',
        typ: 'string',
        beschreibung:
          'Der Schluessel des Abnehmers (BLOG_API_ABNEHMER_KEY auf der Seite der Redaktion). Fehlt der Schluessel in der Umgebung, antwortet der Weg 503 nicht_konfiguriert; stimmt er nicht, 401 nicht_berechtigt.',
        obligatorisch: true
      },
      {
        name: 'stand',
        ort: 'koerper',
        typ: 'string',
        beschreibung:
          'Genau der Wert aus «abholung.stand» der zuletzt gespeicherten Seite — «<publiziert_am>|<id>». Nie selbst gebaut, nie die eigene Uhr.',
        obligatorisch: true
      }
    ]
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

/** What a caller may send on this path — the 405 message names it. */
export function erlaubteMethoden(eintrag: RouteEintrag): string {
  return eintrag.methoden.join(', ')
}

export interface Gesundheit {
  dienst: string
  /**
   * The medium this instance speaks for (`REDAKTION_MEDIUM`).
   *
   * The Dorfkönig reads several newsrooms through the same convention, and an
   * article is only half an answer without the name of the house it came from.
   * The instance is the only place that knows it, so it says so here and on
   * every article.
   */
  medium: string
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
  medium: string
}): Gesundheit {
  return {
    dienst: DIENST,
    medium: zustand.medium,
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

const OPENAPI_ORT: Record<ParameterDoku['ort'], string> = {
  query: 'query',
  pfad: 'path',
  kopf: 'header',
  koerper: 'body'
}

function openapiParameter(p: ParameterDoku): Record<string, unknown> {
  return {
    name: p.name,
    in: OPENAPI_ORT[p.ort],
    required: p.obligatorisch,
    description: p.beschreibung,
    schema: { type: p.typ.startsWith('integer') ? 'integer' : 'string' }
  }
}

/** Body fields are not OpenAPI parameters; they become the request body. */
function openapiKoerper(
  felder: readonly ParameterDoku[]
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const p of felder)
    properties[p.name] = { type: 'string', description: p.beschreibung }
  return {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: felder.filter((p) => p.obligatorisch).map((p) => p.name),
          properties
        }
      }
    }
  }
}

function openapiOperation(eintrag: RouteEintrag): Record<string, unknown> {
  const parameter = eintrag.parameter.filter((p) => p.ort !== 'koerper')
  const koerper = eintrag.parameter.filter((p) => p.ort === 'koerper')
  const geschuetzt = eintrag.merkmal_noetig !== MERKMAL
  return {
    summary: eintrag.zweck,
    ...(parameter.length === 0
      ? {}
      : { parameters: parameter.map(openapiParameter) }),
    ...(koerper.length === 0 ? {} : { requestBody: openapiKoerper(koerper) }),
    responses: {
      '200': { description: 'ok' },
      ...(geschuetzt
        ? {
            '401': { description: 'Der Schluessel stimmt nicht.' },
            '503': {
              description:
                'Die Schnittstelle ist abgeschaltet (BLOG_API_OFFEN) oder der Schluessel ist nicht konfiguriert (BLOG_API_ABNEHMER_KEY).'
            }
          }
        : eintrag.inhalt
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

export function buildOpenapi(): Record<string, unknown> {
  const paths: Record<string, unknown> = {}
  for (const eintrag of REGISTER) {
    const operationen: Record<string, unknown> = {}
    for (const methode of eintrag.methoden)
      operationen[methode.toLowerCase()] = openapiOperation(eintrag)
    paths[dokuPfad(eintrag.pfad)] = operationen
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
