// The reader of the Buschtelefon's hand-over door.
//
// The Buschtelefon (a separate system of the newsroom's owner) collects what
// is said in the Facebook groups, on Instagram and on TikTok of the covered
// municipalities, and hands the raw finds over through ONE read-only door:
// `GET {BUSCHTELEFON_URL}/api/redaktion/v1/funde`. Contract:
// `buschtelefon-redaktion/1` (its own SCHNITTSTELLE_REDAKTION.md).
//
// Three things guard the door, and all three are needed on every request:
// a Cloudflare Access service token (two headers) and a bearer key. A wrong
// or missing Cloudflare token does NOT answer with JSON — Cloudflare answers
// with its sign-in page (HTML, or a redirect to it), and a reader that fed
// that to `JSON.parse` would report a syntax error instead of the cause. So
// the answer is classified BEFORE it is parsed (`BuschtelefonFehler`).
//
// Pure apart from the injected `fetch`: everything here is tested against
// stubs. The secrets come in through `liesZugang` (the environment, read
// nowhere else) and never into a message, a log line or an error text.

import { optionalEnv } from '../env'

export const FORMAT = 'buschtelefon-redaktion/1'
export const STANDARD_URL = 'https://buschtelefon.raumschiffenterprise.ch'

/**
 * A run stamps all its finds with the SAME `erfasst_am` but writes them to
 * disk one after the other (a Facebook run takes 40 to 50 minutes), so a
 * read in the middle of a run can see only part of a group. `seit` therefore
 * reaches back two hours from the newest stamp seen, and the finds already
 * known are recognised by their `kennung`.
 */
export const VORLAUF_MS = 2 * 60 * 60 * 1000

export const STANDARD_LIMIT = 200
export const MAX_LIMIT = 1000
/** A guard, not a budget: 50 pages of 200 is ten thousand finds. */
export const MAX_SEITEN = 50
const ZEITGRENZE_MS = 30_000

export type Kanal = 'facebook' | 'instagram' | 'tiktok'
const KANAELE: readonly string[] = ['facebook', 'instagram', 'tiktok']

export interface Kommentar {
  text: string
  autor_art: string | null
  veroeffentlicht_am: string | null
}

/** One find, as the door hands it over — validated, nothing more. */
export interface Fund {
  kennung: string
  kanal: Kanal
  gemeinde_slug: string | null
  kanton: string | null
  quelle_name: string | null
  quelle_art: string | null
  link: string
  veroeffentlicht_am: string | null
  datum_genauigkeit: string | null
  erfasst_am: string
  titel: string | null
  text: string
  zusammenfassung: string | null
  artikel_text: string | null
  kommentare: Kommentar[] | null
  n_kommentare: number
  n_reaktionen: number | null
  n_geteilt: number | null
  doublette_von: string | null
  bildtext: string | null
  pruefsumme: string | null
}

