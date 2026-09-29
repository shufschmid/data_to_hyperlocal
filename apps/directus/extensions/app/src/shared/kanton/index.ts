import { buildUserAgent } from '../agenda/index'
import {
  parseDetail,
  parseListe,
  type Detail,
  type KantonListe,
  type Liste
} from './api'

export * from './api'

// The small JSON client for the canton's data door — deliberately not the
// polite page reader of `shared/gemeindeseite/`: that one reads `robots.txt`
// per origin, and on the API host that path redirects to /login and answers
// 403. The API is a documented service the site itself calls, read
// identified, once a day, for two listing blocks and one detail per new
// item. Data doors never take the crawler (`fuerZweiteTuer` would refuse a
// JSON Accept anyway), and the client refuses any host but the configured
// one, so nothing here can ever fetch the public site behind its challenge.

export class KantonFehler extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message)
    this.name = 'KantonFehler'
  }
}

export interface KantonLeserOptionen {
  kontakt: string
  /** The API host every request must stay on. */
  basisUrl: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Pause between two requests; a data door, not a page, so two seconds are plenty. */
  pauseMs?: number
  /** A list of 100 measures ~100 KB; anything past this is not an answer we expect. */
  maxBytes?: number
}

export interface KantonLeser {
  liesJson(url: string): Promise<unknown>
  protokoll(): { anfragen: number }
}

export const KANTON_PAUSE_MS = 2000
export const KANTON_MAX_BYTES = 2 * 1024 * 1024

const wirklichSchlafen = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

function lohntWiederholung(status: number | null): boolean {
  return status === null || status >= 500 || status === 429
}

export function erstelleKantonLeser(
  optionen: KantonLeserOptionen
): KantonLeser {
  const fetchImpl = optionen.fetchImpl ?? fetch
  const sleep = optionen.sleep ?? wirklichSchlafen
  const pauseMs = optionen.pauseMs ?? KANTON_PAUSE_MS
  const maxBytes = optionen.maxBytes ?? KANTON_MAX_BYTES
  const host = new URL(optionen.basisUrl).host
  const userAgent = buildUserAgent(optionen.kontakt)
  let anfragen = 0
  let zuletzt: number | null = null

  async function einmal(
    url: string
  ): Promise<
    | { ok: true; json: unknown }
    | { ok: false; status: number | null; text: string }
  > {
    if (zuletzt !== null) {
      const warten = pauseMs - (Date.now() - zuletzt)
      if (warten > 0) await sleep(warten)
    }
    zuletzt = Date.now()
    anfragen += 1
    let antwort: Response
    try {
      antwort = await fetchImpl(url, {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json',
          'Accept-Language': 'de-CH,de;q=0.9'
        },
        redirect: 'manual'
      })
    } catch (fehler) {
      return {
        ok: false,
        status: null,
        text: fehler instanceof Error ? fehler.message : String(fehler)
      }
    }
    if (!antwort.ok)
      return {
        ok: false,
        status: antwort.status,
        text: `HTTP ${antwort.status}`
      }
    const typ = antwort.headers.get('content-type') ?? ''
    if (!/json/i.test(typ))
      throw new KantonFehler(
        `Die Datentuer antwortete nicht mit JSON (${typ || 'ohne Content-Type'}).`,
        url
      )
    const daten = Buffer.from(await antwort.arrayBuffer())
    if (daten.byteLength > maxBytes)
      throw new KantonFehler(
        `Die Antwort ist zu gross (${daten.byteLength} Bytes, Deckel ${maxBytes}).`,
        url
      )
    try {
      return { ok: true, json: JSON.parse(daten.toString('utf8')) as unknown }
    } catch {
      throw new KantonFehler('Die Antwort ist kein lesbares JSON.', url)
    }
  }

  return {
    async liesJson(url: string): Promise<unknown> {
      let ziel: URL
      try {
        ziel = new URL(url)
      } catch {
        throw new KantonFehler('Keine gueltige Adresse.', url)
      }
      if (ziel.host !== host || ziel.protocol !== 'https:')
        throw new KantonFehler(
          `Die Adresse liegt nicht auf der Datentuer ${host} — nicht gelesen.`,
          url
        )
      const erste = await einmal(url)
      if (erste.ok) return erste.json
      if (!lohntWiederholung(erste.status))
        throw new KantonFehler(`Die Datentuer antwortete ${erste.text}.`, url)
      // One second attempt for a transient refusal — the agenda's lesson,
      // without its five-step patience: this door has never shown a challenge.
      await sleep(pauseMs)
      const zweite = await einmal(url)
      if (zweite.ok) return zweite.json
      throw new KantonFehler(
        `Die Datentuer antwortete zweimal ${zweite.text}.`,
        url
      )
    },
    protokoll: () => ({ anfragen })
  }
}

/** The first page of a listing block, newest first. */
export async function liesListe(
  leser: KantonLeser,
  basisUrl: string,
  liste: KantonListe,
  bSize: number
): Promise<Liste> {
  const url = `${basisUrl.replace(/\/$/, '')}${liste.pfad}?b_size=${bSize}`
  return parseListe(await leser.liesJson(url))
}

/** One item, by its API address. */
export async function liesDetail(
  leser: KantonLeser,
  apiId: string
): Promise<Detail> {
  return parseDetail(await leser.liesJson(apiId))
}
