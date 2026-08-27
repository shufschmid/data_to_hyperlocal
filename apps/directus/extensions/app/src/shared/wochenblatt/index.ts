// Reading a weekly paper's public PDF archive — the network half.
//
// Same manners as the agenda connector: we identify honestly and read only
// what an editor registered, once a day. No bot wall stands here, so there is
// no backoff either — one attempt per run, and a host that is down at 09:00
// gets its retry tomorrow at 09:00. The parsing lives in ./parse and is pure.

import { buildUserAgent } from '../agenda'
import { extractText, getDocumentProxy } from 'unpdf'
import {
  entspreizeVersalien,
  findeIssuuPublicationId,
  findeLocalpointPdf,
  findePdfLink,
  parseArchiv,
  parseIssuuEpaper,
  parseLocalpointEpaper,
  parseLokalzeitungen,
  type ArchivEintrag
} from './parse'

export {
  entspreizeVersalien,
  findeIssuuPublicationId,
  findeLocalpointPdf,
  findePdfLink,
  istNeuer,
  normalisiereSchluessel,
  nummerAusDateiname,
  nummerAusErsterSeite,
  parseArchiv,
  parseDeutschesDatum,
  parseIssuuEpaper,
  parseLocalpointEpaper,
  parseLokalzeitungen,
  seitenLink,
  waehleNeueAusgaben,
  type ArchivEintrag
} from './parse'

/** Which parser reads a paper's archive. The registry row carries the value. */
export type WochenblattKonnektor =
  | 'wordpress-archiv'
  | 'lokalzeitungen'
  | 'issuu'
  | 'localpoint'

/**
 * Issue PDFs from WordPress archives run 5–10 MB; issuu and Localpoint hand
 * out the publisher's ORIGINAL file — measured 34 MB (Wochenblatt Birseck)
 * and 58 MB (BiBo). Anything past this is not a weekly paper.
 */
export const PDF_MAX_BYTES = 80 * 1024 * 1024

export class WochenblattFehler extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message)
    this.name = 'WochenblattFehler'
  }
}

export interface AbrufOptionen {
  /** Contact address put into the User-Agent — who to talk to about this traffic. */
  kontakt: string
  /** Injectable for tests; never hit the network from a unit test. */
  fetchImpl?: typeof fetch
}

