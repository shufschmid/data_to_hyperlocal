// The news list of a municipal website — one parser per template family.
//
// What every family yields is the same small record: an absolute link (the
// item's identity), a title, a teaser where the list prints one, and a date
// where one can be trusted. The date is the delicate part — see `datum.ts` —
// so every parser says WHERE its date came from, and the run treats a badge
// without a year as weaker than a full date on the detail page.

import { decodeEntities } from '../agenda/parse'
import {
  jahrFuerMonatTag,
  monatVon,
  parseDatum,
  plausibel,
  type Heute
} from './datum'
import type { Plattform } from './erkennung'
import { reinerText } from './text'
import { gleicheSite, istPdfAdresse, normalisiereUrl } from './url'

export interface ListenEintrag {
  /** Normalized, absolute, same-site — THE identity of the item. */
  url: string
  titel: string
  teaser: string | null
  /** ISO date, or null when the list prints none we can trust. */
  datum: string | null
  /** `kalender`: month + day badge, year inferred — a full date on the detail page beats it. */
  datumQuelle: 'liste' | 'kalender' | null
  /** i-web's `_kategorieId` (news, politik_info, wahlergebnisse); other templates have none. */
  kategorie: string | null
  /** The list links a file, not a page — the item IS the document. */
  direktPdf: boolean
}

const ANKER = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a\s*>/i

function klassenElement(
  html: string,
  klasse: string,
  tags = '[a-z][a-z0-9]*'
): string | null {
  const muster = new RegExp(
    `<(${tags})\\b[^>]*\\bclass="[^"]*\\b${klasse}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`,
    'i'
  )
  return muster.exec(html)?.[2] ?? null
}

function eintrag(
  href: string | null,
  titel: string,
  teil: Omit<ListenEintrag, 'url' | 'titel' | 'direktPdf'>,
  seiteUrl: string
): ListenEintrag | null {
  if (href === null || titel === '') return null
  const url = normalisiereUrl(href, seiteUrl)
  if (url === null || !gleicheSite(url, seiteUrl)) return null
  return { url, titel, direktPdf: istPdfAdresse(url), ...teil }
}

/**
 * Weblication: `<li class="listEntry …">` with a title element, a date (in
 * three different places across the four sites), a teaser. The date span can
 * sit INSIDE the title element, so it is cut out before the anchor is read;
 * a calendar badge, where printed, is the date the site actually shows.
 */
