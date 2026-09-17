import { decodeEntities } from '../agenda/parse'

// Reading the EuroAirport's ILS-33 usage statistics — the pure half.
//
// The airport publishes one PDF per month: one line per day with the number of
// IFR approaches, how many of them landed over the south (runway 33), the
// percentage and the time windows, then a TOTAL row. That percentage is the
// „Suedanflug-Quote" Binningen and Allschwil argue about every summer, and it
// is the one figure in this project that arrives ready-made rather than being
// computed from rows.
//
// Nothing here calls the network, reads a clock or asks a model. The whole
// reading is deterministic, which is the reason the newsroom took this source
// at all: the 43,7 percent the Binninger Wochenblatt printed for July 2026
// stands in the PDF as `TOTAL 3778 1652 43,7%`, and this module gets there
// without a model.
//
// Three properties of the source were measured on 17 September 2026 and every
// one of them has a consequence in the code below.
//
//   1. **The figures stay provisional for ever.** December 2025, updated on
//      30 January 2026, still says „Provisorische Zahlen". Months are re-
//      uploaded (`WEBv0_07_1`), so a published article can go wrong later —
//      which is what the revision watchdog is for.
//   2. **The source contradicts itself.** On 7 August 2026 it prints 130 south
//      landings on 128 approaches, 101,6 percent. That is reported as a
//      Befund, never smoothed: a reader in Binningen who counted the aircraft
//      would see the same number.
//   3. **A dash is not a missing value, it is no south landing.** Those days
//      count as zero and their row is present. The Uhrzeit column may then be
//      absent altogether or be a dash of its own.
//
// The checks next to the parser report and never correct. That is the same
// division of labour as everywhere else here: the parser says what the paper
// says, the checks say where the paper disagrees with itself.

export const EUROAIRPORT_HOST = 'www.euroairport.com'
export const EUROAIRPORT_BASIS = `https://${EUROAIRPORT_HOST}`

/** One month's sheet as the overview page links it. */
export interface Ausgabe {
  jahr: number
  /** 1 to 12, read from the row header — never from the file name. */
  monat: number
  url: string
}

/** One day of the month, exactly as the sheet prints it. */
export interface Tag {
  /** ISO `YYYY-MM-DD`; the sheet writes `TT/MM/JJJJ`. */
  datum: string
  anfluege: number
  /** A dash means no south landing, so it means zero. */
  suedlandungen: number
  /** The percentage as PRINTED, decimal point. Null only when unreadable. */
  quote: number | null
  /** `13h53-20h30`, verbatim — including the source's own typos. */
  zeitfenster: string[]
}

export interface Monatsblatt {
  jahr: number
  monat: number
  tage: Tag[]
  /** The TOTAL row's approaches. */
  anfluege: number
  suedlandungen: number
  quote: number | null
  /** ISO day of „Aktualisiert am", or null when the sheet does not say. */
  aktualisiert_am: string | null
  /** Whether the sheet still calls its figures provisional. Measured: always. */
  provisorisch: boolean
  /** German sentences, one per disagreement found. Never a correction. */
  befunde: string[]
}

/** What the overview's table cell said this sheet is — the only authority. */
export interface Erwartet {
  jahr: number
  monat: number
}

const MONATE = [
  'Januar',
  'Februar',
  'Maerz',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember'
] as const

function reinerText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** "2026-08-01" as "1. August 2026" — the form a Befund names a day in. */
export function tagDeutsch(iso: string): string {
  const [jahr, monat, tag] = iso.split('-').map(Number)
  if (jahr === undefined || monat === undefined || tag === undefined) return iso
  return `${tag}. ${MONATE[monat - 1] ?? monat} ${jahr}`
}

/** "43,7%" or "43,7" as 43.7 — the sheet writes a decimal COMMA. */
function prozent(roh: string): number | null {
  const zahl = Number(roh.replace('%', '').replace(',', '.').trim())
  return Number.isFinite(zahl) ? zahl : null
}

/** A number the way a German sentence prints it back: 43.7 as "43,7". */
function alsDeutsch(zahl: number): string {
  return String(zahl).replace('.', ',')
}

