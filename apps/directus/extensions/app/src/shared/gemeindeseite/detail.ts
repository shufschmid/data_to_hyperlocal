// The detail page of one news item — title, date, lead, body, documents.
//
// Three template families, one generic fallback. The family parsers know
// where each template keeps its article; the fallback strips navigation and
// takes what is left, and says so (`verfahren: 'generisch'`) so the row can
// carry the caveat. Nothing here fetches; the reader hands the HTML in.

import { parseDatum, type Heute } from './datum'
import type { DetailFamilie } from './erkennung'
import {
  blockZuText,
  entferneElemente,
  ohneUnsichtbares,
  reinerText,
  schneideElement
} from './text'
import {
  gleicheSite,
  istDokumentAdresse,
  istEigeneSeite,
  normalisiereUrl
} from './url'

export interface Dokument {
  bezeichnung: string
  url: string
  /** The site's own label of type and size, e.g. "(PDF, 171 kB)". */
  typHinweis: string | null
}

export interface DetailInhalt {
  titel: string | null
  datum: string | null
  lead: string | null
  /** Plain text with blank-line paragraph breaks; '' when nothing was found. */
  text: string
  dokumente: Dokument[]
  /** `<link rel="canonical">` or `og:url`, same site only. */
  kanonisch: string | null
  verfahren: DetailFamilie | 'generisch'
}

const ANKER = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a\s*>/gi

function metaInhalt(html: string, name: string): string | null {
  const a = new RegExp(
    `<meta\\s+(?:property|name)="${name}"\\s+content="([^"]*)"`,
    'i'
  ).exec(html)
  const b = new RegExp(
    `<meta\\s+content="([^"]*)"\\s+(?:property|name)="${name}"`,
    'i'
  ).exec(html)
  const wert = a?.[1] ?? b?.[1] ?? null
  return wert === null ? null : reinerText(wert) || null
}

const SITENAME =
  /\b(?:Gemeinde|Stadt|Einwohnergemeinde|Bürgergemeinde|Gemeindeverwaltung)\b/

/**
 * `og:title`, else the `<title>` minus the site name — which sits first on some
 * templates ("Aesch BL - …") and last on others ("… – Gemeinde Binningen"). A
 * segment naming the Gemeinde is the site; failing that, the longest segment
 * is the title.
 */
export function metaTitel(html: string): string | null {
  const og = metaInhalt(html, 'og:title')
  if (og !== null) return og
  const titel = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1]
  if (titel === undefined) return null
  const teile = reinerText(titel)
    .split(/\s+[-–|]\s+/)
    .map((t) => t.trim())
    .filter((t) => t !== '')
  if (teile.length === 0) return null
  const ohneSite = teile.filter((t) => !SITENAME.test(t))
  const kandidaten =
    ohneSite.length > 0 && ohneSite.length < teile.length ? ohneSite : teile
  return kandidaten.reduce((a, b) => (b.length > a.length ? b : a))
}

function kanonischVon(html: string, seiteUrl: string): string | null {
  const link =
    /<link\b[^>]*\brel="canonical"[^>]*\bhref="([^"]+)"/i.exec(html)?.[1] ??
    /<link\b[^>]*\bhref="([^"]+)"[^>]*\brel="canonical"/i.exec(html)?.[1] ??
    metaInhalt(html, 'og:url')
  if (link === null || link === undefined) return null
  const url = normalisiereUrl(link, seiteUrl)
  return url !== null && gleicheSite(url, seiteUrl) ? url : null
}

function dokumenteAus(
  fragment: string,
  seiteUrl: string,
  typHinweis?: (nachAnker: string) => string | null
): Dokument[] {
  const gefunden: Dokument[] = []
  const gesehen = new Set<string>()
  for (const treffer of fragment.matchAll(ANKER)) {
    const url = normalisiereUrl(treffer[1] ?? '', seiteUrl)
    if (
      url === null ||
      !istDokumentAdresse(url) ||
      istEigeneSeite(url, seiteUrl) ||
      gesehen.has(url)
    )
      continue
    gesehen.add(url)
    const titelAttribut = /\btitle="([^"]*)"/i.exec(treffer[0])?.[1]
    const text = reinerText(treffer[2] ?? '')
    const dateiname = decodeURIComponent(url.split('/').pop() ?? '').replace(
      /\.[a-z0-9]+$/i,
      ''
    )
    const bezeichnung =
      text !== '' && text.toLowerCase() !== 'download'
        ? text
        : reinerText(titelAttribut ?? '') || dateiname
    const danach = fragment.slice(
      (treffer.index ?? 0) + treffer[0].length,
      (treffer.index ?? 0) + treffer[0].length + 200
    )
    gefunden.push({
      bezeichnung,
      url,
      typHinweis: typHinweis?.(danach) ?? null
    })
  }
  return gefunden
}

/**
 * The Weblication content block: from the first `<!--CONTENT:START-->` after
 * the `blockContent…Inner` element to its matching `<!--CONTENT:STOP-->`. The
 * markers nest (included content pages carry their own pair), hence the
 * depth count. Exported for its own tests.
 */
