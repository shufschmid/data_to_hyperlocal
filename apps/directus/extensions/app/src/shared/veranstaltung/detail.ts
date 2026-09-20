// The detail page of an Anlass, read as FIELDS — the news reader flattens a
// page to prose, and a Meldung about an event needs date, time and place as
// facts it can be checked against.
//
// Measured on the three families (19–20.09.2026): Weblication prints a
// label/value form (`dl.formTable`: Datum/Zeit, Kategorie, Lokalität,
// Strasse, Ort, Veranstalter, Beschreibung, Dokument); i-web prints an
// address link, the date line, the description, a Kontakt block and an
// "Informationen" definition list (Preis, Anmeldung, Voraussetzungen), and
// its Gremium entries land on a Sitzungen page with a Traktanden table;
// Backslash prints `event-content`, `event-location` and a complete
// "weitere Termine" list. A page matching none of that is read the generic
// way and says so.

import type { Heute } from '../gemeindeseite/datum'
import { parseDatum } from '../gemeindeseite/datum'
import {
  dokumenteAus,
  inhaltsblockWeblication,
  metaTitel,
  parseDetail,
  type Dokument
} from '../gemeindeseite/detail'
import type { DetailFamilie } from '../gemeindeseite/erkennung'
import { parseTerminZeile, zeitText } from '../gemeindeseite/liste'
import { blockZuText, reinerText, schneideElement } from '../gemeindeseite/text'
import { normalisiereUrl } from '../gemeindeseite/url'

export interface AnlassDetail {
  titel: string | null
  zeit: string | null
  lokalitaet: string | null
  adresse: string | null
  ort: string | null
  veranstalter: string | null
  kategorie: string | null
  preis: string | null
  anmeldung: string | null
  /** Plain text with blank-line paragraph breaks; '' when nothing was found. */
  beschreibung: string
  dokumente: Dokument[]
  /** Every date the page names for this Anlass, ISO, ascending — Backslash prints them all. */
  weitereTermine: string[]
  /** A same-site page carrying the agenda, where the page links one instead of printing it. */
  traktandenLink: string | null
  kanonisch: string | null
  verfahren: DetailFamilie | 'generisch'
}

const LEER: Omit<AnlassDetail, 'verfahren'> = {
  titel: null,
  zeit: null,
  lokalitaet: null,
  adresse: null,
  ort: null,
  veranstalter: null,
  kategorie: null,
  preis: null,
  anmeldung: null,
  beschreibung: '',
  dokumente: [],
  weitereTermine: [],
  traktandenLink: null,
  kanonisch: null
}

const oderNull = (wert: string): string | null =>
  // Ein Wert ohne Buchstabe und ohne Ziffer ist keine Angabe: manche Kalender
  // schreiben „-" in ein Feld, das sie nicht fuellen, und ein Strich ist kein
  // Ort und keine Uhrzeit.
  wert === '' || !/[\p{L}\p{N}]/u.test(wert) ? null : wert

/** "Bibliothek Bottmingen<br>Schlossgasse 10<br>4102 Binningen" → venue, street, place. */
function adresseAus(zeilen: readonly string[]): {
  lokalitaet: string | null
  adresse: string | null
  ort: string | null
} {
  const sauber = zeilen.map((z) => z.trim()).filter((z) => z !== '')
  // Zwei Schreibweisen, beide gemessen: „4102 Binningen" bei den drei
  // Gemeinde-CMS, „Riehen 4125" bei der Datentuer-Vorlage. Eine Hausnummer
  // hat nie vier Stellen, darum ist das unterscheidbar.
  const plzOrt = sauber.findIndex(
    (z) => /^\d{4}\s+\S/.test(z) || /^\D.*\s\d{4}$/.test(z)
  )
  const ort =
    plzOrt === -1
      ? null
      : (sauber[plzOrt]?.replace(/^\d{4}\s+/, '').replace(/\s+\d{4}$/, '') ??
        null)
  const rest = sauber.filter((_, i) => i !== plzOrt)
  return {
    lokalitaet: rest[0] ?? null,
    adresse: rest.slice(1).join(', ') || null,
    ort
  }
}