function absolut(link: string): string {
  if (/^https?:\/\//i.test(link)) return link
  return `${EUROAIRPORT_BASIS}${link.startsWith('/') ? '' : '/'}${link}`
}

/**
 * The months the overview page links, with the year and month the TABLE says.
 *
 * The addresses are not predictable and never parsed for meaning. The upload
 * folder names the month a file was PUT THERE (`…/2026/09/…` for the August
 * report), the `WEBv0_08` is the report month, and `_0`/`_1` is a re-upload —
 * all of it a hint and none of it a contract. July 2023 settles the question:
 * its file is called `Utilisation_ILS33_pour_2023_Juillet.pdf`, with no month
 * number in the name at all. So the row header gives the month, the column
 * header gives the year, and the address is only ever followed.
 *
 * A page without a table, or with an empty one, is an empty list — not a
 * failure. The airport publishes on its own schedule and a month that is not
 * there yet is simply not there.
 */
export function parseUebersicht(html: string): Ausgabe[] {
  const tabelle = /<table[\s\S]*?<\/table>/i.exec(html)?.[0]
  if (tabelle === undefined) return []

  const kopf = /<thead[\s\S]*?<\/thead>/i.exec(tabelle)?.[0] ?? ''
  const jahre = [...kopf.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(
    (treffer) => {
      const jahr = /\b(20\d{2})\b/.exec(reinerText(treffer[1] ?? ''))
      return jahr === null ? null : Number(jahr[1])
    }
  )
  if (jahre.length === 0) return []

  const koerper = /<tbody[\s\S]*?<\/tbody>/i.exec(tabelle)?.[0] ?? tabelle
  const ausgaben: Ausgabe[] = []

  for (const zeile of koerper.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const zellen = [
      ...(zeile[1] ?? '').matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)
    ].map((treffer) => treffer[1] ?? '')
    const kopfzelle = zellen[0]
    if (kopfzelle === undefined) continue

    // "01 - Januar", and September's cell carries three trailing spaces. The
    // leading number is what is read — a month NAME would have to be matched
    // in two languages and gains nothing.
    const monat = /^\s*(\d{1,2})\b/.exec(reinerText(kopfzelle))
    if (monat === null) continue
    const monatNummer = Number(monat[1])
    if (monatNummer < 1 || monatNummer > 12) continue

    for (let spalte = 1; spalte < zellen.length; spalte += 1) {
      const jahr = jahre[spalte]
      if (jahr === undefined || jahr === null) continue

      const link = /<a\b[^>]*href="([^"]+)"/i.exec(zellen[spalte] ?? '')?.[1]
      // An empty cell is a month that has not been published. Nothing to do.
      if (link === undefined) continue

      ausgaben.push({
        jahr,
        monat: monatNummer,
        url: absolut(decodeEntities(link))
      })
    }
  }

  return ausgaben
}

/**
 * A day line, and every shape of it that the real sheets print.
 *
 *   `01/08/2026 105 35 33,3% 13h53-20h30`      the ordinary one
 *   `02/08/2026 132 10 7,6% 16h07-16h52; …`    several windows
 *   `27/08/2026 124 1 0,8%`                    a landing, no window printed
 *   `03/08/2026 120 - -`                       no landing, no Uhrzeit column
 *   `15/08/2026 102 - - -`                     no landing, Uhrzeit a dash too
 */
const TAGZEILE =
  /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d+)\s+(\d+|-)(?:\s+(\S+))?(?:\s+([\s\S]*))?$/

const TOTALZEILE = /^TOTAL\s+(\d+)\s+(\d+|-)(?:\s+([\d.,]+%|-))?\s*$/i
const AKTUALISIERT = /Aktualisiert am\s+(\d{2})\/(\d{2})\/(\d{4})/i
const PROVISORISCH = /Provisorische Zahlen|Donn[ée]es provisoires/i
/** Either a percentage or the dash that stands for none. */
const PROZENTFELD = /^(?:[\d.,]+%?|-)$/

/**
 * The time windows of one day, as printed.
 *
 * Split on the semicolon and nothing else, kept verbatim. The sheet for
 * 17 July 2026 prints `14h327-21h47` — four digits where three belong — and
 * that is the airport's typo to own, not ours to repair. A lone dash is the
 * column saying there is nothing, so it yields no window.
 */
function zeitfensterAus(roh: string | undefined): string[] {
  if (roh === undefined) return []
  return roh
    .split(';')
    .map((stueck) => stueck.trim())
    .filter((stueck) => stueck !== '' && stueck !== '-')
}

/**
 * Whether a printed percentage matches the division it claims to be.
 *
 * One decimal place of tolerance, which is what the sheet itself rounds to:
 * 35 of 105 is 33,333… and prints as 33,3%. Anything further apart is the
 * source disagreeing with itself.
 */
const TOLERANZ = 0.1

function quoteBefund(
  was: string,
  gedruckt: number | null,
  teil: number,
  ganzes: number
): string | null {
  if (gedruckt === null || ganzes === 0) return null
  const gerechnet = Math.round((teil / ganzes) * 1000) / 10
  if (Math.abs(gedruckt - gerechnet) <= TOLERANZ) return null
  return (
    `${was}: gedruckt sind ${alsDeutsch(gedruckt)} Prozent, aus ${teil} von ` +
    `${ganzes} errechnen sich ${alsDeutsch(gerechnet)} Prozent.`
  )
}

/**
 * One month's sheet, from the PDF's text layer.
 *
 * `erwartet` is what the overview's table cell said this file is. It is
 * compared, never used: the day lines carry their own month, and if the two
 * disagree the run has to hear about it rather than file a month under the
 * wrong name. Without it the day lines decide alone.
 *
 * A text layer with no day line at all is a failure and says so — a silent
 * empty month would look exactly like a quiet one.
 */