export function inhaltsblockWeblication(html: string): string | null {
  const anker = html.search(/(?:id|class)="[^"]*blockContent\w*Inner/)
  if (anker === -1) return null
  const start = html.indexOf('<!--CONTENT:START-->', anker)
  if (start === -1) return null

  const muster = /<!--CONTENT:(START|STOP)-->/g
  muster.lastIndex = start + '<!--CONTENT:START-->'.length
  let tiefe = 1
  let treffer: RegExpExecArray | null
  while ((treffer = muster.exec(html)) !== null) {
    tiefe += treffer[1] === 'START' ? 1 : -1
    if (tiefe === 0)
      return html.slice(start + '<!--CONTENT:START-->'.length, treffer.index)
  }
  return html.slice(start + '<!--CONTENT:START-->'.length)
}

export function parseWeblicationDetail(
  html: string,
  seiteUrl: string,
  heute: Heute
): DetailInhalt {
  const block = inhaltsblockWeblication(html) ?? ''

  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(block)
  const headline =
    /<div\b[^>]*\bclass="[^"]*\belementHeadline\b[^"]*"[^>]*>[\s\S]*?<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/i.exec(
      block
    )
  const titel =
    (h1 === null ? null : reinerText(h1[1] ?? '') || null) ??
    metaTitel(html) ??
    (headline === null ? null : reinerText(headline[1] ?? '') || null)

  const subline =
    /<p\b[^>]*\bclass="[^"]*\bsubline\b[^"]*"[^>]*>([\s\S]*?)<\/p\s*>/i.exec(
      block
    )
  const datum =
    subline === null ? null : parseDatum(reinerText(subline[1] ?? ''), heute)
  const description =
    /<p\b[^>]*\bclass="[^"]*\bdescription\b[^"]*"[^>]*>([\s\S]*?)<\/p\s*>/i.exec(
      block
    )
  const lead =
    description === null ? null : reinerText(description[1] ?? '') || null

  let koerper = ohneUnsichtbares(block)
    .replace(/<h1\b[^>]*>[\s\S]*?<\/h1\s*>/i, ' ')
    .replace(
      /<p\b[^>]*\bclass="[^"]*\bsubline\b[^"]*"[^>]*>[\s\S]*?<\/p\s*>/i,
      ' '
    )
    .replace(
      /<p\b[^>]*\bclass="[^"]*\bdescription\b[^"]*"[^>]*>[\s\S]*?<\/p\s*>/i,
      ' '
    )
  for (const klasse of [
    'elementHeadline',
    'elementLinkBack',
    'elementList-prevNext',
    'elementLinkPrint'
  ]) {
    koerper = entferneElemente(koerper, klasse)
  }

  return {
    titel,
    datum,
    lead,
    text: blockZuText(koerper),
    dokumente: dokumenteAus(block, seiteUrl),
    kanonisch: kanonischVon(html, seiteUrl),
    verfahren: 'weblication'
  }
}

/** i-web's main block: between its own `icms:blockMain` comments, else from the first content column to the footer. */
function iwebHauptblock(html: string): string {
  const start = html.indexOf('icms:blockMain start')
  const ende = html.indexOf('icms:blockMain end')
  if (start !== -1 && ende > start) return html.slice(start, ende)
  const spalteStart = html.search(/\bclass="[^"]*\bicms-content-col-a\b/i)
  const spalteEnde = html.search(/<footer\b/i)
  if (spalteStart === -1) return html
  return html.slice(spalteStart, spalteEnde === -1 ? undefined : spalteEnde)
}

export function parseIwebDetail(
  html: string,
  seiteUrl: string,
  heute: Heute
): DetailInhalt {
  let titel = metaTitel(html)
  if (titel === null) {
    for (const treffer of html.matchAll(/<h1\b([^>]*)>([\s\S]*?)<\/h1\s*>/gi)) {
      if (/sr-only|modal-title/i.test(treffer[1] ?? '')) continue
      titel = reinerText(treffer[2] ?? '') || null
      if (titel !== null) break
    }
  }

  const datumHtml =
    /<div\b[^>]*\bclass="[^"]*\bicms-information-date\b[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/i.exec(
      html
    )
  const datum =
    datumHtml === null
      ? null
      : parseDatum(reinerText(datumHtml[1] ?? ''), heute)

  // The article lives in the main block; the footer carries its own wysiwyg
  // boxes (opening hours), which must not become part of the text.
  const spalte = iwebHauptblock(html)

  const leadStart = spalte.search(
    /<div\b[^>]*\bclass="[^"]*\bicms-lead-container\b[^"]*"[^>]*>/i
  )
  const leadEnde =
    leadStart === -1
      ? -1
      : leadStart + schneideElement(spalte, leadStart).length
  let lead: string | null = null
  const bloecke: string[] = []
  for (const treffer of spalte.matchAll(
    /<div\b[^>]*\bclass="[^"]*\bicms-wysiwyg\b[^"]*"[^>]*>/gi
  )) {
    const start = treffer.index ?? 0
    const text = blockZuText(schneideElement(spalte, start))
    if (text === '') continue
    if (
      leadStart !== -1 &&
      start > leadStart &&
      start < leadEnde &&
      lead === null
    )
      lead = text
    else bloecke.push(text)
  }

  return {
    titel,
    datum,
    lead,
    text: bloecke.join('\n\n'),
    dokumente: dokumenteAus(spalte, seiteUrl, (danach) => {
      const hinweis =
        /^\s*<span\b[^>]*\bicms-document-type-and-size\b[^>]*>([^<]*)<\/span>/i.exec(
          danach
        )
      return hinweis === null ? null : reinerText(hinweis[1] ?? '') || null
    }),
    kanonisch: kanonischVon(html, seiteUrl),
    verfahren: 'iweb'
  }
}

