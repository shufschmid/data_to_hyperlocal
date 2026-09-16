// The shared vocabulary of the waste calendars, and the two collections that
// stay silent.
//
// Ported from Dorfkoenig 3.0 (`src/dorfkoenig/entsorgung/leser.py`, lines 30 to
// 97), where it has been running against five municipalities since August 2026.
// Two pieces of it cost real money or real trust to learn, and both are kept
// here word for word rather than rediscovered:
//
//   1. **The order of the pairs IS the logic.** The first match wins, so
//      "Papier- und Kartonsammlung" must stand ahead of "Papier" — otherwise
//      one collection is filed twice.
//   2. **"Kehricht und Sperrgut" must stand ahead of "sperrgut".** Arlesheim
//      and Muenchenstein drive the two together and weekly. Read as Sperrgut
//      the collection is not silent, and a weekly routine turns into 105
//      reminders a year.
//
// Nothing here touches the network, the clock, or state.

/** The words this newsroom files a collection under. */
export type Abfuhrart =
  | 'kehricht'
  | 'gruengut'
  | 'papier'
  | 'karton'
  | 'papier_karton'
  | 'sperrgut'
  | 'metall'
  | 'haecksel'
  | 'sonderabfall'
  | 'christbaum'
  | 'sonstige'

/**
 * What appears in a source, and what this newsroom calls it.
 *
 * An ordered list, not a map: the first match wins, and the order is the rule.
 * Sorting this alphabetically would silently break two of the five
 * municipalities.
 */
const ARTEN: readonly (readonly [string, Abfuhrart])[] = [
  // Kehricht and Sperrgut drive together and weekly in Arlesheim and
  // Muenchenstein. This pair MUST stand ahead of "sperrgut" — see the header.
  ['kehricht und sperrgut', 'kehricht'],
  ['papier- und karton', 'papier_karton'],
  ['altpapier und karton', 'papier_karton'],
  ['papier und karton', 'papier_karton'],
  ['papier/karton', 'papier_karton'],
  ['tannenbaum', 'christbaum'],
  ['weihnachtsbaum', 'christbaum'],
  ['christbaum', 'christbaum'],
  ['häcksel', 'haecksel'],
  ['haecksel', 'haecksel'],
  ['sperrgut', 'sperrgut'],
  ['altmetall', 'metall'],
  ['metall', 'metall'],
  ['sonderabfall', 'sonderabfall'],
  ['altpapier', 'papier'],
  ['papier', 'papier'],
  ['karton', 'karton'],
  ['grüngut', 'gruengut'],
  ['gruengut', 'gruengut'],
  ['grünabfuhr', 'gruengut'],
  ['grünabfall', 'gruengut'],
  ['bioabfall', 'gruengut'],
  ['schwarzkehricht', 'kehricht'],
  ['hauskehricht', 'kehricht'],
  ['kehricht', 'kehricht']
]

/**
 * The weekly routine. A resident knows their fixed weekday; a reminder would be
 * noise, and a weekly one would teach them to ignore the others.
 *
 * A list, not a rhythm test. An earlier attempt in Dorfkoenig derived silence
 * from the RHYTHM — whatever runs weekly is routine — and against Riehen's
 * calendar that silenced the Christbaum collection, which runs on four
 * Thursdays in January and looks like a weekly series. Silencing something by
 * mistake is the expensive failure here, because nobody notices: nothing
 * happens.
 */
const STUMME_ARTEN: ReadonlySet<Abfuhrart> = new Set<Abfuhrart>([
  'kehricht',
  'gruengut'
])

/**
 * "Altpapier bis 6 Uhr bereit stellen" and "Altpapier" are the same collection.
 * Riehen writes both forms in the same calendar.
 */
const FLOSKEL = /\s*bis\s+\d{1,2}([.:]\d{2})?\s*Uhr.*$/i

/**
 * What this newsroom files a collection under. Unknown becomes `sonstige`,
 * never nothing.
 *
 * Fail open towards the person: an unknown collection lands on the desk as a
 * proposal instead of disappearing quietly. If a municipality introduces a new
 * collection, a superfluous proposal is the cheap mistake and a collection
 * nobody was told about the expensive one.
 */
export function normalisiereArt(roh: string): Abfuhrart {
  const text = roh.replace(FLOSKEL, '').trim().toLowerCase()
  for (const [muster, art] of ARTEN) {
    if (text.includes(muster)) return art
  }
  return 'sonstige'
}

/** Is this collection a routine nobody needs to be reminded of? */
export function istStumm(art: Abfuhrart): boolean {
  return STUMME_ARTEN.has(art)
}
