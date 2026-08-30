// Grouping and formatting for the Entsorgung tab.
//
// Pure functions, kept apart from the components for the usual reason in this
// codebase: the arithmetic is what can be wrong, and it is what a test can
// reach. All of it works on `YYYY-MM-DD` strings — Directus hands date columns
// back as plain strings, and parsing one as a local instant shifts it by a day
// for anyone east of UTC, which is everyone here.

import type {
  AlleMeldungFelder,
  EntsorgungskalenderFelder,
  EntsorgungsterminFelder,
  GemeindeFelder
} from '@/graphql/redaktion'

const MONATE = [
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
] as const

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] as const

/** "Mittwoch, 7. Januar 2026" — the same form the reminder texts use. */
export function langesDatum(iso: string | null): string {
  if (iso === null) return '—'
  const teile = iso.slice(0, 10).split('-').map(Number)
  const [jahr, monat, tag] = teile
  if (jahr === undefined || monat === undefined || tag === undefined) return '—'

  const wochentag = WOCHENTAGE[new Date(Date.UTC(jahr, monat - 1, tag)).getUTCDay()] ?? ''
  return `${wochentag}, ${tag}. ${MONATE[monat - 1] ?? ''} ${jahr}`
}

/** "Mi 07.01." — the compact form for a dense list. */
export function kurzesDatum(iso: string | null): string {
  if (iso === null) return '—'
  const teile = iso.slice(0, 10).split('-').map(Number)
  const [jahr, monat, tag] = teile
  if (jahr === undefined || monat === undefined || tag === undefined) return '—'

  const wochentag = WOCHENTAGE[new Date(Date.UTC(jahr, monat - 1, tag)).getUTCDay()] ?? ''
  return `${wochentag.slice(0, 2)} ${String(tag).padStart(2, '0')}.${String(monat).padStart(2, '0')}.`
}

export interface Monatsgruppe<T> {
  /** "Januar 2026" — the heading. */
  monat: string
  eintraege: T[]
}

/**
 * Groups dated rows by month, chronologically.
 *
 * A year of collection dates is a hundred rows, and an undivided hundred-row
 * list is something nobody scans. The month is the unit an editor thinks in
 * when checking a calendar against the printed one.
 */
export function nachMonat<T>(
  eintraege: readonly T[],
  datumVon: (eintrag: T) => string | null
): Monatsgruppe<T>[] {
  const gruppen = new Map<string, T[]>()

  for (const eintrag of eintraege) {
    const datum = datumVon(eintrag)
    if (datum === null) continue
    const schluessel = datum.slice(0, 7)
    const bisher = gruppen.get(schluessel)
    if (bisher === undefined) gruppen.set(schluessel, [eintrag])
    else bisher.push(eintrag)
  }

  return [...gruppen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([schluessel, liste]) => {
      const monat = Number(schluessel.slice(5, 7))
      return {
        monat: `${MONATE[monat - 1] ?? schluessel} ${schluessel.slice(0, 4)}`,
        eintraege: liste
      }
    })
}

/** The collection dates of one calendar, by month. */
export function termineNachMonat(
  termine: readonly EntsorgungsterminFelder[]
): Monatsgruppe<EntsorgungsterminFelder>[] {
  return nachMonat(termine, (termin) => termin.datum)
}

/** Only the waste-collection reminders, by the month they appear in. */
export function erinnerungenNachMonat(
  meldungen: readonly AlleMeldungFelder[]
): Monatsgruppe<AlleMeldungFelder>[] {
  const erinnerungen = meldungen.filter((meldung) => meldung.erscheint_am !== null)
  return nachMonat(erinnerungen, (meldung) => meldung.erscheint_am)
}

/** Reminders of one municipality, newest first — what one calendar produced. */
export function erinnerungenZuGemeinde(
  meldungen: readonly AlleMeldungFelder[],
  gemeindeId: string | null
): AlleMeldungFelder[] {
  if (gemeindeId === null) return []
  return meldungen.filter((meldung) => meldung.erscheint_am !== null && meldung.gemeinde?.id === gemeindeId)
}

/**
 * Active municipalities with no calendar for the current year.
 *
 * Shown in January only, and that restriction is the point: a municipality
 * without next year's calendar in June is normal — the PDF does not exist yet —
 * while the same gap in January means reminders are silently not being written.
 * A banner that cried all year would be ignored by the time it mattered.
 */
