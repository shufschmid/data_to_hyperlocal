// The reader of the Buschtelefon's hand-over door.
//
// The Buschtelefon (a separate system of the newsroom's owner) collects what
// is said in the Facebook groups — later on Instagram and TikTok — of the
// covered municipalities and hands the raw finds over through ONE read-only
// door, format `buschtelefon-redaktion/2`:
//
//   GET {BUSCHTELEFON_URL}/api/redaktion/v2/funde?nach=<folge>&limit=<n>
//   GET {BUSCHTELEFON_URL}/api/redaktion/v2/quellen
//
// Contract: apps/directus/BUSCHTELEFON_SCHNITTSTELLE.md.
//
// Three things guard the door and all three travel on every request: a
// Cloudflare Access service token (two headers) and a bearer key. A wrong or
// missing Cloudflare token does NOT answer with JSON — Cloudflare answers
// with its sign-in page (HTML, or a redirect to it), and a reader that fed
// that to `JSON.parse` would report a syntax error instead of the cause. So
// the answer is classified BEFORE it is parsed, and redirects are never
// followed (`redirect: 'manual'`): following one would send the three
// secrets after it.
//
// The bookmark is `folge`, a number the door gives each find at its last
// released change. This reader follows `weiter` page by page and never
// builds a bookmark from its own clock.
//
// Pure apart from the injected `fetch`. The secrets come in through
// `liesZugang` (the environment, read nowhere else) and never into a
// message, a log line or an error text.

import { optionalEnv } from '../env'
import {
  AntwortFormatFehler,
  hoechsteFolge,
  liesFundeAntwort,
  liesQuellenAntwort
} from './parse'
import type {
  Ausgelassen,
  Freigabe,
  FundEintrag,
  FundeAntwort,
  QuellenAntwort,
  Ungueltig
} from './typen'

export const STANDARD_URL = 'https://buschtelefon.raumschiffenterprise.ch'
export const FUNDE_PFAD = '/api/redaktion/v2/funde'
export const QUELLEN_PFAD = '/api/redaktion/v2/quellen'

export const STANDARD_LIMIT = 200
/** The door's own maximum (3.1). */
export const MAX_LIMIT = 500
/** A guard, not a budget: a hundred pages of 200 is twenty thousand finds. Declared when it bites. */
export const MAX_SEITEN = 100
const ZEITGRENZE_MS = 30_000

/** What a request needs. Named `Tuerzugang` because the contract's own `Zugang` is how a SOURCE is read. */
export interface Tuerzugang {
  /** Origin without a path. */
  url: string
  cfClientId: string
  cfClientSecret: string
  schluessel: string
}

export const ZUGANGS_VARIABLEN = [
  'BUSCHTELEFON_CF_CLIENT_ID',
  'BUSCHTELEFON_CF_CLIENT_SECRET',
  'BUSCHTELEFON_SCHLUESSEL'
] as const

export type ZugangsErgebnis =
  | { ok: true; zugang: Tuerzugang }
  | { ok: false; fehlend: string[] }

/**
 * The access from the environment — or the names of what is missing. Never
 * throws: a host without the variables simply has no Buschtelefon feed and
 * says which variables it lacks (the `CRAWLER_KEY` bargain).
 * `BUSCHTELEFON_URL` has a default; the three secrets have none. An address
 * that is not `https://host` without a path is refused: the secrets go to
 * whatever it names.
 */
export function liesZugang(
  env: NodeJS.ProcessEnv = process.env
): ZugangsErgebnis {
  const wert = (name: string): string => optionalEnv(name, '', env).trim()
  const fehlend = ZUGANGS_VARIABLEN.filter((name) => wert(name) === '')
  if (fehlend.length > 0) return { ok: false, fehlend: [...fehlend] }
  const url = optionalEnv('BUSCHTELEFON_URL', STANDARD_URL, env)
    .trim()
    .replace(/\/+$/, '')
  if (!istTueradresse(url))
    return {
      ok: false,
      fehlend: ['BUSCHTELEFON_URL (https-Adresse ohne Pfad)']
    }
  return {
    ok: true,
    zugang: {
      url,
      cfClientId: wert('BUSCHTELEFON_CF_CLIENT_ID'),
      cfClientSecret: wert('BUSCHTELEFON_CF_CLIENT_SECRET'),
      schluessel: wert('BUSCHTELEFON_SCHLUESSEL')
    }
  }
}

/** `https://host[:port]` and nothing after it — no path, no query, no credentials. */
export function istTueradresse(url: string): boolean {
  return /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(url)
}

