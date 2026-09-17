// Reading a waste calendar without a model.
//
// The printed calendar is the source of record, and reading it takes Opus and a
// careful cross-check (`redaktion/entsorgung.ts`). But three of the five
// municipalities measured publish the SAME dates machine-readably, and for
// those a model call buys nothing except a bill and a chance to be wrong:
//
//   Riehen         official iCal per zone, with RRULE and EXDATE   -> liesIcs
//   Aesch          the website's collection table (icms widget)    -> liesIcmsTabelle
//   Pratteln       the same table (its PDF is a scan)              -> liesIcmsTabelle
//
// So this is not a better reader, it is a cheaper and checkable FIRST path; the
// model keeps the calendars that exist only in print. Ported from Dorfkoenig 3.0
// (`src/dorfkoenig/entsorgung/leser.py`, `lies_ics` and `lies_icms_tabelle`),
// where both have run against real municipalities since August 2026.
//
// Every function here is a pure function from text to dates: no network, no
// clock, no state. What is fetched is somebody else's decision; what it means is
// a person's, at the Freigabe.

import { istStumm, normalisiereArt, type Abfuhrart } from './arten'

/** One collection day, as a source states it. */
export interface KalenderTermin {
  /** ISO date, `YYYY-MM-DD`. */
  datum: string
  art: Abfuhrart
  /** The source's own wording — what a person reads to check the reading. */
  artRoh: string
  /** The collection zone the source names; empty when it names none. */
  zone: string
  /** A weekly routine, which never becomes a Termin. */
  stumm: boolean
}