// --- Weblication -------------------------------------------------------------

/** The label/value pairs of a Weblication form: label text → value HTML. */
export function labelWerte(block: string): Map<string, string> {
  const werte = new Map<string, string>()
  for (const treffer of block.matchAll(
    /<dt\b[^>]*>([\s\S]*?)<\/dt\s*>\s*<dd\b[^>]*>([\s\S]*?)<\/dd\s*>/gi
  )) {
    const label = reinerText(treffer[1] ?? '').toLowerCase()
    if (label !== '' && !werte.has(label)) werte.set(label, treffer[2] ?? '')
  }
  return werte
}

function wert(werte: Map<string, string>, ...labels: string[]): string | null {
  for (const label of labels) {
    for (const [k, v] of werte) {
      if (k === label || k.startsWith(label)) return oderNull(reinerText(v))
    }
  }
  return null
}

export function parseWeblicationAnlass(
  html: string,
  seiteUrl: string,
  heute: Heute
): AnlassDetail {
  const block = inhaltsblockWeblication(html) ?? ''
  const werte = labelWerte(block)
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(block)
  const titel =
    (h1 === null ? null : oderNull(reinerText(h1[1] ?? ''))) ?? metaTitel(html)
  const datumZeit = wert(werte, 'datum/zeit', 'datum', 'zeit') ?? ''
  const zeile = parseTerminZeile(datumZeit, heute)
  const beschreibungHtml = [...werte].find(([k]) =>
    k.startsWith('beschreibung')
  )?.[1]
  // Weblication's event form writes its links with single quotes; the
  // document reader (shared with the news pages) expects double ones.
  const dokumentHtml = [...werte]
    .filter(([k]) => k.startsWith('dokument'))
    .map(([, v]) => v)
    .join('\n')
    .replace(/\b(href|title)='([^']*)'/gi, '$1="$2"')
  const termine = [zeile.von, zeile.bis].filter((t): t is string => t !== null)
  // "Ort" may be one word (Bottmingen) or a whole address block
  // (Reinach: "Jugendhaus Palais noir<br>Bruggstrasse 95<br>4153 Reinach").
  const ortBlock = adresseAus(
    ([...werte].find(([k]) => k === 'ort')?.[1] ?? '')
      .split(/<br\s*\/?>/i)
      .map((z) => reinerText(z))
  )
  const ortZeilen = ([...werte].find(([k]) => k === 'ort')?.[1] ?? '').split(
    /<br\s*\/?>/i
  ).length
  return {
    ...LEER,
    titel,
    zeit: zeile.zeit ?? zeitText(datumZeit),
    lokalitaet: wert(werte, 'lokalität', 'lokalitaet') ?? ortBlock.lokalitaet,
    adresse:
      wert(werte, 'strasse', 'adresse') ??
      (ortZeilen > 1 ? ortBlock.adresse : null),
    ort:
      ortZeilen > 1
        ? (ortBlock.ort ?? ortBlock.lokalitaet)
        : (wert(werte, 'ort')?.replace(/^\d{4}\s+/, '') ?? null),
    veranstalter: wert(werte, 'veranstalter', 'organisator'),
    kategorie: wert(werte, 'kategorie'),
    preis: wert(werte, 'preis', 'kosten', 'eintritt'),
    anmeldung: wert(werte, 'anmeldung'),
    beschreibung:
      beschreibungHtml === undefined ? '' : blockZuText(beschreibungHtml),
    dokumente: dokumenteAus(dokumentHtml, seiteUrl),
    weitereTermine: termine,
    kanonisch: kanonischVon(html, seiteUrl),
    verfahren: 'weblication'
  }
}

// --- i-web ---------------------------------------------------------------------

/** i-web's "Informationen" list and any other `<dl>`: label text → value HTML. */
function iwebDefinitionen(block: string): Map<string, string> {
  return labelWerte(block)
}

