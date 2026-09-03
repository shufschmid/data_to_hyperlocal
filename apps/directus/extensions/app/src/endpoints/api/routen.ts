// The handlers and the wiring, with every outside thing injected — so the whole
// API can be exercised in unit tests without a database, a network or Express.
//
// `verdrahte` builds the router FROM the register: a route that is not in
// `REGISTER` never gets wired, and every wired route is documented. The five
// checks of R16 test exactly that correspondence rather than a hand-kept list.

import {
  fehler,
  istKennung,
  leseGrenze,
  leseSeit,
  leseVersatz,
  type FehlerCode
} from './parameter'
import {
  buildBeschreibung,
  buildGesundheit,
  buildOpenapi,
  GRENZE_HOECHST,
  REGISTER
} from './register'
import {
  buildSlugMap,
  gemeindeSlug,
  liste,
  projektion,
  type GemeindeZeile,
  type Rohzeile
} from './projektion'

/** The narrow slice of Express this module uses — fakeable in a test. */
export interface AntwortLike {
  status(code: number): AntwortLike
  set(feld: string, wert: string): AntwortLike
  json(koerper: unknown): unknown
}

export interface AnfrageLike {
  query: Record<string, unknown>
  params: Record<string, string | undefined>
}

type Handler = (
  req: AnfrageLike,
  res: AntwortLike,
  next: (fehler?: unknown) => void
) => void | Promise<void>

export interface RouterLike {
  use(...handler: unknown[]): unknown
  get(pfad: string, ...handler: Handler[]): unknown
  all(pfad: string, ...handler: Handler[]): unknown
}

export interface Abfrage {
  gemeinde?: GemeindeZeile
  seit?: string
  grenze: number
  versatz: number
  id?: string
}

export interface Deps {
  /** The published articles under these conditions, newest first. */
  ladeArtikel(abfrage: Abfrage): Promise<Rohzeile[]>
  /** How many exist under the same conditions — the `gesamt` of R8. */
  zaehleArtikel(abfrage: Abfrage): Promise<number>
  ladeGemeinden(): Promise<GemeindeZeile[]>
  datenbankBereit(): Promise<boolean>
  /** Read per request, so flipping the switch needs no code change. */
  istOffen(): boolean
  jetzt(): string
  logger: { error: (obj: unknown, msg?: string) => void }
}

function sende(res: AntwortLike, status: number, koerper: unknown): void {
  res.status(status).json(koerper)
}

function sendeFehler(
  res: AntwortLike,
  status: number,
  code: FehlerCode,
  meldung: string
): void {
  sende(res, status, fehler(code, meldung))
}

// --- the three open ways (R3) -------------------------------------------------

function gesundheit(deps: Deps): Handler {
  return async (_req, res) => {
    const koerper = buildGesundheit({
      datenbank: await deps.datenbankBereit(),
      offen: deps.istOffen(),
      zeit: deps.jetzt()
    })
    // Same body either way, as R3 demands — the one place in this API where a
    // non-2xx is not the `fehler` envelope, because a monitor needs the detail.
    sende(res, koerper.bereit ? 200 : 503, koerper)
  }
}

function beschreibung(): Handler {
  return (_req, res) => sende(res, 200, buildBeschreibung())
}

function openapi(): Handler {
  return (_req, res) => sende(res, 200, buildOpenapi())
}

// --- content ------------------------------------------------------------------

/**
 * Reads the shared query parameters, or answers and returns null.
 *
 * An unknown municipality is a 404 rather than an empty list: asking for
 * `?gemeinde=muttenz` when Muttenz is not covered should say so, not look like
 * a quiet week.
 */
async function leseAbfrage(
  req: AnfrageLike,
  res: AntwortLike,
  deps: Deps
): Promise<Abfrage | null> {
  const grenze = leseGrenze(req.query['grenze'])
  if (!grenze.ok) {
    sendeFehler(res, 400, 'ungueltige_eingabe', grenze.meldung)
    return null
  }
  const versatz = leseVersatz(req.query['versatz'])
  if (!versatz.ok) {
    sendeFehler(res, 400, 'ungueltige_eingabe', versatz.meldung)
    return null
  }
  const seit = leseSeit(req.query['seit'])
  if (!seit.ok) {
    sendeFehler(res, 400, 'ungueltige_eingabe', seit.meldung)
    return null
  }

  const abfrage: Abfrage = { grenze: grenze.wert, versatz: versatz.wert }
  if (seit.wert !== null) abfrage.seit = seit.wert

  const rohGemeinde = req.query['gemeinde']
  if (typeof rohGemeinde === 'string' && rohGemeinde.trim() !== '') {
    const gesucht = rohGemeinde.trim().toLowerCase()
    const treffer = buildSlugMap(await deps.ladeGemeinden()).get(gesucht)
    if (treffer === undefined) {
      sendeFehler(
        res,
        404,
        'nicht_gefunden',
        `Unbekannte Gemeinde «${gesucht}». Die gueltigen Kennungen nennt /api/v1/gemeinden.`
      )
      return null
    }
    abfrage.gemeinde = treffer
  }

  return abfrage
}