export type FehlerArt =
  /** Cloudflare Access turned the request away — its sign-in page, not JSON. */
  | 'cloudflare'
  /** The door itself answered 401: the bearer key is wrong. */
  | 'schluessel'
  /**
   * 503 `nicht_eingerichtet`: the door has no key set up yet, or has not
   * completed its first release yet (contract 3.3) — and an HTML page under
   * 503, which is a door not ready rather than a sign-in.
   */
  | 'nicht_bereit'
  /** 503 `freigabe_laeuft`: a release is being written; come back (the next free retry). */
  | 'freigabe_laeuft'
  /** 410: `nach` lies below what the door still holds — fetch once without `nach`. */
  | 'stand_zu_alt'
  | 'anfrage'
  | 'server'
  | 'netz'
  | 'format'

export class BuschtelefonFehler extends Error {
  readonly art: FehlerArt
  /** Only for `stand_zu_alt`: the highest `folge` that ever fell out of the door's window. */
  readonly verworfenBis: number | null
  /** Only for `freigabe_laeuft`: the door's `Retry-After` in seconds, where it sent one. */
  readonly wiederholenNach: number | null
  constructor(
    art: FehlerArt,
    meldung: string,
    zusatz: {
      verworfenBis?: number | null
      wiederholenNach?: number | null
    } = {}
  ) {
    super(meldung)
    this.name = 'BuschtelefonFehler'
    this.art = art
    this.verworfenBis = zusatz.verworfenBis ?? null
    this.wiederholenNach = zusatz.wiederholenNach ?? null
  }
}

export type FetchLike = (
  url: string,
  init: {
    method: 'GET'
    headers: Record<string, string>
    redirect: 'manual'
    signal: AbortSignal
  }
) => Promise<{
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}>

export interface Abfrage {
  /** The bookmark: everything with `folge > nach`. Null or absent: everything the door holds. */
  nach?: number | null
  limit?: number
}

export function begrenzeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return STANDARD_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

export function fundeUrl(
  zugang: Pick<Tuerzugang, 'url'>,
  abfrage: Abfrage = {}
): string {
  const teile: string[] = []
  if (abfrage.nach !== null && abfrage.nach !== undefined) {
    if (!Number.isSafeInteger(abfrage.nach) || abfrage.nach < 0)
      throw new BuschtelefonFehler(
        'anfrage',
        'Das Lesezeichen «nach» ist keine ganze Zahl ab 0.'
      )
    teile.push(`nach=${abfrage.nach}`)
  }
  teile.push(`limit=${begrenzeLimit(abfrage.limit)}`)
  return `${zugang.url}${FUNDE_PFAD}?${teile.join('&')}`
}

export function quellenUrl(zugang: Pick<Tuerzugang, 'url'>): string {
  return `${zugang.url}${QUELLEN_PFAD}`
}

function istHtml(inhaltsart: string | null, koerper: string): boolean {
  if (inhaltsart !== null && /html/i.test(inhaltsart)) return true
  return /^\s*<(?:!doctype|html|head|body)/i.test(koerper)
}

/** A word of the door's own error vocabulary — letters and underscores only, so no content can ride in it. */
function kennwort(wert: unknown): string | null {
  return typeof wert === 'string' && /^[a-z_]{1,40}$/.test(wert) ? wert : null
}

const CLOUDFLARE_GRUND =
  'Service-Token fehlt, ist abgelaufen oder hat für den Pfad /api/redaktion/* keine Service-Auth-Regel.'

/**
 * What an answer MEANS, from status and body — before and instead of a blind
 * `JSON.parse`. Returns the parsed JSON of a 200 and throws a
 * `BuschtelefonFehler` for everything else. The messages are built here from
 * fixed sentences plus the door's own short reason words; a body is never
 * quoted.
 */