export function parseIwebAnlass(
  html: string,
  seiteUrl: string,
  heute: Heute
): AnlassDetail {
  const basis = parseDetail(html, 'iweb', seiteUrl, heute)
  const h1 =
    /<h1\b[^>]*\bclass="[^"]*\bcontentTitle\b[^"]*"[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(
      html
    )
  const titel =
    (h1 === null ? null : oderNull(reinerText(h1[1] ?? ''))) ?? basis.titel

  const ortslink =
    /<a\b[^>]*\bclass="[^"]*\bicms-link-ortsplan\b[^"]*"[^>]*>([\s\S]*?)<\/a\s*>/i.exec(
      html
    )
  const adresse = adresseAus(
    (ortslink?.[1] ?? '').split(/<br\s*\/?>/i).map((z) => reinerText(z))
  )

  // The date line: after the address link in the lead container, or the
  // first text container of a Sitzungen page ("21. Sept. 2026, 19.00 Uhr").
  let datumZeile = ''
  const leadStart = html.search(
    /<div\b[^>]*\bclass="[^"]*\bicms-lead-container\b/i
  )
  if (leadStart !== -1) {
    const lead = schneideElement(html, leadStart)
    datumZeile = reinerText(lead.replace(/<a\b[\s\S]*?<\/a\s*>/gi, ' '))
  }
  if (parseTerminZeile(datumZeile, heute).von === null) {
    for (const treffer of html.matchAll(
      /<div\b[^>]*\bclass="[^"]*\bicms-text-container\b[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/gi
    )) {
      const text = reinerText(treffer[1] ?? '')
      if (parseTerminZeile(text, heute).von !== null && text.length < 200) {
        datumZeile = text
        break
      }
    }
  }
  const zeile = parseTerminZeile(datumZeile, heute)

  const kontakt =
    /<address\b[^>]*\bicms-contact-container\b[^>]*>([\s\S]*?)<\/address\s*>/i.exec(
      html
    )
  const veranstalter =
    kontakt === null
      ? null
      : oderNull(reinerText((kontakt[1] ?? '').split(/<br\s*\/?>/i)[0] ?? ''))

  const definitionen = iwebDefinitionen(html)
  return {
    ...LEER,
    titel,
    zeit: zeile.zeit,
    lokalitaet: adresse.lokalitaet,
    adresse: adresse.adresse,
    ort: adresse.ort,
    veranstalter,
    kategorie: null,
    preis: wert(definitionen, 'preis', 'kosten', 'eintritt'),
    anmeldung: wert(definitionen, 'anmeldung'),
    beschreibung: basis.text,
    dokumente: basis.dokumente,
    weitereTermine: [zeile.von, zeile.bis].filter(
      (t): t is string => t !== null
    ),
    kanonisch: basis.kanonisch,
    verfahren: 'iweb'
  }
}

// --- Backslash -----------------------------------------------------------------

const SITZUNGSLINK = /sitzung|traktand|einwohnerrat|gemeindeversammlung/i

