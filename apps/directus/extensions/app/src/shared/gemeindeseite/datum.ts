// Dates as municipal websites print them — and the two inferences the pages
// force on us.
//
// Measured on the nine registered pages: "Mittwoch, 19.08.2026", " 08.09.2026 ",
// "03. Sep 2026", "11. September 2026", "2026-09-10 07:55", "14.09.26" — and two
// traps that make a plausibility check mandatory rather than nice-to-have: one
// page's `<time datetime>` carries the year 2626 on every card, another prints a
// calendar badge with month and day but no year at all. Nothing here guesses:
// a date either parses to a real calendar day inside a narrow window around
// today, or it is null.

export interface Heute {
  jahr: number
  monat: number
  tag: number
}

/** Today from an ISO date — the one clock every date decision here is measured against. */
export function heuteAus(iso: string): Heute {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (treffer === null) throw new Error(`Kein ISO-Datum: ${iso}`)
  return {
    jahr: Number(treffer[1]),
    monat: Number(treffer[2]),
    tag: Number(treffer[3])
  }
}

const MONATE: Record<string, number> = {
  jan: 1,
  feb: 2,
  mae: 3,
  mrz: 3,
  mar: 3,
  apr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  okt: 10,
  nov: 11,
  dez: 12
}

/** "Sep", "Sept.", "September", "Juli", "März", "Maerz", "Mrz" → month number. */
export function monatVon(name: string): number | null {
  const klein = name
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/\./g, '')
    .trim()
  if (klein === '') return null
  const kurz = klein.startsWith('mrz') ? 'mrz' : klein.slice(0, 3)
  return MONATE[kurz] ?? null
}

function istKalendertag(jahr: number, monat: number, tag: number): boolean {
  const d = new Date(Date.UTC(jahr, monat - 1, tag))
  return (
    d.getUTCFullYear() === jahr &&
    d.getUTCMonth() === monat - 1 &&
    d.getUTCDate() === tag
  )
}

function iso(jahr: number, monat: number, tag: number): string {
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
}

/** No municipal website dates anything before this; earlier "years" are noise. */
const FRUEHESTES_JAHR = 2000

/**
 * A real calendar day between 2000 and next year.
 *
 * The upper bound is what rejects "2626-09-14" (a `<time datetime>` bug
 * measured on one card list), `istKalendertag` rejects "31.02.2026", and
 * neither needs a special case. The lower bound is deliberately NOT "near
 * today": an i-web archive lists its whole history on one page, and a row
 * dated 22.03.2022 is OLD, not UNDATED. Treating it as undated sent the
 * 2020 minutes of Münchenstein's Gemeindeversammlung to the desk as news
 * (measured 15.09.2026) — an old date stays outside the window by itself.
 */
export function plausibel(datum: string, heute: Heute): boolean {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum)
  if (treffer === null) return false
  const jahr = Number(treffer[1])
  const monat = Number(treffer[2])
  const tag = Number(treffer[3])
  if (!istKalendertag(jahr, monat, tag)) return false
  return jahr >= FRUEHESTES_JAHR && jahr <= heute.jahr + 1
}

/** "26" → 2026: the century that keeps the year at or below next year. */
export function jahrAusKurzform(yy: number, heute: Heute): number {
  const basis = Math.floor(heute.jahr / 100) * 100
  const jahr = basis + yy
  return jahr > heute.jahr + 1 ? jahr - 100 : jahr
}

/**
 * The year of a month-and-day badge on a news list: this year, unless the day
 * lies after today — a list of past news never reaches into the future.
 */
export function jahrFuerMonatTag(
  monat: number,
  tag: number,
  heute: Heute
): number {
  const spaeter =
    monat > heute.monat || (monat === heute.monat && tag > heute.tag)
  return spaeter ? heute.jahr - 1 : heute.jahr
}

/**
 * The year of a month-and-day mention inside an announcement: this year, unless
 * the day already passed — an announced collection or event lies ahead.
 */