/** The archive page, parsed into issue entries (newest first, source order). */
export async function fetchArchiv(
  archivUrl: string,
  options: AbrufOptionen
): Promise<ArchivEintrag[]> {
  const fetchImpl = options.fetchImpl ?? fetch

  const antwort = await fetchImpl(archivUrl, {
    headers: {
      'User-Agent': buildUserAgent(options.kontakt),
      Accept: 'text/html'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  })
  if (!antwort.ok) {
    throw new WochenblattFehler(
      `Archiv antwortete mit ${antwort.status}.`,
      archivUrl
    )
  }

  const eintraege = parseArchiv(await antwort.text(), archivUrl)
  if (eintraege.length === 0) {
    // An empty archive is indistinguishable from a redesign that broke the
    // parser — say so, instead of quietly reporting "nothing new" forever.
    throw new WochenblattFehler(
      'Keine Ausgaben-Links im Archiv gefunden — hat sich der Seitenaufbau geaendert?',
      archivUrl
    )
  }
  return eintraege
}

/**
 * The issue list behind whatever kind of archive the paper has — the one
 * dispatch every caller goes through, so registration form, manual button and
 * 09:00 Flow read a paper identically.
 */
export async function fetchAusgabenliste(
  konnektor: WochenblattKonnektor,
  archivUrl: string,
  options: AbrufOptionen
): Promise<ArchivEintrag[]> {
  if (konnektor === 'wordpress-archiv') return fetchArchiv(archivUrl, options)

  const fetchImpl = options.fetchImpl ?? fetch
  const antwort = await fetchImpl(archivUrl, {
    headers: {
      'User-Agent': buildUserAgent(options.kontakt),
      Accept: 'text/html'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  })
  if (!antwort.ok) {
    throw new WochenblattFehler(
      `Zeitungsseite antwortete mit ${antwort.status}.`,
      archivUrl
    )
  }

  const html = await antwort.text()
  const eintraege =
    konnektor === 'issuu'
      ? parseIssuuEpaper(html)
      : konnektor === 'localpoint'
        ? parseLocalpointEpaper(html, archivUrl)
        : parseLokalzeitungen(html, archivUrl)
  if (eintraege.length === 0) {
    throw new WochenblattFehler(
      'Kein Ausgaben-Link auf der Zeitungsseite gefunden — hat sich der Seitenaufbau geaendert?',
      archivUrl
    )
  }
  return eintraege
}

export interface GeladenesPdf {
  /** Where the redirect actually landed — the address `#page=N` links attach to. */
  pdfUrl: string
  daten: Buffer
}

/**
 * The issue PDF behind an archive entry.
 *
 * Binningen's issue pages 301-redirect straight to the file; following
 * redirects is fetch's default and the landing URL is kept, because that is
 * the address a Meldung's source line must carry — the archive page would
 * lose the `#page=N` fragment in its redirect.
 */
export async function ladeAusgabePdf(
  seiteUrl: string,
  options: AbrufOptionen
): Promise<GeladenesPdf> {
  const fetchImpl = options.fetchImpl ?? fetch

  const antwort = await fetchImpl(seiteUrl, {
    headers: {
      'User-Agent': buildUserAgent(options.kontakt),
      Accept: 'application/pdf,text/html;q=0.5'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000)
  })
  if (!antwort.ok) {
    throw new WochenblattFehler(
      `Ausgabe antwortete mit ${antwort.status}.`,
      seiteUrl
    )
  }

  const typ = antwort.headers.get('content-type') ?? ''
  const daten = Buffer.from(await antwort.arrayBuffer())

  // Content-Type or magic bytes — some WordPress setups serve PDFs as
  // octet-stream, and the first five bytes are the more honest witness.
  const istPdf =
    typ.includes('application/pdf') ||
    daten.subarray(0, 5).toString() === '%PDF-'
  if (!istPdf) {
    throw new WochenblattFehler(
      `Hinter dem Ausgabenlink liegt kein PDF (Content-Type ${typ || 'unbekannt'}).`,
      seiteUrl
    )
  }
  if (daten.length > PDF_MAX_BYTES) {
    throw new WochenblattFehler(
      `PDF ist ${Math.round(daten.length / 1024 / 1024)} MB gross — mehr als die ${Math.round(PDF_MAX_BYTES / 1024 / 1024)}-MB-Grenze.`,
      seiteUrl
    )
  }

  return { pdfUrl: antwort.url || seiteUrl, daten }
}

/**
 * The issue PDF behind whatever kind of issue page the paper has.
 *
 * lokalzeitungen.ch puts a paywall in front of the reader view but links the
 * plain PDF from the issue title — so the page is read once, the first
 * same-host PDF link is followed, and only that free door is ever used.
 *
 * issuu is the same policy through a different door: the reader's download
 * button calls the anonymous `public.reader.download` API, which answers only
 * for documents whose publisher enabled downloads. We call exactly that API —
 * no login, no fingerprint games — and if the publisher turns downloads off,
 * the call fails and the workspace banner says so.
 *
 * Localpoint (the BiBo's CMS) again: the reader's download button opens a
 * plain `files.localpoint.ch` address derived from the reader iframe's own
 * coordinates — public, no login, stable enough for the source line.
 */
export async function ladeAusgabePdfFuer(
  konnektor: WochenblattKonnektor,
  seiteUrl: string,
  options: AbrufOptionen
): Promise<GeladenesPdf> {
  if (konnektor === 'wordpress-archiv') return ladeAusgabePdf(seiteUrl, options)
  if (konnektor === 'issuu') return ladeIssuuPdf(seiteUrl, options)

  const fetchImpl = options.fetchImpl ?? fetch
  const antwort = await fetchImpl(seiteUrl, {
    headers: {
      'User-Agent': buildUserAgent(options.kontakt),
      Accept: 'text/html'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  })
  if (!antwort.ok) {
    throw new WochenblattFehler(
      `Ausgabenseite antwortete mit ${antwort.status}.`,
      seiteUrl
    )
  }

  const seite = await antwort.text()
  const pdfUrl =
    konnektor === 'localpoint'
      ? findeLocalpointPdf(seite)
      : findePdfLink(seite, seiteUrl)
  if (pdfUrl === null) {
    throw new WochenblattFehler(
      'Kein PDF-Link auf der Ausgabenseite gefunden — hat sich der Seitenaufbau geaendert?',
      seiteUrl
    )
  }

  return ladeAusgabePdf(pdfUrl, options)
}

/**
 * The original PDF behind an issuu reader page: document page → publicationId
 * → the publisher-enabled download API → a signed S3 address.
 *
 * The returned `pdfUrl` is the READER page, not the download address: the
 * signature expires within the hour, while the reader page is the stable
 * address a source line can deep-link (`…/docs/<slug>/<seite>`).
 */
async function ladeIssuuPdf(
  seiteUrl: string,
  options: AbrufOptionen
): Promise<GeladenesPdf> {
  const fetchImpl = options.fetchImpl ?? fetch
  const kopf = {
    'User-Agent': buildUserAgent(options.kontakt)
  }

  const seite = await fetchImpl(seiteUrl, {
    headers: { ...kopf, Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  })
  if (!seite.ok) {
    throw new WochenblattFehler(
      `issuu-Dokumentseite antwortete mit ${seite.status}.`,
      seiteUrl
    )
  }
  const publicationId = findeIssuuPublicationId(await seite.text())
  if (publicationId === null) {
    throw new WochenblattFehler(
      'Keine publicationId auf der issuu-Dokumentseite gefunden — hat sich der Seitenaufbau geaendert?',
      seiteUrl
    )
  }

  const input = encodeURIComponent(JSON.stringify({ json: { publicationId } }))
  const auskunftUrl = `https://issuu.com/api/content-service/public.reader.download?input=${input}`
  const auskunft = await fetchImpl(auskunftUrl, {
    headers: { ...kopf, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000)
  })
  if (!auskunft.ok) {
    throw new WochenblattFehler(
      `Die issuu-Download-Auskunft antwortete mit ${auskunft.status} — hat der Verlag den Download abgeschaltet?`,
      seiteUrl
    )
  }
  const antwort = (await auskunft.json()) as {
    result?: { data?: { json?: { url?: unknown } } }
  }
  const downloadUrl = antwort.result?.data?.json?.url
  if (typeof downloadUrl !== 'string' || !/^https:\/\//.test(downloadUrl)) {
    throw new WochenblattFehler(
      'Die issuu-Download-Auskunft nannte keine Download-Adresse — hat der Verlag den Download abgeschaltet?',
      seiteUrl
    )
  }

  const pdf = await ladeAusgabePdf(downloadUrl, options)
  return { pdfUrl: seiteUrl, daten: pdf.daten }
}

export interface Textlayer {
  seiten: number
  text: string
  /** One entry per page — the transport when the PDF outgrows an API request. */
  seitenTexte: string[]
}

/**
 * The PDF's text layer — the corpus the verbatim-overlap check runs against,
 * and the page count the inventory's answers are validated with. Pure JS
 * (unpdf), no GPU, no native binary.
 */
export async function extrahiereText(daten: Buffer): Promise<Textlayer> {
  const pdf = await getDocumentProxy(new Uint8Array(daten))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  // Un-space letter-spaced headers so the text-transport inventory can still
  // read the municipality rubric; body prose is untouched, so the verbatim
  // overlap check against `text` is unaffected.
  const seitenTexte = text.map(entspreizeVersalien)
  return {
    seiten: totalPages,
    text: seitenTexte.join('\n\n'),
    seitenTexte
  }
}
