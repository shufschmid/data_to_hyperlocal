// When a reminder may appear — the newsletter's calendar, as arithmetic.
//
// An Entsorgungsmeldung is worthless one day late and wrong one day early, so
// the day it appears is not a preference but a computed fact: the last day the
// newsletter goes out before the thing happens. Everything below exists to make
// that one decision reproducible.
//
// Two rules from the newsroom shape it. The newsletter appears Monday to Friday
// and never on a public holiday — and the holidays that count are **Basel-Stadt's**,
// for every municipality, because that is where the newsletter is made. And the
// anchor is not always the collection: the Häckseldienst is booked days ahead,
// so the reminder has to beat the registration deadline, not the truck.
//
// Everything works on plain `YYYY-MM-DD` strings via `Date.UTC`. Directus hands
// date columns back as strings, and `new Date('2026-01-07')` parses as UTC
// midnight while `new Date(2026, 0, 7)` is local — mixing the two shifts dates
// by a day around the DST boundary. Staying in UTC for date-only values keeps
// the arithmetic honest regardless of the process timezone.

/** Days in the Gregorian epoch — the unit all arithmetic here runs in. */
function zuTagen(iso: string): number {
  const [jahr, monat, tag] = iso.split('-').map(Number)
  if (jahr === undefined || monat === undefined || tag === undefined) {
    throw new Error(`Kein ISO-Datum: "${iso}"`)
  }
  return Date.UTC(jahr, monat - 1, tag) / 86_400_000
}

function zuIso(tage: number): string {
  return new Date(tage * 86_400_000).toISOString().slice(0, 10)
}

export function verschiebe(iso: string, tage: number): string {
  return zuIso(zuTagen(iso) + tage)
}

/** 0 = Sunday … 6 = Saturday, matching `Date.getUTCDay()`. */
export function wochentag(iso: string): number {
  return new Date(zuTagen(iso) * 86_400_000).getUTCDay()
}

/**
 * Easter Sunday, by the anonymous Gregorian computus.
 *
 * Four of the eight Basel-Stadt holidays move with Easter, so there is no list
 * to maintain — only this. The algorithm is exact for every Gregorian year; the
 * test pins it against published dates rather than trusting the transcription.
 */
export function osterdatum(jahr: number): string {
  const a = jahr % 19
  const b = Math.floor(jahr / 100)
  const c = jahr % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const monat = Math.floor((h + l - 7 * m + 114) / 31)
  const tag = ((h + l - 7 * m + 114) % 31) + 1

  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
}

/** Fixed-date public holidays in Basel-Stadt, as `MM-DD`. */
const FESTE_FEIERTAGE: readonly string[] = [
  '01-01', // Neujahr
  '05-01', // Tag der Arbeit
  '08-01', // Bundesfeier
  '12-25', // Weihnachten
  '12-26' // Stephanstag
]

/** Offsets from Easter Sunday for the movable ones. */
const BEWEGLICHE_FEIERTAGE: readonly number[] = [
  -2, // Karfreitag
  1, // Ostermontag
  39, // Auffahrt
  50 // Pfingstmontag
]

/**
 * A public holiday in Basel-Stadt.
 *
 * Deliberately the Basel-Stadt set for every municipality, including the
 * Basel-Landschaft ones: the newsletter is produced in Basel, so it is Basel's
 * working days that decide whether an edition exists at all. A municipal
 * holiday elsewhere changes nothing about that.
 */
export function istBsFeiertag(iso: string): boolean {
  if (FESTE_FEIERTAGE.includes(iso.slice(5))) return true

  const jahr = Number(iso.slice(0, 4))
  const ostern = osterdatum(jahr)
  return BEWEGLICHE_FEIERTAGE.some(
    (abstand) => verschiebe(ostern, abstand) === iso
  )
}

/** A day the newsletter goes out: a weekday that is not a Basel holiday. */
export function istNewsletterTag(iso: string): boolean {
  const tag = wochentag(iso)
  if (tag === 0 || tag === 6) return false
  return !istBsFeiertag(iso)
}

