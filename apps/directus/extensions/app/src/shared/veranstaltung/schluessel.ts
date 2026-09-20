// The series key — what makes "the same thing on another day" one Anlass.
//
// Measured on ten calendars (17–20.09.2026): Arlesheim prints one row per day
// of an exhibition, eight rows for INKLUSIV; Binningen prints one row per
// date of a series and carries the series id in the link; Pratteln prints
// one row with a span. The key has to fold the first two onto one row and
// leave the third alone, and it has to survive the site re-creating an entry
// under a new id (Pratteln's "Zusammen Jassen" ends on paper on 25.09. and
// comes back with a new number). So it is built from what the ROW says —
// title, venue — and never from the address. Readable, not hashed: the desk
// must be able to see why two rows became one.

const MARKER =
  /\b(?:ist\s+)?(?:leider\s+)?(?:abgesagt|verschoben|ausverkauft|findet nicht statt|f[äa]llt aus|entf[äa]llt)\b/giu
const DATUM =
  /\b\d{1,2}\.\s?\d{1,2}\.(?:\s?\d{2,4})?(?!\d)|\b\d{1,2}\.\s*(?:januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|mrz|apr|jun|jul|aug|sep|sept|okt|nov|dez)\b\.?(?:\s*\d{4})?/giu
const ZEIT = /\b\d{1,2}[.:]\d{2}\s*(?:uhr)?/giu
const JAHR = /\b(?:19|20)\d{2}\b/g

/**
 * A title with everything that varies between the dates of one series taken
 * out: the date, the time, the year ("Chorprojekte Herbst 2026" is the same
 * choir next year), and the cancellation markers — a cancelled date belongs
 * to its series, it does not found a new one. The weekday STAYS: it is part
 * of a name ("Freitags Treff", "Meditation am Montag") and the same on every
 * date.
 */
export function normalisiereTitel(titel: string): string {
  return titel
    .normalize('NFC')
    .toLowerCase()
    .replace(MARKER, ' ')
    .replace(DATUM, ' ')
    .replace(ZEIT, ' ')
    .replace(JAHR, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function normalisiereOrt(ort: string | null): string {
  return (ort ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** The start of a printed time: "18:00–21:00" → "18:00". */
export function startZeit(zeit: string | null): string {
  return /\d{1,2}:\d{2}/.exec(zeit ?? '')?.[0] ?? ''
}

export const SCHLUESSEL_MAX = 300

export interface SchluesselEingabe {
  titel: string
  lokalitaet: string | null
  zeit: string | null
  /** The site's own series id, where it prints one. Wins over everything else. */
  serie: string | null
}

/**
 * Title and venue, or the site's own series id. The time is added only when
 * asked for — `gruppiereAnlaesse` asks for it when two rows of one group fall
 * on the same day at different times, which is two groups (Arlesheim's
 * Krabbelgruppe, twice on a Tuesday), and does not ask otherwise, because a
 * fair on Tuesday afternoon and Wednesday morning is one fair.
 */
export function serienSchluessel(
  e: SchluesselEingabe,
  mitZeit = false
): string {
  if (e.serie !== null && e.serie !== '') return `serie:${e.serie}`
  const teile = [normalisiereTitel(e.titel), normalisiereOrt(e.lokalitaet)]
  if (mitZeit) teile.push(startZeit(e.zeit))
  return teile.join('|').slice(0, SCHLUESSEL_MAX)
}