export function parseWeblicationListe(
  html: string,
  seiteUrl: string,
  heute: Heute
): ListenEintrag[] {
  const eintraege: ListenEintrag[] = []
  const muster =
    /<li\b[^>]*\bclass="[^"]*\blistEntry\b[^"]*"[^>]*>([\s\S]*?)<\/li\s*>/gi
  for (const treffer of html.matchAll(muster)) {
    const li = treffer[0]
    const innen = treffer[1] ?? ''

    let titelHtml = klassenElement(innen, 'listEntryTitle') ?? ''
    const datumSpan = klassenElement(titelHtml, 'listEntryDate', 'span')
    if (datumSpan !== null)
      titelHtml = titelHtml.replace(
        /<span\b[^>]*\blistEntryDate\b[\s\S]*?<\/span\s*>/i,
        ''
      )

    const anker = ANKER.exec(titelHtml) ?? ANKER.exec(innen)
    const href = anker?.[1] ?? /\bdata-url="([^"]+)"/i.exec(li)?.[1] ?? null
    const titel = reinerText(anker?.[2] ?? titelHtml)

    let datum: string | null = null
    let datumQuelle: ListenEintrag['datumQuelle'] = null
    const kalender = klassenElement(innen, 'listEntryCalendar', 'div')
    if (kalender !== null) {
      const monat = monatVon(
        /class="month"[^>]*>([^<]+)</i.exec(kalender)?.[1] ?? ''
      )
      const tag = Number(
        /class="day"[^>]*>(\d{1,2})</i.exec(kalender)?.[1] ?? ''
      )
      if (monat !== null && tag > 0) {
        const jahr = jahrFuerMonatTag(monat, tag, heute)
        const kandidat = `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
        if (plausibel(kandidat, heute)) {
          datum = kandidat
          datumQuelle = 'kalender'
        }
      }
    }
    if (datum === null) {
      const text = datumSpan ?? klassenElement(innen, 'listEntryDate', 'div')
      if (text !== null) {
        datum = parseDatum(reinerText(text), heute)
        if (datum !== null) datumQuelle = 'liste'
      }
    }

    const teaserHtml = klassenElement(innen, 'listEntryDescription', 'div')
    const teaser = teaserHtml === null ? null : reinerText(teaserHtml) || null

    const e = eintrag(
      href,
      titel,
      { teaser, datum, datumQuelle, kategorie: null },
      seiteUrl
    )
    if (e !== null) eintraege.push(e)
  }
  return eintraege
}

interface IwebZeile {
  name?: unknown
  datum?: unknown
  'datum-sort'?: unknown
  _kategorieId?: unknown
}

/**
 * i-web with DataTables: the whole archive rides in one entity-escaped JSON
 * attribute on the `<table>`, hundreds of rows — the window filter downstream
 * is what keeps this from ever importing an archive.
 */
export function parseIwebTabelle(
  html: string,
  seiteUrl: string,
  heute: Heute
): ListenEintrag[] {
  const tabelle = /<table\b[^>]*\bid="informationList"[^>]*>/i.exec(html)?.[0]
  if (tabelle === undefined) return []
  const roh = /\bdata-entities="([^"]*)"/i.exec(tabelle)?.[1]
  if (roh === undefined) return []

  let zeilen: IwebZeile[]
  try {
    const json = JSON.parse(decodeEntities(roh)) as { data?: unknown }
    zeilen = Array.isArray(json.data) ? (json.data as IwebZeile[]) : []
  } catch {
    return []
  }

  const eintraege: ListenEintrag[] = []
  for (const zeile of zeilen) {
    const name = typeof zeile.name === 'string' ? zeile.name : ''
    const anker = ANKER.exec(name)
    const titel = reinerText(anker?.[2] ?? name)

    let datum =
      typeof zeile.datum === 'string' ? parseDatum(zeile.datum, heute) : null
    if (datum === null && typeof zeile['datum-sort'] === 'string') {
      const sortiert = zeile['datum-sort'].slice(0, 10)
      if (plausibel(sortiert, heute)) datum = sortiert
    }
    const kategorie =
      typeof zeile._kategorieId === 'string' && zeile._kategorieId !== ''
        ? zeile._kategorieId
        : null

    const e = eintrag(
      anker?.[1] ?? null,
      titel,
      {
        teaser: null,
        datum,
        datumQuelle: datum === null ? null : 'liste',
        kategorie
      },
      seiteUrl
    )
    if (e !== null) eintraege.push(e)
  }
  return eintraege
}

function datumAusTime(fragment: string, heute: Heute): string | null {
  const time = /<time\b([^>]*)>([\s\S]*?)<\/time\s*>/i.exec(fragment)
  if (time === null) return null
  // The visible text first: one site's `datetime` attribute carries the year
  // 2626 on every card while the text is right. The attribute is used only
  // when the text yields nothing and it passes the plausibility check.
  const ausText = parseDatum(reinerText(time[2] ?? ''), heute)
  if (ausText !== null) return ausText
  const attribut = /\bdatetime="([^"]+)"/i.exec(time[1] ?? '')?.[1] ?? ''
  return parseDatum(attribut, heute)
}

/** i-web's 2025 card layout: one `<article class="card">` per item, twelve on a page. */
export function parseIwebKarten(
  html: string,
  seiteUrl: string,
  heute: Heute
): ListenEintrag[] {
  const eintraege: ListenEintrag[] = []
  const muster =
    /<div\b[^>]*\bclass="[^"]*\bpartial__entry__news\b[^"]*"[^>]*>([\s\S]*?)<\/article\s*>/gi
  for (const treffer of html.matchAll(muster)) {
    const karte = treffer[1] ?? ''
    const titelHtml = klassenElement(karte, 'card-title') ?? ''
    const anker = ANKER.exec(titelHtml)
    const teaserHtml = klassenElement(karte, 'card-text', 'p')
    const datum = datumAusTime(karte, heute)
    const e = eintrag(
      anker?.[1] ?? null,
      reinerText(anker?.[2] ?? titelHtml),
      {
        teaser: teaserHtml === null ? null : reinerText(teaserHtml) || null,
        datum,
        datumQuelle: datum === null ? null : 'liste',
        kategorie: null
      },
      seiteUrl
    )
    if (e !== null) eintraege.push(e)
  }
  return eintraege
}

/** Backslash: `<li class="mod-entry">` with a real `<time datetime>`, absolute links. */
export function parseBackslashListe(
  html: string,
  seiteUrl: string,
  heute: Heute
): ListenEintrag[] {
  const eintraege: ListenEintrag[] = []
  const muster =
    /<li\b[^>]*\bclass="[^"]*\bmod-entry\b[^"]*"[^>]*>([\s\S]*?)<\/li\s*>/gi
  for (const treffer of html.matchAll(muster)) {
    const li = treffer[1] ?? ''
    const titelHtml = klassenElement(li, 'mod-entry-title') ?? ''
    const anker = ANKER.exec(titelHtml)
    const teaserHtml = klassenElement(li, 'mod-entry-desc', 'p')
    const datum = datumAusTime(li, heute)
    const e = eintrag(
      anker?.[1] ?? null,
      reinerText(anker?.[2] ?? titelHtml),
      {
        teaser: teaserHtml === null ? null : reinerText(teaserHtml) || null,
        datum,
        datumQuelle: datum === null ? null : 'liste',
        kategorie: null
      },
      seiteUrl
    )
    if (e !== null) eintraege.push(e)
  }
  return eintraege
}

/** How many same-day list dates it takes before a date column is distrusted. */
export const KAPUTTE_SPALTE_AB = 8

/**
 * The list of one page, deduplicated by identity, in source order.
 *
 * One guard against a broken template: when eight or more entries all carry
 * today's date from the list (not from a calendar badge), the column is a
 * template field showing the visit date, not a publication date — the dates
 * are dropped and the detail pages date the items instead.
 */
export function parseListe(
  html: string,
  plattform: Plattform,
  seiteUrl: string,
  heute: Heute
): ListenEintrag[] {
  const roh =
    plattform === 'weblication'
      ? parseWeblicationListe(html, seiteUrl, heute)
      : plattform === 'iweb_tabelle'
        ? parseIwebTabelle(html, seiteUrl, heute)
        : plattform === 'iweb_karten'
          ? parseIwebKarten(html, seiteUrl, heute)
          : parseBackslashListe(html, seiteUrl, heute)

  const gesehen = new Set<string>()
  const eintraege = roh.filter((e) => {
    if (gesehen.has(e.url)) return false
    gesehen.add(e.url)
    return true
  })

  const heuteIso = `${heute.jahr}-${String(heute.monat).padStart(2, '0')}-${String(heute.tag).padStart(2, '0')}`
  const datiert = eintraege.filter((e) => e.datum !== null)
  if (
    datiert.length >= KAPUTTE_SPALTE_AB &&
    datiert.every((e) => e.datum === heuteIso && e.datumQuelle === 'liste')
  ) {
    return eintraege.map((e) => ({ ...e, datum: null, datumQuelle: null }))
  }
  return eintraege
}