export function klassifiziere(
  status: number,
  inhaltsart: string | null,
  koerper: string,
  retryAfter: string | null = null
): unknown {
  // A redirect (Cloudflare's way to its sign-in page) and HTML under a
  // status below 500 are Cloudflare Access, not the door: the door answers
  // JSON, always. HTML under a 5xx is Cloudflare's ERROR page for an origin
  // that is down or restarting (502, 521, 522, 530) — the other side's
  // server, not the credentials, and a 503 during a deploy is the same quiet
  // «not ready» as the door's own JSON 503.
  if (status >= 300 && status < 400)
    throw new BuschtelefonFehler(
      'cloudflare',
      `Cloudflare Access leitet auf die Anmeldeseite um: ${CLOUDFLARE_GRUND}`
    )
  if (istHtml(inhaltsart, koerper)) {
    if (status === 503)
      throw new BuschtelefonFehler(
        'nicht_bereit',
        'Das Buschtelefon ist auf seiner Seite nicht bereit (503, Fehlerseite statt JSON).'
      )
    if (status >= 500)
      throw new BuschtelefonFehler(
        'server',
        `Das Buschtelefon ist nicht erreichbar (HTTP ${status}, Fehlerseite statt JSON).`
      )
    throw new BuschtelefonFehler(
      'cloudflare',
      `Cloudflare Access antwortet mit seiner Anmeldeseite (HTTP ${status}) statt mit JSON: ${CLOUDFLARE_GRUND}`
    )
  }

  let json: unknown = null
  let lesbar = true
  try {
    json = JSON.parse(koerper)
  } catch {
    lesbar = false
  }
  const objekt =
    typeof json === 'object' && json !== null && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : null
  const fehler = kennwort(objekt?.['fehler'])
  const grund = kennwort(objekt?.['grund'])

  if (status === 200) {
    if (!lesbar)
      throw new BuschtelefonFehler(
        'format',
        'Die Antwort des Buschtelefons ist kein JSON.'
      )
    return json
  }
  if (status === 401)
    throw new BuschtelefonFehler(
      'schluessel',
      'Das Buschtelefon weist den Bearer-Schlüssel ab (401): BUSCHTELEFON_SCHLUESSEL fehlt auf der Gegenseite oder ist falsch.'
    )
  if (status === 403)
    throw new BuschtelefonFehler(
      'cloudflare',
      'Zugriff verweigert (403): Cloudflare Access hat das Service-Token abgelehnt.'
    )
  if (status === 410) {
    const verworfen = objekt?.['verworfen_bis']
    const verworfenBis =
      typeof verworfen === 'number' && Number.isSafeInteger(verworfen)
        ? verworfen
        : null
    throw new BuschtelefonFehler(
      'stand_zu_alt',
      `Das Lesezeichen ist älter als das Vorhaltefenster des Buschtelefons (410${
        verworfenBis === null ? '' : `, verworfen bis Folge ${verworfenBis}`
      }): Es wird einmal ohne Lesezeichen abgeholt.`,
      { verworfenBis }
    )
  }
  if (status === 503) {
    if (grund === 'freigabe_laeuft') {
      const sekunden =
        retryAfter !== null && /^\d{1,6}$/.test(retryAfter.trim())
          ? Number(retryAfter.trim())
          : null
      throw new BuschtelefonFehler(
        'freigabe_laeuft',
        'Das Buschtelefon gibt gerade einen neuen Stand frei (503): Der nächste Abruf holt ihn.',
        { wiederholenNach: sekunden }
      )
    }
    throw new BuschtelefonFehler(
      'nicht_bereit',
      `Das Buschtelefon ist auf seiner Seite nicht bereit (503${grund === null ? '' : `: ${grund}`}).`
    )
  }
  if (status === 400)
    throw new BuschtelefonFehler(
      'anfrage',
      `Das Buschtelefon weist die Anfrage ab (400${fehler === null ? '' : `: ${fehler}`}).`
    )
  throw new BuschtelefonFehler(
    'server',
    `Das Buschtelefon antwortet mit HTTP ${status}.`
  )
}

/** One GET with the three credentials. Network and time-out errors become `netz`; secrets never enter a message. */
async function hole(
  zugang: Tuerzugang,
  url: string,
  holen: FetchLike
): Promise<unknown> {
  let antwort: Awaited<ReturnType<FetchLike>>
  let koerper: string
  try {
    antwort = await holen(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'CF-Access-Client-Id': zugang.cfClientId,
        'CF-Access-Client-Secret': zugang.cfClientSecret,
        Authorization: `Bearer ${zugang.schluessel}`
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(ZEITGRENZE_MS)
    })
    koerper = await antwort.text()
  } catch (fehler) {
    // Only the error's NAME: an error message of a fetch implementation may
    // carry the request, and the request carries the secrets.
    const name =
      fehler instanceof Error && /^[A-Za-z]{1,40}$/.test(fehler.name)
        ? fehler.name
        : 'Netzfehler'
    throw new BuschtelefonFehler(
      'netz',
      name === 'TimeoutError' || name === 'AbortError'
        ? `Das Buschtelefon hat nicht innert ${ZEITGRENZE_MS / 1000} Sekunden geantwortet.`
        : `Das Buschtelefon ist nicht erreichbar (${name}).`
    )
  }
  return klassifiziere(
    antwort.status,
    antwort.headers.get('content-type'),
    koerper,
    antwort.headers.get('retry-after')
  )
}

function alsFormatfehler<T>(lies: () => T): T {
  try {
    return lies()
  } catch (fehler) {
    if (fehler instanceof AntwortFormatFehler)
      throw new BuschtelefonFehler('format', fehler.message)
    throw fehler
  }
}

const standardFetch: FetchLike = (url, init) => fetch(url, init)