function artikelListe(deps: Deps): Handler {
  return async (req, res) => {
    const abfrage = await leseAbfrage(req, res, deps)
    if (abfrage === null) return
    const [zeilen, gesamt] = await Promise.all([
      deps.ladeArtikel(abfrage),
      deps.zaehleArtikel(abfrage)
    ])
    sende(
      res,
      200,
      liste('artikel', zeilen.map(projektion), {
        gesamt,
        versatz: abfrage.versatz,
        grenze: abfrage.grenze
      })
    )
  }
}

/**
 * One article.
 *
 * 404 for unknown, unpublished AND malformed ids. This is a deliberate
 * exception to the endpoint doctrine in apps/directus/CLAUDE.md, which requires
 * 403 so a caller cannot probe which ids exist: here everything that answers is
 * published and public, so there is nothing to hide, and R9 asks for 404. The
 * shape check happens before the query — a non-uuid in a uuid filter makes
 * Postgres raise, and a typo must not become a 500.
 */
function artikelEinzeln(deps: Deps): Handler {
  return async (req, res) => {
    const id = req.params['id']
    const nichts = (): void =>
      sendeFehler(
        res,
        404,
        'nicht_gefunden',
        'Es gibt keinen publizierten Beitrag mit dieser Kennung.'
      )
    if (!istKennung(id)) return nichts()

    const zeilen = await deps.ladeArtikel({
      grenze: 1,
      versatz: 0,
      id: String(id)
    })
    const zeile = zeilen[0]
    if (zeile === undefined) return nichts()
    sende(res, 200, projektion(zeile))
  }
}

function gemeindenListe(deps: Deps): Handler {
  return async (_req, res) => {
    const gemeinden = await deps.ladeGemeinden()
    const eintraege = gemeinden.map((g) => ({
      gemeinde: gemeindeSlug(g.name),
      name: g.name,
      bfs_nummer: g.bfs_nummer,
      bezirk: g.bezirk
    }))
    sende(
      res,
      200,
      liste('gemeinden', eintraege, {
        gesamt: eintraege.length,
        versatz: 0,
        grenze: GRENZE_HOECHST
      })
    )
  }
}

// --- wiring -------------------------------------------------------------------

const HANDLER: Record<string, (deps: Deps) => Handler> = {
  '/v1/gesundheit': gesundheit,
  '/v1/beschreibung': () => beschreibung(),
  '/v1/openapi.json': () => openapi(),
  '/v1/artikel': artikelListe,
  '/v1/artikel/:id': artikelEinzeln,
  '/v1/gemeinden': gemeindenListe
}

/**
 * The switch of R4a/R5.
 *
 * Only content routes are gated — the three open ways answer either way, so a
 * monitor can see WHY the rest is silent. There is deliberately no fallback:
 * without the explicit switch the API serves nothing, rather than quietly
 * serving everything.
 */
function tor(deps: Deps): Handler {
  return (_req, res, next) => {
    if (deps.istOffen()) return next()
    sendeFehler(
      res,
      503,
      'schnittstelle_abgeschaltet',
      'Die Schnittstelle ist abgeschaltet. Sie wird mit BLOG_API_OFFEN=ja eingeschaltet.'
    )
  }
}

export function verdrahte(router: RouterLike, deps: Deps): void {
  // First, so it holds for every answer including the errors below. The blog is
  // unlisted and its API has no business in a search index either.
  router.use((_req: AnfrageLike, res: AntwortLike, next: () => void) => {
    res.set('X-Robots-Tag', 'noindex')
    next()
  })

  for (const eintrag of REGISTER) {
    const bauen = HANDLER[eintrag.pfad]
    // A register entry without a handler is a programming error, and one that
    // would otherwise show up as a 404 in production.
    if (bauen === undefined)
      throw new Error(`Kein Handler fuer ${eintrag.pfad} registriert.`)

    const handler = bauen(deps)
    if (eintrag.inhalt) router.get(eintrag.pfad, tor(deps), handler)
    else router.get(eintrag.pfad, handler)

    // Anything but GET on a path that exists — R2/R7. Registered after the GET,
    // so it only ever catches the other methods.
    router.all(eintrag.pfad, (_req, res) =>
      sendeFehler(
        res,
        405,
        'methode_nicht_erlaubt',
        'Diese Schnittstelle liest nur. Erlaubt ist GET.'
      )
    )
  }

  // An unknown path under /api answers in OUR shape. Without this, Express'
  // own HTML 404 would leak through and a consumer would have to parse two
  // error formats.
  router.use((_req: AnfrageLike, res: AntwortLike) =>
    sendeFehler(
      res,
      404,
      'nicht_gefunden',
      'Diesen Endpunkt gibt es nicht. Die vorhandenen nennt /api/v1/beschreibung.'
    )
  )

  // Four arguments: that is what makes Express treat it as the error handler.
  // The message names the error type, never a stack trace.
  router.use(
    (
      problem: unknown,
      _req: AnfrageLike,
      res: AntwortLike,
      _next: () => void
    ) => {
      deps.logger.error(problem, 'api: Anfrage fehlgeschlagen')
      sendeFehler(
        res,
        500,
        'interner_fehler',
        `Die Anwendung ist gestolpert: ${problem instanceof Error ? problem.name : 'Unbekannter Fehler'}.`
      )
    }
  )
}