export function parseBackslashAnlass(
  html: string,
  seiteUrl: string,
  heute: Heute
): AnlassDetail {
  const h1 =
    /<h1\b[^>]*\bclass="[^"]*\bmain__title\b[^"]*"[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(
      html
    )
  const titel =
    (h1 === null ? null : oderNull(reinerText(h1[1] ?? ''))) ?? metaTitel(html)

  const meta =
    /<p\b[^>]*\bclass="[^"]*\bmod-event__date\b[^"]*"[^>]*>([\s\S]*?)<\/p\s*>/i.exec(
      html
    )?.[1] ?? ''
  const zeit = zeitText(reinerText(meta))

  const inhaltStart = html.search(
    /<div\b[^>]*\bclass="[^"]*\bevent-content\b[^"]*"[^>]*>/i
  )
  const inhalt = inhaltStart === -1 ? '' : schneideElement(html, inhaltStart)

  const ortHtml =
    /<p\b[^>]*\bclass="[^"]*\blocation\b[^"]*"[^>]*>([\s\S]*?)<\/p\s*>/i.exec(
      html
    )?.[1] ?? ''
  const adresse = adresseAus(
    ortHtml
      .replace(/<a\b[\s\S]*?<\/a\s*>/gi, '')
      .split(/<br\s*\/?>/i)
      .map((z) => reinerText(z))
  )

  const termine = new Set<string>()
  const datesStart = html.search(/<ul\b[^>]*\bclass="[^"]*\bevent-dates-lst\b/i)
  if (datesStart !== -1) {
    for (const li of schneideElement(html, datesStart).matchAll(
      /<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi
    )) {
      const datum = parseDatum(reinerText(li[1] ?? ''), heute)
      if (datum !== null) termine.add(datum)
    }
  }
  const heutigeZeile = parseTerminZeile(reinerText(meta), heute)
  if (heutigeZeile.von !== null) termine.add(heutigeZeile.von)

  let traktandenLink: string | null = null
  for (const a of inhalt.matchAll(
    /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a\s*>/gi
  )) {
    const href = a[1] ?? ''
    const text = reinerText(a[2] ?? '')
    if (
      SITZUNGSLINK.test(href) ||
      (/^hier$/i.test(text) && /traktanden/i.test(inhalt))
    ) {
      traktandenLink = normalisiereUrl(href, seiteUrl)
      break
    }
  }

  // The contact block is prose here, not a field; the organiser is what the
  // Sichtung reads out of the description and the link domains.
  return {
    ...LEER,
    titel,
    zeit,
    lokalitaet: adresse.lokalitaet,
    adresse: adresse.adresse,
    ort: adresse.ort,
    beschreibung: blockZuText(inhalt),
    dokumente: dokumenteAus(inhalt, seiteUrl),
    weitereTermine: [...termine].sort(),
    traktandenLink,
    kanonisch: kanonischVon(html, seiteUrl),
    verfahren: 'backslash'
  }
}

// --- Drupal mit JSON-Tuer (Riehens Kalender) ---------------------------------

/**
 * Die Seitenleiste dieser Vorlage ist beschriftet — je Angabe ein eigener
 * Block mit seinem Namen in der Klasse. Das ist die freundlichste der vier
 * Familien: nichts muss aus Fliesstext geraten werden.
 */
export function drupalSeitenleiste(html: string): Map<string, string> {
  const werte = new Map<string, string>()
  for (const treffer of html.matchAll(
    /<div\b[^>]*\bclass="[^"]*\bevent__sidebar__item--([a-z]+)\b[^"]*"[^>]*>/gi
  )) {
    const name = (treffer[1] ?? '').toLowerCase()
    if (name === '' || werte.has(name)) continue
    werte.set(name, schneideElement(html, treffer.index ?? 0))
  }
  return werte
}

function drupalFeld(html: string, klasse: string): string {
  const start = html.search(
    new RegExp(`<div[^>]*\\bclass="[^"]*?(?<![-\\w])${klasse}(?![-\\w])`, 'i')
  )
  return start === -1 ? '' : schneideElement(html, start)
}