export function parseMonatsblatt(
  text: string,
  erwartet?: Erwartet
): Monatsblatt {
  const befunde: string[] = []
  const tage: Tag[] = []

  let total: { anfluege: number; suedlandungen: number; quote: number | null } =
    { anfluege: 0, suedlandungen: 0, quote: null }
  let totalGelesen = false
  let aktualisiert: string | null = null

  for (const rohzeile of text.split('\n')) {
    const zeile = rohzeile.trim()
    if (zeile === '') continue

    const tag = TAGZEILE.exec(zeile)
    if (tag !== null) {
      const [, tt, mm, jjjj, anflueege, sued, drittes, rest] =
        tag as unknown as [
          string,
          string,
          string,
          string,
          string,
          string,
          string?,
          string?
        ]

      // The third column is the percentage where it is a percentage, and part
      // of the Uhrzeit where the sheet left the percentage out entirely. Only
      // a field that LOOKS like one is read as one.
      const istProzentfeld = drittes !== undefined && PROZENTFELD.test(drittes)
      const zeitRoh = istProzentfeld
        ? rest
        : [drittes, rest].filter((s) => s !== undefined).join(' ')

      const suedlandungen = sued === '-' ? 0 : Number(sued)
      const anzahl = Number(anflueege)
      const quote =
        sued === '-'
          ? 0
          : istProzentfeld && drittes !== '-'
            ? prozent(drittes)
            : null

      tage.push({
        datum: `${jjjj}-${mm}-${tt}`,
        anfluege: anzahl,
        suedlandungen,
        quote,
        zeitfenster: zeitfensterAus(zeitRoh)
      })
      continue
    }

    const summe = TOTALZEILE.exec(zeile)
    if (summe !== null) {
      total = {
        anfluege: Number(summe[1]),
        suedlandungen: summe[2] === '-' ? 0 : Number(summe[2]),
        quote:
          summe[3] === undefined || summe[3] === '-' ? null : prozent(summe[3])
      }
      totalGelesen = true
      continue
    }

    const stand = AKTUALISIERT.exec(zeile)
    if (stand !== null) aktualisiert = `${stand[3]}-${stand[2]}-${stand[1]}`
  }

  if (tage.length === 0) {
    throw new EuroairportFehler(
      'Die Textschicht des Monatsblatts enthaelt keine Tageszeile.'
    )
  }

  const erster = tage[0] as Tag
  const [jahrRoh, monatRoh] = erster.datum.split('-')
  const jahr = Number(jahrRoh)
  const monat = Number(monatRoh)

  if (
    erwartet !== undefined &&
    (erwartet.jahr !== jahr || erwartet.monat !== monat)
  ) {
    befunde.push(
      `Die Tabellenzelle nennt ${String(erwartet.monat).padStart(2, '0')}/` +
        `${erwartet.jahr}, die Tageszeilen nennen ${monatRoh}/${jahrRoh}.`
    )
  }

  // Check one: the day lines against the TOTAL row, each column on its own.
  const summeAnfluege = tage.reduce((summe, tag) => summe + tag.anfluege, 0)
  const summeSued = tage.reduce((summe, tag) => summe + tag.suedlandungen, 0)
  if (totalGelesen && summeAnfluege !== total.anfluege) {
    befunde.push(
      `Die Tageszeilen ergeben ${summeAnfluege} Anfluege, die TOTAL-Zeile nennt ${total.anfluege}.`
    )
  }
  if (totalGelesen && summeSued !== total.suedlandungen) {
    befunde.push(
      `Die Tageszeilen ergeben ${summeSued} Suedlandungen, die TOTAL-Zeile nennt ${total.suedlandungen}.`
    )
  }

  // Check two: every printed percentage against its own division.
  for (const tag of tage) {
    const befund = quoteBefund(
      tagDeutsch(tag.datum),
      tag.quote,
      tag.suedlandungen,
      tag.anfluege
    )
    if (befund !== null) befunde.push(befund)
  }
  if (totalGelesen) {
    const befund = quoteBefund(
      'Monatstotal',
      total.quote,
      total.suedlandungen,
      total.anfluege
    )
    if (befund !== null) befunde.push(befund)
  }

  // Check three: a day on which more aircraft landed over the south than
  // landed at all. The source prints it; we say so.
  for (const tag of tage) {
    if (tag.suedlandungen <= tag.anfluege) continue
    const quote =
      tag.quote === null ? '' : ` (${alsDeutsch(tag.quote)} Prozent)`
    befunde.push(
      `${tagDeutsch(tag.datum)}: ${tag.suedlandungen} Suedlandungen bei ` +
        `${tag.anfluege} Anfluegen${quote} — die Quelle widerspricht sich hier selbst.`
    )
  }

  return {
    jahr,
    monat,
    tage,
    anfluege: totalGelesen ? total.anfluege : summeAnfluege,
    suedlandungen: totalGelesen ? total.suedlandungen : summeSued,
    quote: total.quote,
    aktualisiert_am: aktualisiert,
    provisorisch: PROVISORISCH.test(text),
    befunde
  }
}

export class EuroairportFehler extends Error {
  constructor(
    message: string,
    readonly url?: string
  ) {
    super(message)
    this.name = 'EuroairportFehler'
  }
}
