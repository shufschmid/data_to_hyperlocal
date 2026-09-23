// The handlers and the wiring, with every outside thing injected — so the whole
// API can be exercised in unit tests without a database, a network or Express.
//
// `verdrahte` builds the router FROM the register: a route that is not in
// `REGISTER` never gets wired, and every wired route is documented. The five
// checks of R16 test exactly that correspondence rather than a hand-kept list.

import {
  fehler,
  istKennung,
  leseFenster,
  leseGrenze,
  leseSeit,
  leseVersatz,
  type FehlerCode
} from './parameter'
import {
  ABNEHMER_KOPF,
  buildBeschreibung,
  buildGesundheit,
  buildOpenapi,
  erlaubteMethoden,
  GRENZE_HOECHST,
  REGISTER
} from './register'
import {
  abholungVon,
  abnehmerStand,
  istAbnehmerKennung,
  leseAbnehmer,
  leseStand,
  standVon,
  zeileAus,
  type AbnehmerZeile,
  type Stand
} from './abholung'
import { pruefeZugang } from '../../shared/schluessel'
import { redaktionsbilanz, type BilanzZeile } from '../../redaktion/bilanz'
import {
  buildSlugMap,
  gemeindeSlug,
  korrektur,
  liste,
  projektion,
  type ApiArtikel,
  type ApiKorrektur,
  type GemeindeZeile,
  type Korrekturzeile,
  type Rohzeile
} from './projektion'

/**
 * An article with the name of the house it came from.
 *
 * Added here rather than inside `projektion`, because the medium is a property
 * of this INSTANCE and not of the row: a pure function over a row has no
 * business knowing which newsroom is running it.
 */
function mitMedium(
  zeile: Rohzeile,
  medium: string
): ApiArtikel & {
  medium: string
} {
  return { ...projektion(zeile), medium }
}

/** The narrow slice of Express this module uses — fakeable in a test. */
export interface AntwortLike {
  status(code: number): AntwortLike
  set(feld: string, wert: string): AntwortLike
  json(koerper: unknown): unknown
}

export interface AnfrageLike {
  query: Record<string, unknown>
  params: Record<string, string | undefined>
  /** Express lower-cases header names; the confirmation reads its key here. */
  headers?: Record<string, unknown>
  /** The parsed JSON body — Directus mounts a JSON parser in front of every endpoint. */
  body?: unknown
}

type Handler = (
  req: AnfrageLike,
  res: AntwortLike,
  next: (fehler?: unknown) => void
) => void | Promise<void>

export interface RouterLike {
  use(...handler: unknown[]): unknown
  get(pfad: string, ...handler: Handler[]): unknown
  post(pfad: string, ...handler: Handler[]): unknown
  all(pfad: string, ...handler: Handler[]): unknown
}

export interface Abfrage {
  gemeinde?: GemeindeZeile
  seit?: string
  grenze: number
  versatz: number
  id?: string
  /**
   * Only what lies strictly behind this Stand in `(publiziert_am, id)` order
   * — the consumer's bookmark. Set together with `aufsteigend`, because a
   * bookmark is walked forward.
   */
  nach?: Stand
  /** Oldest first, so the last row of a page is the next Stand. */
  aufsteigend?: boolean
}

