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
   * The first day. A span ("8. Februar – 6. Dezember", i-web's `_datumBis`,
   * hCalendar's `dtend`) puts its last day in `veranstaltungBis`, so a
   * running exhibition is visible to the window until it ends — which is what
   * makes its end a "last chance".
   */
  veranstaltungAm: string | null
  /** Last day of a span, where the list prints one. Null for a single day. */
  veranstaltungBis: string | null
  /** Time as the list prints it, normalised to "18:00" or "18:00–21:00". */
  zeit: string | null
  /** Venue and place, where the list prints them as fields (i-web) or labels (Weblication). */
  lokalitaet: string | null
  ort: string | null
  veranstalter: string | null
  /** The site's own series id, where the markup carries one (Backslash: `/event/<id>/`). */
  serie: string | null
  /** The series' first day, where the markup carries it (Backslash: the `dtstart` attribute). */
  serieSeit: string | null
  /** The row itself says cancelled, moved or not taking place. */
  abgesagt: boolean
  /** `kalender`: month + day badge, year inferred — a full date on the detail page beats it. */
  datumQuelle: 'liste' | 'kalender' | null
  /** i-web's `_kategorieId` (news) or `_hauptkategorieId` (events); other templates have none. */
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

type EintragTeil = Omit<Partial<ListenEintrag>, 'url' | 'titel' | 'direktPdf'> &
  Pick<ListenEintrag, 'teaser' | 'datum' | 'datumQuelle' | 'kategorie'>

function eintrag(
  href: string | null,
  titel: string,
  teil: EintragTeil,
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
    veranstaltungBis: null,
    zeit: null,
    lokalitaet: null,
    ort: null,
    veranstalter: null,
    serie: null,
    serieSeit: null,
    abgesagt: false,
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
 * The row itself says the event will not happen as listed. Measured on three
 * sites: "Kinderkleiderbörse ist leider abgesagt" (Bottmingen), "ABGESAGT:"
 * as a title prefix (riehenevents), "Gemeindeversammlung findet nicht statt"
 * (Muttenz), "wurde vom 19. auf den 26. September verschoben" (Muttenz).
 */
const ABGESAGT =
  /\babgesagt\b|\bverschoben\b|findet nicht statt|f[äa]llt aus|\bentf[äa]llt\b/i

/**
 * Ein Wert ohne Buchstabe und ohne Ziffer ist KEINE Angabe.
 *
 * Gemessen am ersten Lauf ueber die zehn Kalender (20.09.2026): Arlesheim
 * schreibt „Lokalität: -" in Eintraege, deren Ort es nicht fuehrt. Der Strich
 * kam als Ort durch — auf dem Tisch als Ort „-", und im Serienschluessel als
 * ein ANDERER Ort, was dieselbe Ausstellung in zwei Anlaesse zerlegte.
 */
export function oderNull(wert: string): string | null {
  return wert === '' || !/[\p{L}\p{N}]/u.test(wert) ? null : wert
}

export function istAbgesagt(text: string): boolean {
  return ABGESAGT.test(text.normalize('NFC'))
}

const VOLLES_DATUM =
  /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?!\d)|(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]{3,9})\.?\s+(\d{4})(?!\d)/g
/** "13.00 Uhr" — the dot form only counts with the word, or it reads a date's day and month as a time. */
const ZEIT_PUNKT = /\b(\d{1,2})\.(\d{2})\s*Uhr/g
/** "15:00", with or without "Uhr". */
const ZEIT_DOPPELPUNKT = /\b(\d{1,2}):(\d{2})(?![.:\d])/g

