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
  /** ISO date the item was PUBLISHED, or null when the list prints none we can trust. */
  datum: string | null
  /**
   * ISO date the event TAKES PLACE — only on an events list, null on a news
   * list. The two are never the same thing and never share a column: the
   * Sichtung judges the event, the cleanup the publication.
   *
   * The start day only. Where a list prints a span ("8. Februar – 6. Dezember")
   * the start is what makes it news; a standing arrangement that began months
   * ago falls outside the forward window by itself, which is the wanted
   * behaviour rather than a gap.
   */
  veranstaltungAm: string | null
  /** `kalender`: month + day badge, year inferred — a full date on the detail page beats it. */
  datumQuelle: 'liste' | 'kalender' | null
  /** i-web's `_kategorieId` (news, politik_info, wahlergebnisse); other templates have none. */
  kategorie: string | null
  /** The list links a file, not a page — the item IS the document. */
  direktPdf: boolean
}

// Both quote styles on purpose: the news templates write `class="…"`, and
// Weblication's event index writes `class='…'` and `href='…'` throughout.
// One pair of helpers reads both rather than a second pair for the second
// kind of list.
const ANKER = /<a\b[^>]*\bhref=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a\s*>/i

function ersterAnker(html: string): { href: string; inhalt: string } | null {
  const treffer = ANKER.exec(html)
  if (treffer === null) return null
  return { href: treffer[2] ?? '', inhalt: treffer[3] ?? '' }
}

function klassenElement(
  html: string,
  klasse: string,
  tags = '[a-z][a-z0-9]*'
): string | null {
  const muster = new RegExp(
    `<(${tags})\\b[^>]*\\bclass=(["'])[^"']*\\b${klasse}\\b[^"']*\\2[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`,
    'i'
  )
  return muster.exec(html)?.[3] ?? null
}

