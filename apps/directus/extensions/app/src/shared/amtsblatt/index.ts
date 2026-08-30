// Reading the Swiss official gazette portal — the network half.
//
// The portal carries every canton's gazette plus the federal SHAB, which is
// what makes it the first source that covers the whole newsroom area: Riehen
// (BS) and Dornach (SO) arrive through the same door as the Baselland
// municipalities, where the statistics portals are cantonal and silent about
// them.
//
// Published items need no credentials — that is documented, and measured. The
// site's robots.txt is a blanket disallow, which is about crawling its pages;
// we use the documented API instead, identify ourselves, and read only the
// municipalities an editor registered, once a day.
//
// Parsing lives in ./parse and is pure.

import { buildUserAgent } from '../agenda'
import {
  gruppeVon,
  parseInhalt,
  parseListe,
  planBilder,
  quellenlink,
  rubrikName,
  type Gruppe,
  type Inhalt,
  type Publikation,
  type Unterlage
} from './parse'

export {
  GRUPPEN_TEXT,
  gruppeVon,
  parseCsv,
  parseInhalt,
  parseListe,
  planBilder,
  quellenlink,
  rubrikName,
  type Angabe,
  type Gruppe,
  type Inhalt,
  type Publikation,
  type Unterlage
} from './parse'

const BASIS = 'https://amtsblattportal.ch/api/v1'

export class AmtsblattFehler extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message)
    this.name = 'AmtsblattFehler'
  }
}

export interface AbrufOptionen {
  kontakt: string
  fetchImpl?: typeof fetch
}

/**
 * One request, with the manners the other connectors use and one addition:
 * a spaced retry.
 *
 * Measured while exploring this API — two requests fired in parallel ran into
 * a connection timeout where the same two in sequence both answered. The
 * portal is not rejecting us, it is simply not built for bursts, so the
 * connector never overlaps its own requests and waits longer each time.
 */
async function hole(
  url: string,
  options: AbrufOptionen,
  accept: string,
  versuche = 3
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch
  let zuletzt: unknown = null

  for (let i = 0; i < versuche; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 4000 * 2 ** (i - 1)))
    try {
      const antwort = await fetchImpl(url, {
        headers: {
          'User-Agent': buildUserAgent(options.kontakt),
          Accept: accept,
          'Accept-Language': 'de-CH,de;q=0.9'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(60_000)
      })
      if (antwort.ok) return antwort
      // 4xx is an answer, not a hiccup — asking again cannot change it.
      if (antwort.status < 500)
        throw new AmtsblattFehler(
          `Amtsblattportal antwortete mit ${antwort.status}.`,
          url
        )
      zuletzt = new AmtsblattFehler(`HTTP ${antwort.status}`, url)
    } catch (cause) {
      if (cause instanceof AmtsblattFehler && !cause.message.startsWith('HTTP'))
        throw cause
      zuletzt = cause
    }
  }

  throw new AmtsblattFehler(
    `Amtsblattportal nach ${versuche} Versuchen nicht erreichbar: ` +
      `${zuletzt instanceof Error ? zuletzt.message : String(zuletzt)}`,
    url
  )
}

function listenUrl(params: Record<string, string | string[]>): string {
  const such = new URLSearchParams()
  such.set('publicationStates', 'PUBLISHED')
  such.set('pageRequest.size', '200')
  for (const [k, v] of Object.entries(params))
    for (const e of Array.isArray(v) ? v : [v]) such.append(k, e)
  return `${BASIS}/publications/csv?${such.toString()}`
}

/** A municipality as the connector needs it: the gazetteer key and its postcodes. */
export interface GemeindeSchluessel {
  bfsNummer: number
  /** Empty means the SHAB half (commercial register, bankruptcies) stays silent. */
  plz: readonly string[]
}

export interface AmtsblattTreffer extends Publikation {
  gruppe: Gruppe
  rubrikName: string
  pdfUrl: string
}

function anreichern(rohe: Publikation[]): AmtsblattTreffer[] {
  const treffer: AmtsblattTreffer[] = []
  for (const p of rohe) {
    const gruppe = gruppeVon(p.rubrik, p.unterrubrik)
    // A rubric nobody collects — job adverts, lost securities — is dropped
    // here rather than filling the desk for someone to reject one by one.
    if (gruppe === null) continue
    treffer.push({
      ...p,
      gruppe,
      rubrikName: rubrikName(p.rubrik, p.unterrubrik),
      pdfUrl: quellenlink(p.id)
    })
  }
  return treffer
}