export interface Zugang {
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
  | { ok: true; zugang: Zugang }
  | { ok: false; fehlend: string[] }

/**
 * The access from the environment — or the names of what is missing. Never
 * throws: a host without the variables simply has no Buschtelefon feed, and
 * says which variables it lacks. `BUSCHTELEFON_URL` has a default (the
 * address of the door); the three secrets have none.
 */
export function liesZugang(
  env: NodeJS.ProcessEnv = process.env
): ZugangsErgebnis {
  const fehlend = ZUGANGS_VARIABLEN.filter(
    (name) => (env[name] ?? '').trim() === ''
  )
  if (fehlend.length > 0) return { ok: false, fehlend: [...fehlend] }
  const url = optionalEnv('BUSCHTELEFON_URL', STANDARD_URL, env)
    .trim()
    .replace(/\/+$/, '')
  if (!/^https:\/\/[^\s/]+$/.test(url))
    return {
      ok: false,
      fehlend: ['BUSCHTELEFON_URL (https-Adresse ohne Pfad)']
    }
  return {
    ok: true,
    zugang: {
      url,
      cfClientId: (env['BUSCHTELEFON_CF_CLIENT_ID'] ?? '').trim(),
      cfClientSecret: (env['BUSCHTELEFON_CF_CLIENT_SECRET'] ?? '').trim(),
      schluessel: (env['BUSCHTELEFON_SCHLUESSEL'] ?? '').trim()
    }
  }
}

export type FehlerArt =
  /** Cloudflare Access turned the request away — its sign-in page, not JSON. */
  | 'cloudflare'
  /** The bridge itself answered 401: the bearer key is wrong. */
  | 'schluessel'
  /** The bridge has no key set up yet (503). */
  | 'gegenseite_nicht_eingerichtet'
  | 'anfrage'
  | 'server'
  | 'netz'
  | 'format'

export class BuschtelefonFehler extends Error {
  readonly art: FehlerArt
  constructor(art: FehlerArt, meldung: string) {
    super(meldung)
    this.name = 'BuschtelefonFehler'
    this.art = art
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
  seit?: string | null
  limit?: number
}

/** The request address. The `+` of a time zone must travel as `%2B`. */
export function abfrageUrl(
  zugang: Pick<Zugang, 'url'>,
  abfrage: Abfrage
): string {
  const teile: string[] = []
  if (abfrage.seit != null && abfrage.seit !== '')
    teile.push(`seit=${encodeURIComponent(abfrage.seit)}`)
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(abfrage.limit ?? STANDARD_LIMIT))
  )
  teile.push(`limit=${limit}`)
  return `${zugang.url}/api/redaktion/v1/funde?${teile.join('&')}`
}

/**
 * Where the next read starts: the newest `erfasst_am` we hold, two hours
 * back. Null without a stand — the first read then takes what the door
 * offers (its last 14 days).
 */
export function seitFuer(letzterStand: string | null): string | null {
  if (letzterStand === null) return null
  const zeit = Date.parse(letzterStand)
  if (!Number.isFinite(zeit)) return null
  return new Date(zeit - VORLAUF_MS).toISOString()
}

function istHtml(inhaltsart: string | null, koerper: string): boolean {
  if (inhaltsart !== null && /html/i.test(inhaltsart)) return true
  return /^\s*<(?:!doctype|html|head|body)/i.test(koerper)
}

function textOderNull(wert: unknown): string | null {
  return typeof wert === 'string' && wert.trim() !== '' ? wert : null
}

function zahlOderNull(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null
}

/**
 * One find, or null when it lacks what the desk cannot do without: an
 * identity, a channel the contract names, the link to the original, a
 * parseable capture time and a text. Never throws — one bad find costs
 * itself, never the page.
 */