function iso(jahr: number, monat: number, tag: number): string {
  return `${String(jahr).padStart(4, '0')}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
}

function isoVon(datum: Date): string {
  return iso(
    datum.getUTCFullYear(),
    datum.getUTCMonth() + 1,
    datum.getUTCDate()
  )
}

function termin(datum: string, roh: string, zone: string): KalenderTermin {
  const art = normalisiereArt(roh)
  return { datum, art, artRoh: roh, zone, stumm: istStumm(art) }
}

/** Newest first would be wrong here: a calendar is read forwards. */
function sortiert(termine: KalenderTermin[]): KalenderTermin[] {
  return [...termine].sort((a, b) =>
    a.datum === b.datum
      ? a.art.localeCompare(b.art) || a.zone.localeCompare(b.zone)
      : a.datum.localeCompare(b.datum)
  )
}

// --- iCal --------------------------------------------------------------------

/** RFC 5545 folds long lines with a leading space or tab. */
function entfalte(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
}

/** `DTSTART;VALUE=DATE:20260112` → a UTC date, or null. */
function icsDatum(wert: string): Date | null {
  const roh = (wert.split(':').pop() ?? '').trim().slice(0, 8)
  if (!/^\d{8}$/.test(roh)) return null
  const datum = new Date(
    Date.UTC(
      Number(roh.slice(0, 4)),
      Number(roh.slice(4, 6)) - 1,
      Number(roh.slice(6, 8))
    )
  )
  return Number.isNaN(datum.getTime()) ? null : datum
}

const WOCHENTAGE: Readonly<Record<string, number>> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 0
}

const TAG_MS = 24 * 60 * 60 * 1000

/**
 * Turns an RRULE into single days. WEEKLY only, and on purpose.
 *
 * Riehen's calendar uses nothing but `FREQ=WEEKLY` with INTERVAL and COUNT; a
 * general RRULE engine would be code for cases no source presents. An unknown
 * frequency therefore yields the start day alone rather than a guessed series.
 */
function entfalteSerie(
  start: Date,
  rrule: string,
  ausnahmen: ReadonlySet<string>
): string[] {
  const teile = new Map<string, string>(
    rrule
      .split(';')
      .filter((stueck) => stueck.includes('='))
      .map((stueck) => {
        const [name, ...rest] = stueck.split('=')
        return [name ?? '', rest.join('=')] as [string, string]
      })
  )
  if (teile.get('FREQ') !== 'WEEKLY') return [isoVon(start)]

  const schritt = Number(teile.get('INTERVAL') ?? '1') || 1
  const anzahl = teile.has('COUNT') ? Number(teile.get('COUNT')) : null
  const bisRoh = teile.get('UNTIL')
  const bis = bisRoh === undefined ? null : icsDatum(bisRoh)
  const tage = (teile.get('BYDAY') ?? '')
    .split(',')
    .map((kuerzel) => WOCHENTAGE[kuerzel.trim()])
    .filter((tag): tag is number => tag !== undefined)

  // COUNT counts repetitions of the RULE, not the dates that survive: a day
  // struck by EXDATE uses up its repetition. Striking first and then topping
  // the series back up to COUNT hangs one extra date on the end per holiday —
  // measured in Dorfkoenig, Riehens Altpapier ran into January 2027 instead of
  // stopping in December. So: generate against COUNT, strike afterwards.
  const erzeugt: string[] = []
  const wochentage = tage.length > 0 ? [...tage].sort() : [start.getUTCDay()]
  // Monday of the start week. The ISO weekday of Sunday is 0, and a week here
  // starts on Monday, like the calendars themselves.
  const versatz = (start.getUTCDay() + 6) % 7
  let woche = new Date(start.getTime() - versatz * TAG_MS)

  const ohneAusnahmen = (): string[] =>
    erzeugt.filter((tag) => !ausnahmen.has(tag))

  // A cap against a series with neither COUNT nor UNTIL: five years of weeks.
  for (let runde = 0; runde < 260; runde += 1) {
    for (const wochentag of wochentage) {
      const versatzImWoche = (wochentag + 6) % 7
      const tag = new Date(woche.getTime() + versatzImWoche * TAG_MS)
      if (tag < start) continue
      if (bis !== null && tag > bis) return ohneAusnahmen()
      erzeugt.push(isoVon(tag))
      if (anzahl !== null && erzeugt.length >= anzahl) return ohneAusnahmen()
    }
    woche = new Date(woche.getTime() + schritt * 7 * TAG_MS)
  }
  return ohneAusnahmen()
}

/**
 * The collection days of an iCal calendar. Series are unfolded, EXDATE applies.
 *
 * EXDATE is not a detail: without it Riehen produces collection days on public
 * holidays, and a person puts the container out for nothing. That is the most
 * expensive kind of mistake this reader can make, because it teaches people to
 * stop trusting the reminder.
 */
export function liesIcs(text: string): KalenderTermin[] {
  const termine: KalenderTermin[] = []
  let offen = false
  let aktuell = new Map<string, string>()
  let ausnahmen = new Set<string>()

  for (const zeile of entfalte(text)) {
    if (zeile.startsWith('BEGIN:VEVENT')) {
      offen = true
      aktuell = new Map()
      ausnahmen = new Set()
      continue
    }
    if (!offen) continue

    if (zeile.startsWith('END:VEVENT')) {
      offen = false
      const start = icsDatum(aktuell.get('DTSTART') ?? '')
      const roh =
        (aktuell.get('SUMMARY') ?? '').split(/:(.*)/s)[1]?.trim() ?? ''
      if (start === null || roh === '') continue
      const rrule = aktuell.get('RRULE')
      const tage =
        rrule === undefined
          ? ausnahmen.has(isoVon(start))
            ? []
            : [isoVon(start)]
          : entfalteSerie(start, rrule.split(/:(.*)/s)[1] ?? '', ausnahmen)
      for (const tag of tage) termine.push(termin(tag, roh, ''))
      continue
    }

    const name = (zeile.split(';')[0] ?? '').split(':')[0] ?? ''
    if (name === 'EXDATE') {
      for (const stueck of (zeile.split(/:(.*)/s)[1] ?? '').split(',')) {
        const tag = icsDatum(stueck)
        if (tag !== null) ausnahmen.add(isoVon(tag))
      }
    } else if (
      (name === 'DTSTART' || name === 'SUMMARY' || name === 'RRULE') &&
      !aktuell.has(name)
    ) {
      aktuell.set(name, zeile)
    }
  }

  // Series overlap: Riehen carries the same collection as a series AND as
  // single events.
  const einmalig = new Map<string, KalenderTermin>()
  for (const t of termine) einmalig.set(`${t.datum}|${t.art}|${t.zone}`, t)
  return sortiert([...einmalig.values()])
}

// --- the municipality website's collection table (icms) ----------------------

const WIDGET = /data-entities="([^"]+)"/
const TAGS = /<[^>]+>/g
const DATUM = /(\d{2})\.(\d{2})\.(\d{4})/

/**
 * The five entities an icms attribute carries. `&amp;` is decoded last, or
 * `&amp;quot;` would turn into a quotation mark and break the JSON.
 */
function entschluessle(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * The collection days from a municipality's waste widget (Aesch, Pratteln).
 *
 * The page carries the table as HTML-escaped JSON in `data-entities`. That is
 * the source the visible table is built from, not a by-product of the
 * rendering, which is why reading it is not scraping the layout.
 *
 * A page without the widget yields no dates and no exception: a municipality
 * that rebuilds its site has none for a while, and "nothing today" is an
 * answer. The run says so — see the caller.
 */
export function liesIcmsTabelle(seite: string): KalenderTermin[] {
  const treffer = WIDGET.exec(seite)
  if (treffer === null || treffer[1] === undefined) return []

  let daten: unknown
  try {
    daten = JSON.parse(entschluessle(treffer[1]))
  } catch {
    return []
  }
  if (typeof daten !== 'object' || daten === null) return []
  const zeilen = (daten as { data?: unknown }).data
  if (!Array.isArray(zeilen)) return []

  const termine: KalenderTermin[] = []
  for (const zeile of zeilen) {
    if (typeof zeile !== 'object' || zeile === null) continue
    const eintrag = zeile as Record<string, unknown>
    const datum = DATUM.exec(String(eintrag['_anlassDate'] ?? ''))
    const roh = String(eintrag['name'] ?? '')
      .replace(TAGS, '')
      .trim()
    if (datum === null || roh === '') continue
    termine.push(
      termin(
        iso(Number(datum[3]), Number(datum[2]), Number(datum[1])),
        roh,
        String(eintrag['abfallkreisNameList'] ?? '').trim()
      )
    )
  }
  return sortiert(termine)
}
