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
import { passtDurchsLimit } from './bilder'
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

/** Page size of the list endpoint, and how many pages one query may walk. */
const LISTE_SEITENGROESSE = 200
const LISTE_MAX_SEITEN = 5

function listenUrl(
  params: Record<string, string | string[]>,
  seite: number
): string {
  const such = new URLSearchParams()
  such.set('publicationStates', 'PUBLISHED')
  such.set('pageRequest.size', String(LISTE_SEITENGROESSE))
  such.set('pageRequest.page', String(seite))
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
export interface PublikationsListe {
  treffer: AmtsblattTreffer[]
  /**
   * True when a query still returned a full page at the walk's end — there is
   * more the run did not see. The caller REPORTS this: a triage verdict of
   * "nothing newsworthy today" computed over a truncated day is exactly the
   * silent failure this project must not have. simap's connector had this flag
   * from the start; the gazette side used to read one page of 200 and stop.
   */
  abgeschnitten: boolean
}

export async function fetchPublikationen(
  gemeinde: GemeindeSchluessel,
  seit: string,
  options: AbrufOptionen
): Promise<PublikationsListe> {
  const abfragen: Record<string, string | string[]>[] = [
    {
      municipalityId: String(gemeinde.bfsNummer),
      'publicationDate.start': seit
    }
  ]
  if (gemeinde.plz.length > 0)
    abfragen.push({
      municipalityZipCodes: gemeinde.plz.join(','),
      'publicationDate.start': seit
    })

  const gesehen = new Set<string>()
  const alle: Publikation[] = []
  let abgeschnitten = false
  // Sequential on purpose — see `hole`.
  for (const params of abfragen) {
    for (let seite = 0; seite < LISTE_MAX_SEITEN; seite += 1) {
      const antwort = await hole(listenUrl(params, seite), options, 'text/csv')
      const zeilen = parseListe(await antwort.text())
      for (const p of zeilen) {
        if (gesehen.has(p.id)) continue
        gesehen.add(p.id)
        alle.push(p)
      }
      if (zeilen.length < LISTE_SEITENGROESSE) break
      if (seite === LISTE_MAX_SEITEN - 1) abgeschnitten = true
    }
  }

  return { treffer: anreichern(alle), abgeschnitten }
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
 * Bounded three times over: a building file is a handful of sheets, and the
 * request has to fit. Anthropic takes 5 MB per image, 32 MB per request and at
 * most 8000 pixels per image edge; base64 inflates by a third. Measured sheets
 * run 330–440 KB, so eight is generous — but the PIXEL limit bites where the
 * byte limit does not: Binningen's dossier 0275/2026 carried a 8433-pixel-wide
 * scan at 2.6 MB, and the whole request came back 400. Sheets that do not fit
 * are left out, counted, and the count travels to the desk and into the
 * article — see `plan_blaetter`.
 */
export const PLAN_MAX_BILDER = 8
export const PLAN_MAX_BYTES = 4 * 1024 * 1024

export interface Planbilder {
  bilder: Planbild[]
  /** How many sheets the gallery names — the denominator of the honesty note. */
  gesamt: number
  /**
   * Sheets FETCHED and measured too large (bytes or pixels). Everything else
   * left out sat beyond `PLAN_MAX_BILDER` and was never even requested — the
   * two reasons read differently on the desk, and calling an unfetched sheet
   * "zu gross" would be a claim nobody measured.
   */
  zuGross: number
}

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
): Promise<Planbilder> {
  const seite = await hole(seiteUrl, options, 'text/html')
  const adressen = planBilder(await seite.text(), seiteUrl)

  const bilder: Planbild[] = []
  let zuGross = 0
  for (const url of adressen.slice(0, PLAN_MAX_BILDER)) {
    const antwort = await hole(url, options, 'image/*')
    const puffer = Buffer.from(await antwort.arrayBuffer())
    // Too many bytes, or wider/taller than the API accepts: the sheet stays
    // out, the caller counts it, and the article says so. See
    // shared/amtsblatt/bilder.ts.
    if (puffer.byteLength > PLAN_MAX_BYTES || !passtDurchsLimit(puffer)) {
      zuGross += 1
      continue
    }
    bilder.push({
      url,
      medienTyp: url.toLowerCase().endsWith('.png')
        ? 'image/png'
        : 'image/jpeg',
      base64: puffer.toString('base64'),
      bytes: puffer.byteLength
    })
  }
  return { bilder, gesamt: adressen.length, zuGross }
}

/** The readable documents of a publication, if any. */
export function lesbareUnterlagen(
  unterlagen: readonly Unterlage[]
): Unterlage[] {
  return unterlagen.filter((u) => u.lesbar)
}