export function pruefeFund(roh: unknown): Fund | null {
  if (typeof roh !== 'object' || roh === null) return null
  const f = roh as Record<string, unknown>
  const kennung = textOderNull(f['kennung'])
  const kanal = f['kanal']
  const link = textOderNull(f['link'])
  const erfasst = textOderNull(f['erfasst_am'])
  if (
    kennung === null ||
    typeof kanal !== 'string' ||
    !KANAELE.includes(kanal) ||
    link === null ||
    !/^https?:\/\//.test(link) ||
    erfasst === null ||
    !Number.isFinite(Date.parse(erfasst)) ||
    typeof f['text'] !== 'string'
  )
    return null

  let kommentare: Kommentar[] | null = null
  if (Array.isArray(f['kommentare'])) {
    kommentare = f['kommentare'].flatMap((k): Kommentar[] => {
      if (typeof k !== 'object' || k === null) return []
      const eintrag = k as Record<string, unknown>
      const text = textOderNull(eintrag['text'])
      if (text === null) return []
      return [
        {
          text,
          autor_art: textOderNull(eintrag['autor_art']),
          veroeffentlicht_am: textOderNull(eintrag['veroeffentlicht_am'])
        }
      ]
    })
    if (kommentare.length === 0) kommentare = null
  }

  const veroeffentlicht = textOderNull(f['veroeffentlicht_am'])
  return {
    kennung,
    kanal: kanal as Kanal,
    gemeinde_slug: textOderNull(f['gemeinde_slug']),
    kanton: textOderNull(f['kanton']),
    quelle_name: textOderNull(f['quelle_name']),
    quelle_art: textOderNull(f['quelle_art']),
    link,
    veroeffentlicht_am:
      veroeffentlicht !== null && Number.isFinite(Date.parse(veroeffentlicht))
        ? veroeffentlicht
        : null,
    datum_genauigkeit: textOderNull(f['datum_genauigkeit']),
    erfasst_am: erfasst,
    titel: textOderNull(f['titel']),
    text: f['text'],
    zusammenfassung: textOderNull(f['zusammenfassung']),
    artikel_text: textOderNull(f['artikel_text']),
    kommentare,
    n_kommentare: zahlOderNull(f['n_kommentare']) ?? 0,
    n_reaktionen: zahlOderNull(f['n_reaktionen']),
    n_geteilt: zahlOderNull(f['n_geteilt']),
    doublette_von: textOderNull(f['doublette_von']),
    bildtext: textOderNull(f['bildtext']),
    pruefsumme: textOderNull(f['pruefsumme'])
  }
}

export interface Seite {
  funde: Fund[]
  /** Finds of this page that failed `pruefeFund`. */
  ungueltig: number
  stand: string | null
  weiter: string | null
  ohneLink: number
}

/** The answer's meaning, from status and body — before and instead of a blind `JSON.parse`. */
export function liesAntwort(
  status: number,
  inhaltsart: string | null,
  koerper: string
): Seite {
  // A redirect (Cloudflare's way to its sign-in page) and HTML under any
  // status are Cloudflare Access, not the bridge: the bridge answers JSON.
  if (status >= 300 && status < 400)
    throw new BuschtelefonFehler(
      'cloudflare',
      'Cloudflare Access leitet auf die Anmeldeseite um: Service-Token fehlt, ist abgelaufen oder hat für den Pfad /api/redaktion/* keine Service-Auth-Regel.'
    )
  if (istHtml(inhaltsart, koerper))
    throw new BuschtelefonFehler(
      'cloudflare',
      `Cloudflare Access antwortet mit seiner Anmeldeseite (HTTP ${status}) statt mit JSON: Service-Token fehlt, ist abgelaufen oder hat für den Pfad /api/redaktion/* keine Service-Auth-Regel.`
    )

  let json: unknown = null
  try {
    json = JSON.parse(koerper)
  } catch {
    // Handled by status below; an unreadable body on a 200 is a format error.
  }
  const grund =
    typeof json === 'object' && json !== null
      ? textOderNull((json as Record<string, unknown>)['grund'])
      : null

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
  if (status === 503)
    throw new BuschtelefonFehler(
      'gegenseite_nicht_eingerichtet',
      `Das Buschtelefon ist auf seiner Seite noch nicht eingerichtet (503${grund === null ? '' : `: ${grund}`}).`
    )
  if (status === 400)
    throw new BuschtelefonFehler(
      'anfrage',
      `Das Buschtelefon weist die Anfrage ab (400${grund === null ? '' : `: ${grund}`}).`
    )
  if (status !== 200)
    throw new BuschtelefonFehler(
      'server',
      `Das Buschtelefon antwortet mit HTTP ${status}.`
    )

  if (typeof json !== 'object' || json === null)
    throw new BuschtelefonFehler(
      'format',
      'Die Antwort des Buschtelefons ist kein JSON-Objekt.'
    )
  const antwort = json as Record<string, unknown>
  if (antwort['format'] !== FORMAT)
    throw new BuschtelefonFehler(
      'format',
      `Unbekanntes Format «${String(antwort['format'])}» (erwartet ${FORMAT}).`
    )
  if (!Array.isArray(antwort['funde']))
    throw new BuschtelefonFehler(
      'format',
      'Die Antwort des Buschtelefons enthält keine Liste «funde».'
    )

  const funde: Fund[] = []
  let ungueltig = 0
  for (const roh of antwort['funde']) {
    const fund = pruefeFund(roh)
    if (fund === null) ungueltig += 1
    else funde.push(fund)
  }
  return {
    funde,
    ungueltig,
    stand: textOderNull(antwort['stand']),
    weiter: textOderNull(antwort['weiter']),
    ohneLink: zahlOderNull(antwort['ohne_link']) ?? 0
  }
}