export function parseBackslashDetail(
  html: string,
  seiteUrl: string,
  heute: Heute
): DetailInhalt {
  const h1 =
    /<h1\b[^>]*\bclass="[^"]*\bmain__title\b[^"]*"[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(
      html
    )
  const titel =
    (h1 === null ? null : reinerText(h1[1] ?? '') || null) ?? metaTitel(html)

  const meta =
    /<p\b[^>]*\bclass="[^"]*\bmod-entry-meta\b[^"]*"[^>]*>([\s\S]*?)<\/p\s*>/i.exec(
      html
    )?.[1] ?? ''
  const time = /<time\b([^>]*)>([\s\S]*?)<\/time\s*>/i.exec(meta)
  let datum: string | null = null
  if (time !== null) {
    const attribut = (
      /\bdatetime="([^"]+)"/i.exec(time[1] ?? '')?.[1] ?? ''
    ).slice(0, 10)
    datum =
      parseDatum(attribut, heute) ??
      parseDatum(reinerText(time[2] ?? ''), heute)
  }

  const leadHtml =
    /<h3\b[^>]*\bclass="[^"]*\blead\b[^"]*"[^>]*>([\s\S]*?)<\/h3\s*>/i.exec(
      html
    )
  const lead = leadHtml === null ? null : reinerText(leadHtml[1] ?? '') || null

  const inhaltStart = html.search(
    /<div\b[^>]*\bclass="[^"]*\bnews-content\b[^"]*"[^>]*>/i
  )
  const inhalt = inhaltStart === -1 ? '' : schneideElement(html, inhaltStart)
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html)?.[1] ?? inhalt

  return {
    titel,
    datum,
    lead,
    text: blockZuText(inhalt),
    dokumente: dokumenteAus(main, seiteUrl),
    kanonisch: kanonischVon(html, seiteUrl),
    verfahren: 'backslash'
  }
}

/**
 * Unknown layout: the page minus header, navigation, footer and asides. The
 * date comes only from machine-readable places — a date fished out of prose
 * would be anybody's date.
 */
export function parseGenerischesDetail(
  html: string,
  seiteUrl: string,
  heute: Heute
): DetailInhalt {
  let titel = metaTitel(html)
  if (titel === null) {
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html)
    titel = h1 === null ? null : reinerText(h1[1] ?? '') || null
  }

  const veroeffentlicht = metaInhalt(html, 'article:published_time')
  const time = /<time\b[^>]*\bdatetime="([^"]+)"/i.exec(html)?.[1] ?? null
  const datum =
    (veroeffentlicht === null ? null : parseDatum(veroeffentlicht, heute)) ??
    (time === null ? null : parseDatum(time, heute))

  const main =
    /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html)?.[1] ??
    /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html)?.[1] ??
    html
  const bereinigt = main.replace(
    /<(header|nav|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    ' '
  )

  return {
    titel,
    datum,
    lead: null,
    text: blockZuText(bereinigt),
    dokumente: dokumenteAus(bereinigt, seiteUrl),
    kanonisch: kanonischVon(html, seiteUrl),
    verfahren: 'generisch'
  }
}

/**
 * The family parser, with the generic one behind it: when a template changed
 * under us and the family parser finds no body, the page is still read — and
 * the result says which way it was read.
 */
export function parseDetail(
  html: string,
  familie: DetailFamilie,
  seiteUrl: string,
  heute: Heute
): DetailInhalt {
  const eigen =
    familie === 'weblication'
      ? parseWeblicationDetail(html, seiteUrl, heute)
      : familie === 'iweb'
        ? parseIwebDetail(html, seiteUrl, heute)
        : parseBackslashDetail(html, seiteUrl, heute)
  if (eigen.text.trim() !== '') return eigen

  const generisch = parseGenerischesDetail(html, seiteUrl, heute)
  return {
    ...generisch,
    titel: eigen.titel ?? generisch.titel,
    datum: eigen.datum ?? generisch.datum,
    lead: eigen.lead ?? generisch.lead,
    dokumente:
      eigen.dokumente.length > 0 ? eigen.dokumente : generisch.dokumente,
    verfahren: 'generisch'
  }
}
