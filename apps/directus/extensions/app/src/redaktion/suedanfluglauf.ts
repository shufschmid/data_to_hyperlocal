import type { Ausgabe } from '../shared/euroairport'

// The south-approach run's own decisions, pure and testable without a
// database — the daily check's branch in `operations/quellen-pruefen` is the
// wiring around them.
//
// Two rules live here and both were written down because the alternative is
// expensive or dishonest.
//
// **The run is frugal.** The overview page is read once a day; a month's PDF
// is fetched only when the month is new or when its address has moved. The
// address is what the source gives us: a revised month is re-uploaded under a
// new file name (`…WEBv0_07_1.pdf`), and the overview's link follows it. So a
// year in which nothing changed costs one request a day and nothing else.
//
// **A changed figure is an event, not an overwrite.** The row is carried
// forward, and the state it had is named in the run's result — because a
// published article may be standing on the figure that just moved, and the
// revision watchdog runs on exactly those months afterwards.

/** The stored state of a month, as this module needs to see it. */
export interface GespeicherterMonat {
  id: string
  jahr: number
  monat: number
  anfluege: number | null
  suedlandungen: number | null
  quote: number | null
  quelle_url: string | null
  pruefsumme: string | null
}

/** The figures of a month, from either side of a comparison. */
export interface Monatszahlen {
  anfluege: number | null
  suedlandungen: number | null
  quote: number | null
}

/**
 * How many sheets one run may fetch.
 *
 * Twelve is a year, and a year is what a first run of this source has to be
 * able to reach before the newsroom can say anything about a trend. The
 * overview links 51 months today, so the first run would otherwise make 51
 * requests in one pass — and the rest are history that is not going anywhere.
 */
export const MAX_BLAETTER_JE_LAUF = 12

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

/** "Juli 2026" — how a run's result and a Befund name a month. */
export function monatDeutsch(jahr: number, monat: number): string {
  return `${MONATE[monat - 1] ?? monat} ${jahr}`
}

function alsDeutsch(zahl: number): string {
  return String(zahl).replace('.', ',')
}

const schluessel = (jahr: number, monat: number): string => `${jahr}-${monat}`

export interface Holplan {
  holen: Ausgabe[]
  /** German sentences for the run's result — a cap that bites is never silent. */
  hinweise: string[]
}

/**
 * Which of the linked months this run actually fetches, newest first.
 *
 * A month is fetched when we have never seen it, or when the overview now
 * links it at a different address than the one we stored. Everything else
 * stays where it is — we already hold it, and the source has not said
 * otherwise.
 */
export function zuHolen(
  ausgaben: readonly Ausgabe[],
  bestand: readonly GespeicherterMonat[],
  hoechstens: number = MAX_BLAETTER_JE_LAUF
): Holplan {
  const bekannt = new Map<string, GespeicherterMonat>()
  for (const monat of bestand) {
    bekannt.set(schluessel(monat.jahr, monat.monat), monat)
  }

  const offen = ausgaben
    .filter((ausgabe) => {
      const gespeichert = bekannt.get(schluessel(ausgabe.jahr, ausgabe.monat))
      if (gespeichert === undefined) return true
      return gespeichert.quelle_url !== ausgabe.url
    })
    // Newest first: what the newsroom would write about this week comes before
    // what it might write about next year.
    .sort((a, b) => b.jahr - a.jahr || b.monat - a.monat)

  const holen = offen.slice(0, hoechstens)
  const hinweise =
    offen.length > holen.length
      ? [
          `${holen.length} von ${offen.length} Monatsblaettern gelesen ` +
            `(Deckel ${hoechstens}), der Rest beim naechsten Lauf.`
        ]
      : []

  return { holen, hinweise }
}

/**
 * The German sentence naming the state a month had before this run changed it.
 *
 * `null` when nothing moved, and `null` for a month we did not hold — a first
 * reading is not a revision. Both figures are compared, not just the
 * percentage: 40 of 200 and 20 of 100 are the same quota and not the same
 * month, and an article that names the absolute numbers is wrong either way.
 */
export function aenderungsSatz(
  alt: GespeicherterMonat | null,
  neu: Monatszahlen
): string | null {
  if (alt === null) return null
  if (
    alt.anfluege === neu.anfluege &&
    alt.suedlandungen === neu.suedlandungen &&
    alt.quote === neu.quote
  ) {
    return null
  }

  const quote = (wert: number | null): string =>
    wert === null ? 'keine Quote' : `${alsDeutsch(wert)} Prozent`

  return (
    `${monatDeutsch(alt.jahr, alt.monat)}: der EuroAirport hat seine Zahlen ` +
    `revidiert — neu ${neu.suedlandungen ?? '?'} von ${neu.anfluege ?? '?'} ` +
    `Landungen (${quote(neu.quote)}), zuvor ${alt.suedlandungen ?? '?'} von ` +
    `${alt.anfluege ?? '?'} (${quote(alt.quote)}).`
  )
}
