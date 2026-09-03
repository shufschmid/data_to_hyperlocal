// Reading and checking what a caller asked for — pure, so every edge case is a
// unit test rather than a curl session.
//
// The error shape is rule R6 of `wepublish-rest/1`: `code` is stable ASCII
// snake_case a program can branch on, `meldung` is German prose for a person
// and may change. The framework's own shape must never show through, which is
// why every refusal in this API goes through `fehler()`.

import { GRENZE_HOECHST, GRENZE_VORGABE } from './register'

export type FehlerCode =
  | 'ungueltige_eingabe'
  | 'nicht_berechtigt'
  | 'nicht_gefunden'
  | 'methode_nicht_erlaubt'
  | 'interner_fehler'
  | 'schnittstelle_abgeschaltet'

export interface FehlerKoerper {
  fehler: { code: FehlerCode; meldung: string }
}

export function fehler(code: FehlerCode, meldung: string): FehlerKoerper {
  return { fehler: { code, meldung } }
}

/** Either a usable value or the message explaining why it is not. */
export type Gelesen<T> = { ok: true; wert: T } | { ok: false; meldung: string }

/**
 * The three states a query parameter can be in, kept apart on purpose.
 *
 * `undefined` means nobody asked — the default applies. `null` means somebody
 * asked BADLY: Express turns `?grenze=1&grenze=2` into an array, and two
 * answers to one question is a caller's error, not something to quietly pick
 * from. Folding those two together made a repeated parameter fall back to the
 * default instead of being refused.
 */
function einWert(roh: unknown): string | null | undefined {
  if (roh === undefined) return undefined
  if (typeof roh !== 'string') return null
  return roh.trim() === '' ? undefined : roh.trim()
}

/** A bounded integer parameter should look like one — no "1e3", no "0x10". */
function ganzeZahl(wert: string): number | null {
  return /^\d+$/.test(wert) ? Number(wert) : null
}

export function leseGrenze(roh: unknown): Gelesen<number> {
  const wert = einWert(roh)
  if (wert === undefined) return { ok: true, wert: GRENZE_VORGABE }
  const schlecht = {
    ok: false as const,
    meldung: `Der Parameter «grenze» muss eine ganze Zahl zwischen 1 und ${GRENZE_HOECHST} sein.`
  }
  if (wert === null) return schlecht
  const zahl = ganzeZahl(wert)
  if (zahl === null || zahl < 1 || zahl > GRENZE_HOECHST) return schlecht
  return { ok: true, wert: zahl }
}

export function leseVersatz(roh: unknown): Gelesen<number> {
  const wert = einWert(roh)
  if (wert === undefined) return { ok: true, wert: 0 }
  const schlecht = {
    ok: false as const,
    meldung: 'Der Parameter «versatz» muss eine ganze Zahl ab 0 sein.'
  }
  if (wert === null) return schlecht
  const zahl = ganzeZahl(wert)
  if (zahl === null) return schlecht
  return { ok: true, wert: zahl }
}

/**
 * A date the caller can trust to mean the day they wrote, inclusively.
 *
 * Checked against the calendar rather than by shape alone: `2026-02-30` matches
 * the pattern and is not a day. Returned as the UTC instant of that day's
 * midnight, because `publiziert_am` is a timestamp with a zone — comparing it
 * against a bare date string would leave the boundary to the database's idea of
 * a timezone, and this API promises UTC (R12).
 */
export function leseSeit(roh: unknown): Gelesen<string | null> {
  const wert = einWert(roh)
  if (wert === undefined) return { ok: true, wert: null }

  const schlecht = {
    ok: false as const,
    meldung:
      'Der Parameter «seit» muss ein Datum der Form JJJJ-MM-TT sein, etwa 2026-09-01.'
  }
  if (wert === null) return schlecht
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wert)
  if (!treffer) return schlecht

  const [, jahr, monat, tag] = treffer as unknown as [
    string,
    string,
    string,
    string
  ]
  const instant = new Date(`${jahr}-${monat}-${tag}T00:00:00.000Z`)
  if (Number.isNaN(instant.getTime())) return schlecht
  // Round-trip check: JS accepts 2026-02-30 and rolls it to 03-02.
  if (instant.toISOString().slice(0, 10) !== `${jahr}-${monat}-${tag}`)
    return schlecht

  return { ok: true, wert: instant.toISOString() }
}

/**
 * Whether a path segment could be one of our ids at all.
 *
 * Checked BEFORE the database sees it: a non-uuid in a uuid filter makes
 * Postgres raise, which would turn a caller's typo into a 500. A malformed id
 * gets the same 404 as an unknown one — there is nothing to find either way.
 */
export function istKennung(roh: unknown): boolean {
  const wert = einWert(roh)
  if (wert === undefined || wert === null) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    wert
  )
}