/**
 * Everything published about one municipality since a date.
 *
 * TWO requests, because the portal indexes publications two different ways and
 * the sets do not overlap at all. Measured for Pratteln in August 2026:
 * `municipalityId` returned 14, `municipalityZipCodes` returned 65, and not one
 * of the 65 was among the 14. What is anchored to a PLACE — building permits,
 * property transfers, traffic orders, planning — answers to the gazetteer
 * number; what is anchored to an ADDRESS — commercial register, bankruptcies,
 * payment orders — answers to the postcode. Asking only one way loses half the
 * municipality.
 *
 * `municipalityName` is deliberately unused: the portal accepts it, answers
 * 200, and silently ignores it. Asking for "Riehen" that way returned Zurich
 * fire bans.
 */
export async function fetchPublikationen(
  gemeinde: GemeindeSchluessel,
  seit: string,
  options: AbrufOptionen
): Promise<AmtsblattTreffer[]> {
  const abfragen: string[] = [
    listenUrl({
      municipalityId: String(gemeinde.bfsNummer),
      'publicationDate.start': seit
    })
  ]
  if (gemeinde.plz.length > 0)
    abfragen.push(
      listenUrl({
        municipalityZipCodes: gemeinde.plz.join(','),
        'publicationDate.start': seit
      })
    )

  const gesehen = new Set<string>()
  const alle: Publikation[] = []
  // Sequential on purpose — see `hole`.
  for (const url of abfragen) {
    const antwort = await hole(url, options, 'text/csv')
    for (const p of parseListe(await antwort.text())) {
      if (gesehen.has(p.id)) continue
      gesehen.add(p.id)
      alle.push(p)
    }
  }

  return anreichern(alle)
}

/** The single publication's facts, links and deadline. */
export async function fetchInhalt(
  id: string,
  options: AbrufOptionen
): Promise<Inhalt> {
  const url = `${BASIS}/publications/${id}/xml`
  const antwort = await hole(url, options, 'application/xml')
  return parseInhalt(await antwort.text())
}

/** One plan sheet, ready to travel to the model as an image block. */
export interface Planbild {
  url: string
  medienTyp: 'image/jpeg' | 'image/png'
  base64: string
  bytes: number
}

/**
 * Bounded twice over: a building file is a handful of sheets, and the request
 * has to fit. Anthropic takes 5 MB per image and 32 MB per request; base64
 * inflates by a third. Measured sheets run 330–440 KB, so eight is generous
 * and still far inside both limits.
 */
export const PLAN_MAX_BILDER = 8
export const PLAN_MAX_BYTES = 4 * 1024 * 1024

/**
 * The building plans behind a Baselland permit.
 *
 * `bgauflage.bl.ch` is a plain image gallery with no login — the same door the
 * public uses during the objection period, and the reason this feature can
 * look at plans at all. It is also the reason it works for Baselland only:
 * Basel-Stadt links its own planning application viewer, and Solothurn's eBau
 * portal is a single-page app whose API answers 401. Those links are shown,
 * never read, and `Unterlage.lesbar` is what says which is which.
 */
export async function fetchPlanbilder(
  seiteUrl: string,
  options: AbrufOptionen
): Promise<Planbild[]> {
  const seite = await hole(seiteUrl, options, 'text/html')
  const adressen = planBilder(await seite.text(), seiteUrl)

  const bilder: Planbild[] = []
  for (const url of adressen.slice(0, PLAN_MAX_BILDER)) {
    const antwort = await hole(url, options, 'image/*')
    const puffer = Buffer.from(await antwort.arrayBuffer())
    if (puffer.byteLength > PLAN_MAX_BYTES) continue
    bilder.push({
      url,
      medienTyp: url.toLowerCase().endsWith('.png')
        ? 'image/png'
        : 'image/jpeg',
      base64: puffer.toString('base64'),
      bytes: puffer.byteLength
    })
  }
  return bilder
}

/** The readable documents of a publication, if any. */
export function lesbareUnterlagen(
  unterlagen: readonly Unterlage[]
): Unterlage[] {
  return unterlagen.filter((u) => u.lesbar)
}