export interface Deps {
  /** The published articles under these conditions, newest first. */
  ladeArtikel(abfrage: Abfrage): Promise<Rohzeile[]>
  /** How many exist under the same conditions — the `gesamt` of R8. */
  zaehleArtikel(abfrage: Abfrage): Promise<number>
  /** The retractions, newest first. `seit` applies to `zurueckgezogen_am`. */
  ladeKorrekturen(abfrage: Abfrage): Promise<Korrekturzeile[]>
  zaehleKorrekturen(abfrage: Abfrage): Promise<number>
  ladeGemeinden(): Promise<GemeindeZeile[]>
  /**
   * Every article that is either waiting or was touched inside the window.
   *
   * One query rather than an aggregate per desk: the balance is a handful of
   * counters over a few hundred rows, and eight aggregates would be eight
   * chances for the conditions to drift apart.
   */
  ladeBilanzZeilen(fensterTage: number): Promise<BilanzZeile[]>
  datenbankBereit(): Promise<boolean>
  /** The consumer's bookmark, or null before its first confirmation. */
  ladeAbnehmer(kennung: string): Promise<AbnehmerZeile | null>
  /** Upsert by `kennung` — one row per consumer, whatever the order of arrival. */
  speichereAbnehmer(zeile: AbnehmerZeile): Promise<void>
  /**
   * `BLOG_API_ABNEHMER_KEY`, read per request. Empty means the confirmation
   * door is not configured, and it says so (503) rather than accepting anyone.
   */
  abnehmerSchluessel(): string
  /** Read per request, so flipping the switch needs no code change. */
  istOffen(): boolean
  /** The medium this instance speaks for — an instance property, not a row's. */
  medium(): string
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
      zeit: deps.jetzt(),
      medium: deps.medium()
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
function leseBlaettern(req: AnfrageLike, res: AntwortLike): Abfrage | null {
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
  return abfrage
}

/** Who is asking with a bookmark, and where that bookmark stood before this call. */
interface Abholer {
  kennung: string
  zeile: AbnehmerZeile | null
}

/**
 * The stored bookmark as a query condition. A row that cannot be read back
 * is an administrator's edit in the admin UI, and that is a loud failure —
 * silently serving everything again is exactly the flood the bookmark exists
 * to prevent.
 */
function nachVon(zeile: AbnehmerZeile | null): Stand | undefined {
  const stand = standVon(zeile)
  if (stand === null) return undefined
  const gelesen = leseStand(stand)
  if (!gelesen.ok)
    throw new Error(
      `Der gespeicherte Stand des Abnehmers «${zeile?.kennung ?? '?'}» ist nicht lesbar: ${stand}`
    )
  return gelesen.wert
}

async function leseAbfrage(
  req: AnfrageLike,
  res: AntwortLike,
  deps: Deps
): Promise<{ abfrage: Abfrage; abholer: Abholer | null } | null> {
  const abfrage = leseBlaettern(req, res)
  if (abfrage === null) return null

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

  const abnehmer = leseAbnehmer(req.query['abnehmer'])
  if (!abnehmer.ok) {
    sendeFehler(res, 400, 'ungueltige_eingabe', abnehmer.meldung)
    return null
  }
  if (abnehmer.wert === null) return { abfrage, abholer: null }

  // A bookmark is one position in ONE ordered list. Anything that would make
  // the confirmed Stand mean less than «everything up to here» is refused
  // out loud: a municipality filter would let the Stand skip the other
  // municipalities, and paging by offset on a list whose start moves with
  // every confirmation would skip a page per page.
  if (abfrage.gemeinde !== undefined) {
    sendeFehler(
      res,
      400,
      'ungueltige_eingabe',
      'Mit «abnehmer» gibt es keinen Gemeindefilter: der bestaetigte Stand gilt fuer alle Gemeinden, und ein gefilterter Stand liesse die anderen aus.'
    )
    return null
  }
  if (abfrage.versatz !== 0) {
    sendeFehler(
      res,
      400,
      'ungueltige_eingabe',
      'Mit «abnehmer» wird nicht mit «versatz» geblaettert: bestaetige den Stand der gespeicherten Seite, dann ist die naechste Seite die erste.'
    )
    return null
  }

  const zeile = await deps.ladeAbnehmer(abnehmer.wert)
  const nach = nachVon(zeile)
  if (nach !== undefined) {
    // `seit` is the floor for the FIRST contact — where a consumer starts. Once
    // a Stand exists it would only ever skip articles between the Stand and
    // the day, and a skip nobody asked for is the one thing this list must
    // never do.
    if (abfrage.seit !== undefined) {
      sendeFehler(
        res,
        400,
        'ungueltige_eingabe',
        `Fuer «${abnehmer.wert}» gibt es schon einen bestaetigten Stand; «seit» gilt nur vor der ersten Bestaetigung. Lass den Parameter weg — die Liste beginnt hinter dem Stand.`
      )
      return null
    }
    abfrage.nach = nach
  }
  abfrage.aufsteigend = true
  return { abfrage, abholer: { kennung: abnehmer.wert, zeile } }
}

function artikelListe(deps: Deps): Handler {
  return async (req, res) => {
    const gelesen = await leseAbfrage(req, res, deps)
    if (gelesen === null) return
    const { abfrage, abholer } = gelesen
    const [zeilen, gesamt] = await Promise.all([
      deps.ladeArtikel(abfrage),
      deps.zaehleArtikel(abfrage)
    ])
    sende(res, 200, {
      ...liste(
        'artikel',
        zeilen.map((z) => mitMedium(z, deps.medium())),
        {
          gesamt,
          versatz: abfrage.versatz,
          grenze: abfrage.grenze
        }
      ),
      ...(abholer === null
        ? {}
        : { abholung: abholungVon(abholer.kennung, abholer.zeile, zeilen) })
    })
  }
}

// --- the consumer's bookmark ---------------------------------------------------

const KENNUNG_FEHLT =
  'Die Kennung des Abnehmers besteht aus Kleinbuchstaben, Ziffern und Bindestrichen (2 bis 40 Zeichen), etwa «dorfkoenig».'

/** How many published articles lie behind a Stand — what the next list would offer. */
async function zaehleOffen(
  deps: Deps,
  nach: Stand | undefined
): Promise<number> {
  const abfrage: Abfrage = { grenze: 1, versatz: 0 }
  if (nach !== undefined) abfrage.nach = nach
  return deps.zaehleArtikel(abfrage)
}

/**
 * Where a consumer stands. Public like the rest: the bookmark reveals nothing
 * the list does not, and a consumer's own monitor should be able to see it
 * without a key.
 */
function abnehmerAuskunft(deps: Deps): Handler {
  return async (req, res) => {
    const kennung = req.params['kennung']
    if (!istAbnehmerKennung(kennung)) {
      sendeFehler(res, 400, 'ungueltige_eingabe', KENNUNG_FEHLT)
      return
    }
    const zeile = await deps.ladeAbnehmer(kennung)
    const offen = await zaehleOffen(deps, nachVon(zeile))
    sende(res, 200, abnehmerStand(kennung, zeile, offen))
  }
}

/**
 * The one write on this API: the consumer confirms the Stand of the last
 * article it stored. Behind the switch like every content route, and behind
 * a key of its own, because it changes what the next reader is offered.
 *
 * The Stand is taken as given — including one OLDER than the current, which
 * moves the bookmark back and re-delivers. That is deliberate: a consumer
 * that lost data has no other way to ask for it again, and the previous
 * Stand is echoed as `vorher` so the step is visible.
 */
function abgeholt(deps: Deps): Handler {
  return async (req, res) => {
    const kennung = req.params['kennung']
    if (!istAbnehmerKennung(kennung)) {
      sendeFehler(res, 400, 'ungueltige_eingabe', KENNUNG_FEHLT)
      return
    }
    const zugang = pruefeZugang(
      req.headers?.[ABNEHMER_KOPF.toLowerCase()],
      deps.abnehmerSchluessel()
    )
    if (zugang === 'nicht_konfiguriert') {
      sendeFehler(
        res,
        503,
        'nicht_konfiguriert',
        'Die Bestaetigung ist nicht konfiguriert: BLOG_API_ABNEHMER_KEY fehlt in der Umgebung der Redaktion.'
      )
      return
    }
    if (zugang === 'verweigert') {
      sendeFehler(
        res,
        401,
        'nicht_berechtigt',
        `Der Schluessel in ${ABNEHMER_KOPF} fehlt oder stimmt nicht.`
      )
      return
    }

    const koerper = req.body
    const roh =
      typeof koerper === 'object' && koerper !== null
        ? (koerper as { stand?: unknown }).stand
        : undefined
    const stand = leseStand(roh)
    if (!stand.ok) {
      sendeFehler(res, 400, 'ungueltige_eingabe', stand.meldung)
      return
    }

    const vorher = await deps.ladeAbnehmer(kennung)
    const neu = zeileAus(kennung, stand.wert, deps.jetzt())
    await deps.speichereAbnehmer(neu)
    const offen = await zaehleOffen(deps, stand.wert)
    sende(res, 200, {
      ...abnehmerStand(kennung, neu, offen),
      vorher: standVon(vorher)
    })
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
    sende(res, 200, mitMedium(zeile, deps.medium()))
  }
}

/**
 * The retractions.
 *
 * Only what this run of the newsroom actually marked: an article pulled back
 * before `zurueckgezogen_am` existed carries no timestamp and is not reported
 * here rather than being reported with a made-up date. The contract says so.
 *
 * No municipality filter, on purpose — a consumer that carried an article has
 * to hear about it whatever it was about, and a filter would invite it to ask
 * only about the ones it remembers asking for.
 */
function korrekturenListe(deps: Deps): Handler {
  return async (req, res) => {
    const abfrage = leseBlaettern(req, res)
    if (abfrage === null) return
    const [zeilen, gesamt] = await Promise.all([
      deps.ladeKorrekturen(abfrage),
      deps.zaehleKorrekturen(abfrage)
    ])
    const medium = deps.medium()
    const eintraege: (ApiKorrektur & { medium: string })[] = zeilen.map(
      (zeile) => ({ ...korrektur(zeile), medium })
    )
    sende(
      res,
      200,
      liste('korrekturen', eintraege, {
        gesamt,
        versatz: abfrage.versatz,
        grenze: abfrage.grenze
      })
    )
  }
}

/**
 * How much lies on which desk.
 *
 * Mengen only: no title, no text, no name. What it does say is how long the
 * oldest waiting article has been waiting, and that is the number the Lagebild
 * asked for (D8) and nobody had.
 */
function bilanz(deps: Deps): Handler {
  return async (req, res) => {
    const fenster = leseFenster(req.query['fenster'])
    if (!fenster.ok) {
      sendeFehler(res, 400, 'ungueltige_eingabe', fenster.meldung)
      return
    }
    const zeilen = await deps.ladeBilanzZeilen(fenster.wert)
    sende(res, 200, {
      ...redaktionsbilanz(zeilen, {
        jetzt: deps.jetzt(),
        fensterTage: fenster.wert
      }),
      medium: deps.medium()
    })
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
  '/v1/korrekturen': korrekturenListe,
  '/v1/bilanz': bilanz,
  '/v1/gemeinden': gemeindenListe,
  '/v1/abnehmer/:kennung': abnehmerAuskunft,
  '/v1/abnehmer/:kennung/abgeholt': abgeholt
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
    const kette = eintrag.inhalt ? [tor(deps), handler] : [handler]
    for (const methode of eintrag.methoden) {
      if (methode === 'POST') router.post(eintrag.pfad, ...kette)
      else router.get(eintrag.pfad, ...kette)
    }

    // Any other method on a path that exists — R2/R7. Registered after the
    // real ones, so it only ever catches the rest.
    router.all(eintrag.pfad, (_req, res) =>
      sendeFehler(
        res,
        405,
        'methode_nicht_erlaubt',
        `Diese Methode gibt es hier nicht. Erlaubt ist ${erlaubteMethoden(eintrag)}.`
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