export function fehlendeKalender(
  gemeinden: readonly GemeindeFelder[],
  kalender: readonly EntsorgungskalenderFelder[],
  heute: Date
): GemeindeFelder[] {
  if (heute.getMonth() !== 0) return []

  const jahr = heute.getFullYear()
  const vorhanden = new Set(
    kalender
      .filter((eintrag) => eintrag.jahr === jahr && eintrag.gemeinde !== null)
      .map((eintrag) => eintrag.gemeinde?.id)
  )

  return gemeinden
    .filter((gemeinde) => gemeinde.aktiv && !vorhanden.has(gemeinde.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
}

/**
 * Approved-state watchdog: drafts whose newsletter day is close.
 *
 * The scheduled publisher only ever takes `freigegeben` rows, so a reminder
 * left as a draft simply never appears — no error, no trace. This is what makes
 * that visible while there is still time to approve it.
 */
export function faelligUnfreigegeben(
  meldungen: readonly AlleMeldungFelder[],
  heute: Date,
  tage = 7
): AlleMeldungFelder[] {
  const grenze = new Date(heute.getTime() + tage * 86_400_000).toISOString().slice(0, 10)
  const heuteIso = heute.toISOString().slice(0, 10)

  return meldungen
    .filter(
      (meldung) =>
        meldung.erscheint_am !== null &&
        meldung.status === 'entwurf' &&
        meldung.erscheint_am >= heuteIso &&
        meldung.erscheint_am <= grenze
    )
    .sort((a, b) => (a.erscheint_am ?? '').localeCompare(b.erscheint_am ?? ''))
}

/**
 * The deadline's time for display: "11.30 Uhr" for a clock time, the word
 * itself ("Vormittag") where the printed calendar names no clock time.
 */
export function fristZeitText(zeit: string): string {
  return /^\d/.test(zeit) ? `${zeit.replace(':', '.')} Uhr` : zeit
}

const KALENDER_STATUS: Record<string, string> = {
  hochgeladen: 'Hochgeladen',
  liest: 'Wird ausgelesen',
  extrahiert: 'Ausgelesen',
  geprueft: 'Geprüft',
  fehler: 'Fehler'
}

export function kalenderStatusText(status: string): string {
  return KALENDER_STATUS[status] ?? status
}

export function kalenderStatusFarbe(status: string): 'default' | 'info' | 'success' | 'error' {
  switch (status) {
    case 'liest':
    case 'extrahiert':
      return 'info'
    case 'geprueft':
      return 'success'
    case 'fehler':
      return 'error'
    default:
      return 'default'
  }
}

/** The year a newly registered calendar most likely refers to. */
export function vorgeschlagenesJahr(heute: Date): number {
  // From October the municipalities publish the coming year's calendar, and
  // that is the one an editor is holding.
  return heute.getMonth() >= 9 ? heute.getFullYear() + 1 : heute.getFullYear()
}

export interface ErinnerungsAuswahl<T> {
  /** The ones an editor should look at now — soonest first. */
  naechste: T[]
  /** Everything else, kept but folded away. */
  weitere: T[]
}

/**
 * The next reminders due, and the rest.
 *
 * A confirmed calendar produces a year of reminders in one go — 72 of them in
 * the first municipalities. Listing all of them buries the two that actually
 * need a decision this week, and in the municipality blog it buries the
 * journalism as well. So the view shows what is next and folds the rest away;
 * nothing is dropped, because a year is exactly what the editor asked the
 * calendar to produce.
 *
 * Already published or discarded reminders are not pending: they never count
 * as "next", whatever their date.
 */
export function naechsteErinnerungen<T extends { erscheint_am: string | null; status: string }>(
  meldungen: readonly T[],
  heute: Date,
  anzahl = 2
): ErinnerungsAuswahl<T> {
  const heuteIso = heute.toISOString().slice(0, 10)

  const offen = meldungen
    .filter((m) => m.erscheint_am !== null && (m.status === 'entwurf' || m.status === 'freigegeben'))
    .sort((a, b) => (a.erscheint_am ?? '').localeCompare(b.erscheint_am ?? ''))

  // A reminder whose day has passed is not "next" — it is a miss, and the
  // scheduled run records it as one. It belongs to the folded rest.
  const kommend = offen.filter((m) => (m.erscheint_am ?? '') >= heuteIso)
  const naechste = kommend.slice(0, Math.max(anzahl, 0))
  const gewaehlt = new Set(naechste)

  return {
    naechste,
    weitere: meldungen.filter((m) => !gewaehlt.has(m))
  }
}

/**
 * A municipality blog without the flood of pending reminders.
 *
 * The blog is meant to read like a blog: what was written for this place,
 * newest first. A confirmed calendar drops a year of reminders into it at once
 * — all created on the same day, so all of them sort to the top and push the
 * journalism out of sight. Published reminders stay exactly where they belong;
 * only the ones still waiting are thinned to the next few, and the count of
 * what was folded away is returned so the view can say so.
 */
export function blogOhneErinnerungsflut<T extends { erscheint_am: string | null; status: string }>(
  beitraege: readonly T[],
  heute: Date,
  anzahl = 2
): { sichtbar: T[]; versteckt: number } {
  const ausstehend = new Set(
    beitraege.filter((b) => b.erscheint_am !== null && (b.status === 'entwurf' || b.status === 'freigegeben'))
  )
  if (ausstehend.size === 0) return { sichtbar: [...beitraege], versteckt: 0 }

  const { naechste } = naechsteErinnerungen([...ausstehend], heute, anzahl)
  const behalten = new Set(naechste)

  return {
    sichtbar: beitraege.filter((b) => !ausstehend.has(b) || behalten.has(b)),
    versteckt: ausstehend.size - behalten.size
  }
}