/** ONE page of `/funde`, validated. */
export async function holeFundeSeite(
  zugang: Tuerzugang,
  abfrage: Abfrage = {},
  holen: FetchLike = standardFetch
): Promise<FundeAntwort> {
  const json = await hole(zugang, fundeUrl(zugang, abfrage), holen)
  return alsFormatfehler(() => liesFundeAntwort(json))
}

export interface Abholung {
  /** The release of the LAST page read. */
  freigabe: Freigabe
  /** Every find once, under its highest `folge`, ascending by `folge`. */
  funde: FundEintrag[]
  ausgelassen: Ausgelassen[]
  ungueltig: Ungueltig[]
  seiten: number
  /**
   * The highest `folge` this read carried (finds, omitted and refused entries
   * alike) — where the bookmark may stand after it. Null when the read was
   * empty: the bookmark then stays where it was.
   */
  folge: number | null
  /**
   * Why the read stopped before the end, when a LATER page failed or a guard
   * bit: the pages before it are returned (a clean prefix in ascending
   * `folge`, so the bookmark never moves over a gap). A failure on the FIRST
   * page throws instead.
   */
  abbruch: BuschtelefonFehler | null
}

export interface AbholOptionen {
  maxSeiten?: number
  /**
   * Called after each page, before the next is fetched — so a run can store
   * the page and write its bookmark page by page. What it throws ends the
   * read and is thrown on.
   */
  jeSeite?: (seite: FundeAntwort, nummer: number) => Promise<void> | void
}

/**
 * Every page from `nach` on: while `weiter` is set, the next page starts at
 * it. A `weiter` that does not move forward would loop for ever and a
 * runaway read is capped at `MAX_SEITEN` — both end the read with a declared
 * `abbruch`, keeping what was read; the next run goes on from the bookmark.
 */
export async function holeFunde(
  zugang: Tuerzugang,
  abfrage: Abfrage = {},
  holen: FetchLike = standardFetch,
  optionen: AbholOptionen = {}
): Promise<Abholung> {
  const maxSeiten = optionen.maxSeiten ?? MAX_SEITEN
  const gesehen = new Map<string, FundEintrag>()
  const ausgelassen = new Map<number, Ausgelassen>()
  const ungueltig: Ungueltig[] = []
  let nach = abfrage.nach ?? null
  let seiten = 0
  let folge: number | null = null
  let freigabe: Freigabe | null = null
  let abbruch: BuschtelefonFehler | null = null

  for (;;) {
    let seite: FundeAntwort
    try {
      seite = await holeFundeSeite(
        zugang,
        {
          nach,
          ...(abfrage.limit === undefined ? {} : { limit: abfrage.limit })
        },
        holen
      )
    } catch (fehler) {
      if (seiten === 0 || !(fehler instanceof BuschtelefonFehler)) throw fehler
      abbruch = fehler
      break
    }
    seiten += 1
    freigabe = seite.freigabe
    for (const fund of seite.funde) {
      const bisher = gesehen.get(fund.kennung)
      if (bisher === undefined || bisher.folge < fund.folge)
        gesehen.set(fund.kennung, fund)
    }
    for (const eintrag of seite.ausgelassen)
      ausgelassen.set(eintrag.folge, eintrag)
    ungueltig.push(...seite.ungueltig)
    const hoechste = hoechsteFolge(seite)
    if (hoechste !== null && (folge === null || hoechste > folge))
      folge = hoechste

    if (optionen.jeSeite !== undefined) await optionen.jeSeite(seite, seiten)

    if (seite.weiter === null) break
    if (nach !== null && seite.weiter <= nach) {
      abbruch = new BuschtelefonFehler(
        'format',
        'Das Buschtelefon liefert eine Fortsetzung («weiter»), die nicht vorwärts führt: abgebrochen.'
      )
      break
    }
    if (seiten >= maxSeiten) {
      abbruch = new BuschtelefonFehler(
        'format',
        `Mehr als ${maxSeiten} Seiten in einer Abholung: abgebrochen, der nächste Lauf macht beim Lesezeichen weiter.`
      )
      break
    }
    nach = seite.weiter
  }

  if (freigabe === null)
    throw new BuschtelefonFehler(
      'format',
      'Das Buschtelefon hat keine Seite geliefert.'
    )
  return {
    freigabe,
    funde: [...gesehen.values()].sort((a, b) => a.folge - b.folge),
    ausgelassen: [...ausgelassen.values()].sort((a, b) => a.folge - b.folge),
    ungueltig,
    seiten,
    folge,
    abbruch
  }
}

/** The sources of the run the current release was built from (3.5). */
export async function holeQuellen(
  zugang: Tuerzugang,
  holen: FetchLike = standardFetch
): Promise<QuellenAntwort> {
  const json = await hole(zugang, quellenUrl(zugang), holen)
  return alsFormatfehler(() => liesQuellenAntwort(json))
}