function eintrag(
  href: string | null,
  titel: string,
  teil: Omit<ListenEintrag, 'url' | 'titel' | 'direktPdf' | 'veranstaltungAm'> &
    Partial<Pick<ListenEintrag, 'veranstaltungAm'>>,
  seiteUrl: string
): ListenEintrag | null {
  if (href === null || titel === '') return null
  const url = normalisiereUrl(href, seiteUrl)
  if (url === null || !gleicheSite(url, seiteUrl)) return null
  return {
    url,
    titel,
    direktPdf: istPdfAdresse(url),
    veranstaltungAm: null,
    ...teil
  }
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

    const anker = ersterAnker(titelHtml) ?? ersterAnker(innen)
    const href = anker?.href ?? /\bdata-url="([^"]+)"/i.exec(li)?.[1] ?? null
    const titel = reinerText(anker?.inhalt ?? titelHtml)

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
    const anker = ersterAnker(name)
    const titel = reinerText(anker?.inhalt ?? name)

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
      anker?.href ?? null,
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
    const anker = ersterAnker(titelHtml)
    const teaserHtml = klassenElement(karte, 'card-text', 'p')
    const datum = datumAusTime(karte, heute)
    const e = eintrag(
      anker?.href ?? null,
      reinerText(anker?.inhalt ?? titelHtml),
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
    const anker = ersterAnker(titelHtml)
    const teaserHtml = klassenElement(li, 'mod-entry-desc', 'p')
    const datum = datumAusTime(li, heute)
    const e = eintrag(
      anker?.href ?? null,
      reinerText(anker?.inhalt ?? titelHtml),
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

// ---------------------------------------------------------------------------
// The events lists — same three houses, a date that lies ahead
// ---------------------------------------------------------------------------

/** How much of an entry rides along as the teaser: time and place, where printed. */
const TERMIN_ANRISS_MAX = 240

function anriss(text: string): string | null {
  const sauber = text.replace(/\s+/g, ' ').trim()
  if (sauber === '') return null
  return sauber.length <= TERMIN_ANRISS_MAX
    ? sauber
    : `${sauber.slice(0, TERMIN_ANRISS_MAX).trimEnd()} …`
}

/**
 * Weblication's event index, `#indexUL` with one `li.indexLI` per event.
 *
 * Measured on four sites, and they print the same list four ways: the date in
 * a `span.listEntryDate` (Allschwil, Arlesheim), in a `div.fullDate`
 * (Bottmingen) or as bare text at the head of the row (Reinach); the title in
 * a `<b>` inside the link (Allschwil, Reinach), in an `h3.listEntryTitle`
 * inside the link next to the date span (Arlesheim) or in an `h3` the link
 * merely wraps (Bottmingen). So the date is looked for in that order and the
 * title in this one, rather than one parser per municipality — the newsroom's
 * rule that a rule holds for a KIND of page.
 *
 * Bottmingen also prints a month-and-day badge with no year, and it is
 * deliberately never read: `parseDatum` wants a year, and the full date is
 * printed right next to it on the same row.
 */
export function parseWeblicationTermine(
  html: string,
  seiteUrl: string,
  heute: Heute
): ListenEintrag[] {
  const eintraege: ListenEintrag[] = []
  const muster =
    /<li\b[^>]*\bclass=['"][^'"]*\bindexLI\b[^'"]*['"][^>]*>([\s\S]*?)<\/li\s*>/gi
  for (const treffer of html.matchAll(muster)) {
    // The iCal button is an anchor too, and on two of the sites it comes
    // first — it goes before anything else is looked for.
    const innen = (treffer[1] ?? '').replace(
      /<div\b[^>]*\bclass=['"][^'"]*\bformWorkEntryButtons\b[\s\S]*?<\/div\s*>/gi,
      ''
    )

    const datumSpan = klassenElement(innen, 'listEntryDate', 'span')
    const vollDatum = klassenElement(innen, 'fullDate', 'div')
    const termin =
      parseDatum(reinerText(datumSpan ?? ''), heute) ??
      parseDatum(reinerText(vollDatum ?? ''), heute) ??
      parseDatum(reinerText(innen), heute)

    const anker = ersterAnker(innen)
    const ankerInhalt = anker?.inhalt ?? ''
    const titelElement =
      klassenElement(ankerInhalt, 'listEntryTitle') ??
      klassenElement(innen, 'listEntryTitle')
    const fett = /<b\b[^>]*>([\s\S]*?)<\/b\s*>/i.exec(ankerInhalt)?.[1] ?? null
    const titelHtml = (titelElement ?? fett ?? ankerInhalt).replace(
      /<span\b[^>]*\blistEntryDate\b[\s\S]*?<\/span\s*>/i,
      ''
    )
    const titel = reinerText(titelHtml)

    const rest = reinerText(innen).replace(titel, ' ')
    const e = eintrag(
      anker?.href ?? null,
      titel,
      {
        teaser: anriss(rest),
        datum: null,
        datumQuelle: null,
        kategorie: null,
        veranstaltungAm: termin
      },
      seiteUrl
    )
    if (e !== null) eintraege.push(e)
  }
  return eintraege
}

interface IwebTerminZeile {
  name?: unknown
  lokalitaet?: unknown
  ort?: unknown
  organisator?: unknown
  _datumVon?: unknown
}

/**
 * i-web's event calendar: the same DataTables attribute as the news table,
 * on `#anlassList` instead of `#informationList`, and with the dates already
 * as ISO in `_datumVon`. The whole year rides in it — the forward window is
 * what keeps December out of September's desk.
 */
export function parseIwebTermine(
  html: string,
  seiteUrl: string,
  heute: Heute
): ListenEintrag[] {
  const tabelle = /\bid="anlassList"[\s\S]*?data-entities="([^"]*)"/i.exec(html)
  if (tabelle === null) return []

  let zeilen: IwebTerminZeile[]
  try {
    const json = JSON.parse(decodeEntities(tabelle[1] ?? '')) as {
      data?: unknown
    }
    zeilen = Array.isArray(json.data) ? (json.data as IwebTerminZeile[]) : []
  } catch {
    return []
  }

  const text = (wert: unknown): string =>
    typeof wert === 'string' ? reinerText(wert) : ''

  const eintraege: ListenEintrag[] = []
  for (const zeile of zeilen) {
    const name = typeof zeile.name === 'string' ? zeile.name : ''
    const anker = ersterAnker(name)
    const termin =
      typeof zeile._datumVon === 'string'
        ? parseDatum(zeile._datumVon, heute)
        : null
    const ort = [text(zeile.lokalitaet), text(zeile.ort)]
      .filter((t) => t !== '')
      .join(', ')
    const veranstalter = text(zeile.organisator)

    const e = eintrag(
      anker?.href ?? null,
      reinerText(anker?.inhalt ?? name),
      {
        teaser: anriss(
          [ort, veranstalter === '' ? '' : `Veranstalter: ${veranstalter}`]
            .filter((t) => t !== '')
            .join(' · ')
        ),
        datum: null,
        datumQuelle: null,
        kategorie: null,
        veranstaltungAm: termin
      },
      seiteUrl
    )
    if (e !== null) eintraege.push(e)
  }
  return eintraege
}

/**
 * Backslash prints hCalendar: the same `li.mod-entry` rows as its news list,
 * so the news parser reads them — only its date means something else. The
 * first `<time>` of a row is `dtstart`, and that is the event's day.
 */
export function parseBackslashTermine(
  html: string,
  seiteUrl: string,
  heute: Heute
): ListenEintrag[] {
  return parseBackslashListe(html, seiteUrl, heute).map((e) => ({
    ...e,
    datum: null,
    datumQuelle: null,
    veranstaltungAm: e.datum
  }))
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
  const parser: Record<
    Plattform,
    (h: string, u: string, t: Heute) => ListenEintrag[]
  > = {
    weblication: parseWeblicationListe,
    iweb_tabelle: parseIwebTabelle,
    iweb_karten: parseIwebKarten,
    backslash: parseBackslashListe,
    weblication_termine: parseWeblicationTermine,
    iweb_termine: parseIwebTermine,
    backslash_termine: parseBackslashTermine
  }
  const roh = parser[plattform](html, seiteUrl, heute)

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