/** One page. Network and time-out errors become `BuschtelefonFehler('netz')`; secrets never enter a message. */
export async function holeSeite(
  zugang: Zugang,
  abfrage: Abfrage,
  holen: FetchLike
): Promise<Seite> {
  let antwort: Awaited<ReturnType<FetchLike>>
  let koerper: string
  try {
    antwort = await holen(abfrageUrl(zugang, abfrage), {
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
    throw new BuschtelefonFehler(
      'netz',
      `Das Buschtelefon ist nicht erreichbar: ${
        fehler instanceof Error ? fehler.name : 'Netzfehler'
      }.`
    )
  }
  return liesAntwort(
    antwort.status,
    antwort.headers.get('content-type'),
    koerper
  )
}

export interface Abholung {
  funde: Fund[]
  seiten: number
  ungueltig: number
  ohneLink: number
  stand: string | null
  /**
   * Why the read stopped before the end, when a LATER page failed: the pages
   * before it are returned (the finds arrive oldest first, so what was read
   * is a clean prefix and the stand never moves over a gap). A failure on
   * the first page throws instead.
   */
  abbruch: BuschtelefonFehler | null
}

/**
 * Every page from `seit` on: while `weiter` is set, the next page starts at
 * it. A `weiter` that does not move forward would loop for ever, and a
 * runaway read is capped — both end the read with an `abbruch`, keeping what
 * was read. Finds are deduplicated by `kennung` here too.
 */
export async function holeAlle(
  zugang: Zugang,
  start: { seit: string | null; limit?: number },
  holen: FetchLike,
  maxSeiten: number = MAX_SEITEN
): Promise<Abholung> {
  const gesehen = new Map<string, Fund>()
  let seit = start.seit
  let seiten = 0
  let ungueltig = 0
  let ohneLink = 0
  let stand: string | null = null
  let abbruch: BuschtelefonFehler | null = null

  for (;;) {
    let seite: Seite
    try {
      seite = await holeSeite(
        zugang,
        { seit, ...(start.limit === undefined ? {} : { limit: start.limit }) },
        holen
      )
    } catch (fehler) {
      if (seiten === 0 || !(fehler instanceof BuschtelefonFehler)) throw fehler
      abbruch = fehler
      break
    }
    seiten += 1
    ungueltig += seite.ungueltig
    ohneLink = Math.max(ohneLink, seite.ohneLink)
    stand = seite.stand ?? stand
    for (const fund of seite.funde) gesehen.set(fund.kennung, fund)

    if (seite.weiter === null) break
    if (seite.weiter === seit) {
      abbruch = new BuschtelefonFehler(
        'format',
        'Das Buschtelefon liefert dieselbe Fortsetzung («weiter») zweimal.'
      )
      break
    }
    if (seiten >= maxSeiten) {
      abbruch = new BuschtelefonFehler(
        'format',
        `Mehr als ${maxSeiten} Seiten in einer Abholung: abgebrochen, der nächste Lauf macht weiter.`
      )
      break
    }
    seit = seite.weiter
  }

  const funde = [...gesehen.values()].sort(
    (a, b) =>
      Date.parse(a.erfasst_am) - Date.parse(b.erfasst_am) ||
      a.kennung.localeCompare(b.kennung)
  )
  return { funde, seiten, ungueltig, ohneLink, stand, abbruch }
}