/**
 * By when the newsletter has reached its readers.
 *
 * It goes out early and is read over the morning; by ten the edition has done
 * its work. That single fact is what decides whether a reminder can appear on
 * the day something is due, or has to come the day before.
 */
export const LESEZEIT = '10:00'

/**
 * Times of day a calendar names instead of a clock time, each ending after the
 * newsletter has been read. "Anmeldung bis Montagvormittag" closes at noon, so
 * Monday's edition still gets the reader there — the same rule as an explicit
 * "11.30 Uhr". Morning words ("morgens", "früh") are deliberately absent: they
 * end around reading time, and the safe answer there is the day before.
 */
const TAGESZEITEN_NACH_LESEZEIT = new Set([
  'Vormittag',
  'Mittag',
  'Nachmittag',
  'Abend'
])

/** Whether a deadline given as `HH:MM` or as a time-of-day word still leaves
 *  room after the edition is read. */
export function fristNachLesezeit(uhrzeit: string): boolean {
  if (TAGESZEITEN_NACH_LESEZEIT.has(uhrzeit)) return true
  return /^\d/.test(uhrzeit) && uhrzeit > LESEZEIT
}

/**
 * The last newsletter day strictly before `anker`.
 *
 * A long bridge is handled by the loop rather than by cases: Easter has four
 * closed days in a row, so something due on Easter Tuesday is announced on
 * Maundy Thursday. The bound of 14 days guards against a broken holiday table,
 * not a real run of closed days.
 */
function letzterNewsletterTagVor(anker: string): string {
  let kandidat = verschiebe(anker, -1)

  for (let versuch = 0; versuch < 14; versuch += 1) {
    if (istNewsletterTag(kandidat)) return kandidat
    kandidat = verschiebe(kandidat, -1)
  }

  throw new Error(`Kein Newsletter-Tag vor ${anker} gefunden.`)
}

/**
 * The day a reminder has to appear, given when the thing is actually due.
 *
 * Two cases, and telling them apart is the whole job — they look identical as
 * dates and are opposite as advice.
 *
 * **The deadline falls late in the day**: registering for the Häckseldienst
 * runs until 11.30, and the edition has been read by ten. So the reminder
 * belongs in *that morning's* newsletter — "heute bis 11.30 anmelden" is the
 * version a reader can act on. Putting it three days earlier, as a strictly-
 * before rule would, turns a call to action into a note to self.
 *
 * **The deadline falls early, or there is none**: the paper has to be on the
 * pavement by seven, which is before anyone has read anything. The same day is
 * already lost, so the reminder goes out the day before — which is also when
 * the reader can act on it, since the material may go out from six the evening
 * before.
 *
 * `uhrzeit` is `HH:MM`, a time-of-day word ("Vormittag" — a calendar that says
 * "bis Montagvormittag" names no clock time but still closes at noon), or null.
 * Null means "treat it as early", the safe side: a reminder one day early is a
 * weaker reminder, a reminder one day late is no reminder at all.
 */
export function erscheinungstag(
  anker: string,
  uhrzeit: string | null = null
): string {
  if (
    uhrzeit !== null &&
    fristNachLesezeit(uhrzeit) &&
    istNewsletterTag(anker)
  ) {
    return anker
  }

  return letzterNewsletterTagVor(anker)
}

/** Today in Swiss wall-clock time, as `YYYY-MM-DD`. */
export function heuteIso(jetzt: Date = new Date()): string {
  return jetzt.toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' })
}

/**
 * Tomorrow, Swiss wall-clock.
 *
 * The scheduled publisher runs on this: the Dorfkönig composes the newsletter
 * the evening before it goes out, so a reminder for Friday has to be published
 * on Thursday. `sv-SE` is a formatting trick, not a locale choice — it is the
 * one built-in locale that already prints ISO order.
 */
export function morgenIso(jetzt: Date = new Date()): string {
  return verschiebe(heuteIso(jetzt), 1)
}