export function parseDrupalAnlass(
  html: string,
  seiteUrl: string,
  heute: Heute
): AnlassDetail {
  const titel =
    oderNull(reinerText(drupalFeld(html, 'event__intro__title'))) ??
    metaTitel(html)
  const leiste = drupalSeitenleiste(html)
  const feld = (name: string): string | null => {
    const block = leiste.get(name)
    return block === undefined ? null : oderNull(reinerText(block))
  }

  // Die Adresse steht als Zeilen im Adressblock; „Google Maps" ist ein Link
  // und keine Zeile.
  const adressBlock = (leiste.get('address') ?? '')
    .replace(/<a\b[\s\S]*?<\/a\s*>/gi, '')
    .split(/<br\s*\/?>|<\/(?:p|div|li)\s*>/i)
    .map((z) => reinerText(z))
  const adresse = adresseAus(adressBlock)

  // Der Termin der Seitenleiste ist der des aufgerufenen Vorkommens; die
  // Serie selbst kennt der Lauf aus der Tuer, darum genau EIN Datum.
  const termine = new Set<string>()
  const datum = parseDatum(feld('date') ?? '', heute)
  if (datum !== null) termine.add(datum)

  const inhalt = drupalFeld(html, 'event__main__elements')
  const lead = reinerText(drupalFeld(html, 'event__intro__lead'))
  const text = blockZuText(
    inhalt === '' ? drupalFeld(html, 'event__main') : inhalt
  )
  // Der Lead steht auch im Inhalt — doppelt gesetzt liest er sich wie ein
  // Stottern, also nur voranstellen, wo er fehlt.
  const beschreibung =
    lead !== '' && !text.includes(lead) ? `${lead}\n\n${text}` : text

  return {
    titel,
    zeit: zeitText(feld('time') ?? '') ?? feld('time'),
    lokalitaet: adresse.lokalitaet,
    adresse: adresse.adresse,
    ort: adresse.ort,
    veranstalter: feld('organizer'),
    // Die Kategorie steht im Kicker ueber dem Titel; `event__intro__category`
    // daneben traegt nur ihr Icon.
    kategorie: oderNull(
      reinerText(drupalFeld(html, 'event__intro__title-kicker'))
    ),
    preis: feld('price'),
    // „Ticket kaufen" ist die Anmeldung dieser Vorlage; der Kontaktblock
    // nennt eine Person und bleibt darum aussen vor.
    anmeldung: feld('ticket'),
    beschreibung,
    dokumente: dokumenteAus(inhalt === '' ? html : inhalt, seiteUrl),
    weitereTermine: [...termine].sort(),
    traktandenLink: null,
    kanonisch: kanonischVon(html, seiteUrl),
    verfahren: 'drupal'
  }
}

function kanonischVon(html: string, seiteUrl: string): string | null {
  const link =
    /<link\b[^>]*\brel="canonical"[^>]*\bhref="([^"]+)"/i.exec(html)?.[1] ??
    /<meta\s+(?:property|name)="og:url"\s+content="([^"]*)"/i.exec(html)?.[1] ??
    null
  return link === null ? null : normalisiereUrl(link, seiteUrl)
}

/**
 * The family parser, with the generic reader behind it: a page whose family
 * parser finds no description is still read as prose, and the result says so.
 */
export function parseAnlassDetail(
  html: string,
  familie: DetailFamilie,
  seiteUrl: string,
  heute: Heute
): AnlassDetail {
  const eigen =
    familie === 'weblication'
      ? parseWeblicationAnlass(html, seiteUrl, heute)
      : familie === 'iweb'
        ? parseIwebAnlass(html, seiteUrl, heute)
        : familie === 'drupal'
          ? parseDrupalAnlass(html, seiteUrl, heute)
          : parseBackslashAnlass(html, seiteUrl, heute)
  if (eigen.beschreibung.trim() !== '' || eigen.weitereTermine.length > 0)
    return eigen
  const generisch = parseDetail(html, familie, seiteUrl, heute)
  return {
    ...eigen,
    titel: eigen.titel ?? generisch.titel,
    beschreibung: generisch.text,
    dokumente:
      eigen.dokumente.length > 0 ? eigen.dokumente : generisch.dokumente,
    kanonisch: eigen.kanonisch ?? generisch.kanonisch,
    verfahren: 'generisch'
  }
}

// --- Traktanden ----------------------------------------------------------------

/** How many agenda items ride along before the rest is counted. */
export const TRAKTANDEN_MAX = 30

export interface Traktanden {
  liste: string[]
  abgeschnitten: boolean
}

const DATEIGROESSE = /\s*\[(?:pdf|docx?|xlsx?|zip)[^\]]*\]\s*$/i