export function jahrFuerMonatTagVorwaerts(
  monat: number,
  tag: number,
  heute: Heute
): number {
  const frueher =
    monat < heute.monat || (monat === heute.monat && tag < heute.tag)
  return frueher ? heute.jahr + 1 : heute.jahr
}

const TAG_MONAT_JAHR = /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?!\d)/
const TAG_MONATSNAME_JAHR =
  /(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]{3,9})\.?\s+(\d{4})(?!\d)/
const ISO_DATUM = /(\d{4})-(\d{2})-(\d{2})(?!\d)/
const TAG_MONAT_KURZJAHR = /(\d{1,2})\.(\d{1,2})\.(\d{2})(?!\d)/

/**
 * The first date in a short text, as ISO — or null when nothing plausible is
 * there. Numeric forms before the month-name form, the two-digit year last:
 * "14.09.26" must not be read as the 14th of September, year 26.
 */
export function parseDatum(text: string, heute: Heute): string | null {
  const roh = text.normalize('NFC')

  const numerisch = TAG_MONAT_JAHR.exec(roh)
  if (numerisch !== null) {
    const datum = iso(
      Number(numerisch[3]),
      Number(numerisch[2]),
      Number(numerisch[1])
    )
    if (plausibel(datum, heute)) return datum
  }

  const benannt = TAG_MONATSNAME_JAHR.exec(roh)
  if (benannt !== null) {
    const monat = monatVon(benannt[2] ?? '')
    if (monat !== null) {
      const datum = iso(Number(benannt[3]), monat, Number(benannt[1]))
      if (plausibel(datum, heute)) return datum
    }
  }

  const isoTreffer = ISO_DATUM.exec(roh)
  if (isoTreffer !== null) {
    const datum = `${isoTreffer[1]}-${isoTreffer[2]}-${isoTreffer[3]}`
    if (plausibel(datum, heute)) return datum
  }

  const kurz = TAG_MONAT_KURZJAHR.exec(roh)
  if (kurz !== null) {
    const datum = iso(
      jahrAusKurzform(Number(kurz[3]), heute),
      Number(kurz[2]),
      Number(kurz[1])
    )
    if (plausibel(datum, heute)) return datum
  }

  return null
}

const ALLE_MIT_JAHR =
  /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?!\d)|(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]{3,9})\.?\s+(\d{4})(?!\d)/g
const ALLE_OHNE_JAHR = /(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]{3,9})\b\.?(?!\s*\d{4})/g

/**
 * Every date an announcement names, as ISO, in text order and without
 * duplicates. Month-and-day mentions without a year ("Montag, 22. September")
 * take the forward inference: an announced date lies ahead.
 *
 * Built for the waste-collection cross-check, where the question is "which
 * days does this text talk about", not "when was it published".
 */
export function alleDaten(text: string, heute: Heute): string[] {
  const roh = text.normalize('NFC')
  const funde: { index: number; datum: string }[] = []

  for (const treffer of roh.matchAll(ALLE_MIT_JAHR)) {
    const index = treffer.index ?? 0
    if (treffer[1] !== undefined) {
      funde.push({
        index,
        datum: iso(Number(treffer[3]), Number(treffer[2]), Number(treffer[1]))
      })
      continue
    }
    const monat = monatVon(treffer[5] ?? '')
    if (monat !== null)
      funde.push({
        index,
        datum: iso(Number(treffer[6]), monat, Number(treffer[4]))
      })
  }

  for (const treffer of roh.matchAll(ALLE_OHNE_JAHR)) {
    const monat = monatVon(treffer[2] ?? '')
    if (monat === null) continue
    const tag = Number(treffer[1])
    funde.push({
      index: treffer.index ?? 0,
      datum: iso(jahrFuerMonatTagVorwaerts(monat, tag, heute), monat, tag)
    })
  }

  // Text order, whichever form a date came in; each day once.
  const gefunden: string[] = []
  for (const fund of funde.sort((a, b) => a.index - b.index)) {
    if (plausibel(fund.datum, heute) && !gefunden.includes(fund.datum))
      gefunden.push(fund.datum)
  }
  return gefunden
}