function zeiten(text: string): string[] {
  const funde: { index: number; zeit: string }[] = []
  for (const muster of [ZEIT_PUNKT, ZEIT_DOPPELPUNKT]) {
    for (const treffer of text.matchAll(muster)) {
      const stunde = Number(treffer[1])
      const minute = Number(treffer[2])
      if (stunde > 23 || minute > 59) continue
      funde.push({
        index: treffer.index ?? 0,
        zeit: `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      })
    }
  }
  funde.sort((a, b) => a.index - b.index)
  const gesehen = new Set<number>()
  return funde
    .filter((f) =>
      gesehen.has(f.index) ? false : (gesehen.add(f.index), true)
    )
    .map((f) => f.zeit)
}

/**
 * The time a row or a field prints, normalised: "13.00 Uhr - 18.00 Uhr" and
 * "15:00 Uhr - 23:45 Uhr" both become "13:00–18:00"; a lone "19.00 Uhr"
 * becomes "19:00"; "60 Minuten" becomes null. Only the first two times count —
 * a span across two days prints its end time after the second date, and that
 * is still the end.
 */
export function zeitText(text: string): string | null {
  const z = zeiten(text.normalize('NFC'))
  if (z.length === 0) return null
  const [erste, zweite] = z
  if (erste === undefined) return null
  return zweite === undefined || zweite === erste ? erste : `${erste}–${zweite}`
}

export interface TerminZeile {
  von: string | null
  bis: string | null
  zeit: string | null
}

/**
 * What a Weblication event row says about WHEN: the first full date is the
 * day, a later one the end of a span, the times in between the time.
 * Measured: "13.10.2026 | 18:00 Uhr - 21:00 Uhr" (Allschwil), "18.09.2026 |
 * 15:00 Uhr - 19.09.2026 | 23:45 Uhr" (Reinach, a span), "19.09.2026 | 10:00
 * Uhr - 12:00 Uhr" (Bottmingen's `fullDate`).
 */
export function parseTerminZeile(text: string, heute: Heute): TerminZeile {
  const roh = text.normalize('NFC')
  const daten: string[] = []
  for (const treffer of roh.matchAll(VOLLES_DATUM)) {
    const datum = parseDatum(treffer[0], heute)
    if (datum !== null && !daten.includes(datum)) daten.push(datum)
  }
  const von = daten[0] ?? null
  const letztes = daten[daten.length - 1] ?? null
  const bis = von !== null && letztes !== null && letztes > von ? letztes : null
  return { von, bis, zeit: zeitText(roh) }
}

const LOKALITAET_LABEL =
  /Lokalit[äa]t:\s*(.+?)(?=\s(?:Veranstalter|Kategorie|Zeit|Ort):|$)/i
const LOKALITAET_MAX = 200

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
    const text = reinerText(innen)
    const datumsQuelle = datumSpan ?? vollDatum
    let zeile = parseTerminZeile(
      datumsQuelle === null ? text : reinerText(datumsQuelle),
      heute
    )
    if (zeile.von === null && datumsQuelle !== null)
      zeile = parseTerminZeile(text, heute)

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

    const rest = text.replace(titel, ' ')
    const lokalitaet =
      LOKALITAET_LABEL.exec(rest)?.[1]?.trim().slice(0, LOKALITAET_MAX) ?? null
    const e = eintrag(
      anker?.href ?? null,
      titel,
      {
        teaser: anriss(rest),
        datum: null,
        datumQuelle: null,
        kategorie: null,
        veranstaltungAm: zeile.von,
        veranstaltungBis: zeile.bis,
        zeit: zeile.zeit,
        lokalitaet: oderNull(lokalitaet ?? ''),
        abgesagt: istAbgesagt(text)
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
  _datumBis?: unknown
  _anlassTime?: unknown
  _hauptkategorieId?: unknown
  _ort?: unknown
}

/**
 * i-web hangs the whole event calendar off `#anlassList` in the same
 * DataTables attribute as the news table. Its rows carry MORE than the news
 * rows: venue, place and organiser as fields, `_datumVon`/`_datumBis` as
 * ISO days (a running exhibition is one row with a span, measured on
 * Pratteln's "Alder & Bahn", 10.08.2026 – 21.03.2027), the time as printed and
 * the category as a number. All of it is kept as fields; the teaser is still
 * composed from venue and organiser, as before.
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
    const titel = reinerText(anker?.inhalt ?? name)
    const termin =
      typeof zeile._datumVon === 'string'
        ? parseDatum(zeile._datumVon, heute)
        : null
    const bisRoh =
      typeof zeile._datumBis === 'string'
        ? parseDatum(zeile._datumBis, heute)
        : null
    const bis =
      termin !== null && bisRoh !== null && bisRoh > termin ? bisRoh : null
    const lokalitaet = text(zeile.lokalitaet)
    const ort = text(zeile._ort) || text(zeile.ort)
    const veranstalter = text(zeile.organisator)
    const ortZeile = [lokalitaet, text(zeile.ort)]
      .filter((t) => t !== '')
      .join(', ')

    const e = eintrag(
      anker?.href ?? null,
      titel,
      {
        teaser: anriss(
          [ortZeile, veranstalter === '' ? '' : `Veranstalter: ${veranstalter}`]
            .filter((t) => t !== '')
            .join(' · ')
        ),
        datum: null,
        datumQuelle: null,
        kategorie: oderNull(text(zeile._hauptkategorieId)),
        veranstaltungAm: termin,
        veranstaltungBis: bis,
        zeit: zeitText(text(zeile._anlassTime)),
        lokalitaet: oderNull(lokalitaet),
        ort: oderNull(ort),
        veranstalter: oderNull(veranstalter),
        abgesagt: istAbgesagt(titel)
      },
      seiteUrl
    )
    if (e !== null) eintraege.push(e)
  }
  return eintraege
}

const TIME_ELEMENT = /<time\b([^>]*)>([\s\S]*?)<\/time\s*>/gi
const SERIE_IN_URL = /\/event\/(\d+)\/eventdate\/\d+/i

/**
 * Backslash prints hCalendar: the same `li.mod-entry` rows as its news list,
 * with `time.dtstart` (the day, as text — the `datetime` attribute carries the
 * SERIES' first day, measured: "2026-01-12" on a row whose text says
 * "21. September 2026") and, on a few rows, `time.dtend`. The link carries the
 * series: `/event/<serie>/eventdate/<termin>`, so the site itself says which
 * rows are one Anlass.
 */
export function parseBackslashTermine(
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
    const titel = reinerText(anker?.inhalt ?? titelHtml)
    const teaserHtml = klassenElement(li, 'mod-entry-desc', 'p')

    let von: string | null = null
    let serieSeit: string | null = null
    let bis: string | null = null
    for (const zeit of li.matchAll(TIME_ELEMENT)) {
      const attribute = zeit[1] ?? ''
      const inhalt = reinerText(zeit[2] ?? '')
      const attribut = /\bdatetime="([^"]+)"/i.exec(attribute)?.[1] ?? ''
      if (/\bclass="[^"]*\bdtstart\b/i.test(attribute)) {
        von = parseDatum(inhalt, heute) ?? parseDatum(attribut, heute)
        serieSeit = parseDatum(attribut, heute)
      } else if (/\bclass="[^"]*\bdtend\b/i.test(attribute)) {
        bis = parseDatum(inhalt, heute) ?? parseDatum(attribut, heute)
      }
    }
    if (von !== null && bis !== null && bis <= von) bis = null

    const e = eintrag(
      anker?.href ?? null,
      titel,
      {
        teaser: teaserHtml === null ? null : reinerText(teaserHtml) || null,
        datum: null,
        datumQuelle: null,
        kategorie: null,
        veranstaltungAm: von,
        veranstaltungBis: bis,
        serie: SERIE_IN_URL.exec(anker?.href ?? '')?.[1] ?? null,
        serieSeit: serieSeit === von ? null : serieSeit,
        abgesagt: istAbgesagt(titel)
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