function kappeListe(liste: readonly string[]): Traktanden {
  const sauber = liste
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter((t) => t !== '')
  return {
    liste: sauber.slice(0, TRAKTANDEN_MAX),
    abgeschnitten: sauber.length > TRAKTANDEN_MAX
  }
}

/** Rows of a table: "Nr" and the text of the widest cell, joined. */
function tabellenZeilen(tabelle: string): string[] {
  const zeilen: string[] = []
  for (const tr of tabelle.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const zellen = [
      ...(tr[1] ?? '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)
    ]
      .map((z) => reinerText(z[1] ?? '').replace(DATEIGROESSE, ''))
      .filter((z) => z !== '')
    if (zellen.length < 2) continue
    if (
      /^(nr\.?|bezeichnung|gesch[äa]ft(?: nr\.?)?|beilagen|name|download)$/i.test(
        zellen[0] ?? ''
      )
    )
      continue
    const nummer = /^\d{1,3}$/.test(zellen[0] ?? '') ? zellen[0] : null
    const text = nummer === null ? zellen[0] : zellen[1]
    if (
      text === undefined ||
      /^(einladung|beschl[üu]sse|protokoll)\b/i.test(text)
    )
      continue
    zeilen.push(nummer === null ? text : `${nummer} ${text}`)
  }
  return zeilen
}

/**
 * The agenda of a sitting, from whichever of the three measured shapes the
 * page has: i-web's Traktanden table (Pratteln), a numbered list under a
 * "Traktanden" heading (Münchenstein), or Backslash's sessions page that
 * lists the whole year and needs the day to pick its section (Binningen —
 * pass `tag` as ISO). Empty when the page carries none.
 */
export function parseTraktanden(
  html: string,
  tag: string | null = null
): Traktanden {
  // 1. A heading "Traktanden" followed by a table.
  const kopf = /<(?:h[1-4]|p)\b[^>]*>\s*Traktanden\s*<\/(?:h[1-4]|p)\s*>/i.exec(
    html
  )
  if (kopf !== null) {
    const danach = html.slice((kopf.index ?? 0) + kopf[0].length)
    const tabelleStart = danach.search(/<table\b/i)
    const listeStart = danach.search(/<(?:ol|ul)\b/i)
    if (
      tabelleStart !== -1 &&
      (listeStart === -1 || tabelleStart < listeStart)
    ) {
      const zeilen = tabellenZeilen(schneideElement(danach, tabelleStart))
      if (zeilen.length > 0) return kappeListe(zeilen)
    }
    // 2. A numbered list under the heading.
    if (listeStart !== -1 && listeStart < 400) {
      const liste = schneideElement(danach, listeStart)
      const punkte = [
        ...liste.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)
      ].map((li) => reinerText((li[1] ?? '').replace(/<br\s*\/?>/gi, ' — ')))
      if (punkte.length > 0) return kappeListe(punkte)
    }
  }

  // 3. A sessions page with one section per day: the heading that names the day.
  if (tag !== null) {
    const [j, m, t] = tag.split('-').map(Number)
    const monate = [
      'Januar',
      'Februar',
      'März',
      'April',
      'Mai',
      'Juni',
      'Juli',
      'August',
      'September',
      'Oktober',
      'November',
      'Dezember'
    ]
    const monat = monate[(m ?? 1) - 1] ?? ''
    const tagText = `${t}. ${monat}`
    const numerisch = `${String(t).padStart(2, '0')}.${String(m).padStart(2, '0')}.${j}`
    for (const h of html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]\s*>/gi)) {
      const text = reinerText(h[1] ?? '')
      if (!text.includes(tagText) && !text.includes(numerisch)) continue
      const start = (h.index ?? 0) + h[0].length
      const rest = html.slice(start)
      const naechster = rest.search(/<h[1-2]\b/i)
      const abschnitt = naechster === -1 ? rest : rest.slice(0, naechster)
      const zeilen = tabellenZeilen(abschnitt)
      if (zeilen.length > 0) return kappeListe(zeilen)
    }
  }
  return { liste: [], abgeschnitten: false }
}
