// The consumer's bookmark — what lets `/v1/artikel` hand out only what a
// consumer has not confirmed yet. Pure, so every rule is a unit test.
//
// Why it exists: the Dorfkönig generated duplicate entries (measured 23
// September 2026). Reading "everything since yesterday" with `?seit=` is
// inclusive on a DAY, so an article published at 09:00 comes back on every
// call that day, and it is the consumer's job to remember what it already
// has. That job now sits here: the consumer tells this API where it got to
// — the STAND of the last article it stored — and from then on the list
// starts behind that article. The newsroom's words: the Dorfkönig says when
// it last fetched successfully, and we offer only what came in since.
//
// The Stand is copied, never built. It names the last article of a page —
// `<publiziert_am>|<id>` — so a person can read which one it was, and so the
// consumer is never tempted to send its own clock: an article published
// between its fetch and its confirmation would fall through.
//
// The list continues strictly AFTER THE INSTANT of the Stand. Two articles
// can share a `publiziert_am` to the millisecond („Alle publizieren" writes
// them seconds apart, but a tie is possible), and a page boundary between
// two such rows would either repeat one or lose one. The classic answer is a
// keyset on `(publiziert_am, id)` — and Directus refuses it: `_gt` is not
// among the operators it allows on a uuid field, and the refusal escaped as
// a crash of the whole process (measured 23 September 2026). So the pair is
// kept whole a different way: a page is CUT so that a group of articles
// sharing one instant never straddles a boundary (`schneideSeite`). A page
// may therefore be a row or two shorter than `grenze`, or — when one instant
// holds more rows than `grenze` — longer; `anzahl` says which, `weitere`
// stays truthful, and no row is ever repeated or skipped.
//
// Millisecond equality is safe here because every writer of `publiziert_am`
// is JavaScript (`new Date().toISOString()` in the status hook, the noon
// Flow, the bulk publish) — Postgres stores what it was given, and a JS
// instant has no microseconds. Checked on the live rows before this shipped.

import type { Gelesen } from './parameter'

/** Where a consumer got to: the last article it confirmed. */
export interface Stand {
  /** ISO instant, millisecond precision, as `publiziert_am` is delivered. */
  publiziert_am: string
  id: string
}

/** The row of the `abnehmer` collection, as the endpoint reads it. */
export interface AbnehmerZeile {
  kennung: string
  abgeholt_bis: string | null
  abgeholt_id: string | null
  abgeholt_am: string | null
}

/**
 * A consumer's name as it appears in the path and the query: short, lower
 * case, ASCII — a key into one row, never free text. The Dorfkönig is
 * `dorfkoenig`.
 */
const KENNUNG = /^[a-z0-9][a-z0-9-]{1,39}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TRENNER = '|'

export function istAbnehmerKennung(roh: unknown): roh is string {
  return typeof roh === 'string' && KENNUNG.test(roh)
}

/**
 * The `abnehmer` query parameter: absent means the plain list, a bad value
 * is refused rather than ignored — a consumer that misspells its own name
 * would otherwise get everything, every time, and never know.
 */
export function leseAbnehmer(roh: unknown): Gelesen<string | null> {
  if (roh === undefined) return { ok: true, wert: null }
  const schlecht = {
    ok: false as const,
    meldung:
      'Der Parameter «abnehmer» muss eine Kennung aus Kleinbuchstaben, Ziffern und Bindestrichen sein (2 bis 40 Zeichen), etwa «dorfkoenig».'
  }
  if (typeof roh !== 'string') return schlecht
  const wert = roh.trim()
  if (wert === '') return { ok: true, wert: null }
  if (!KENNUNG.test(wert)) return schlecht
  return { ok: true, wert }
}

/** The Stand of an article, as the list hands it out: `<publiziert_am>|<id>`. */
export function baueStand(zeile: {
  publiziert_am: string | null
  id: string
}): string | null {
  if (zeile.publiziert_am === null) return null
  return `${normalisiereInstant(zeile.publiziert_am) ?? zeile.publiziert_am}${TRENNER}${zeile.id}`
}

/** Both halves of a stored bookmark back into the wire form, or null when none is stored. */
export function standVon(zeile: AbnehmerZeile | null): string | null {
  if (
    zeile === null ||
    zeile.abgeholt_bis === null ||
    zeile.abgeholt_id === null
  )
    return null
  return baueStand({ publiziert_am: zeile.abgeholt_bis, id: zeile.abgeholt_id })
}

/**
 * A Stand as the consumer sends it back. Checked for shape only — an instant
 * and a uuid — not for existence: the article behind it may have been
 * retracted since it was delivered, and a retraction must not make the
 * confirmation fail.
 */
export function leseStand(roh: unknown): Gelesen<Stand> {
  const schlecht = {
    ok: false as const,
    meldung:
      'Der Stand muss die Form «<publiziert_am>|<id>» haben — genau so, wie ihn die Liste unter «abholung.stand» geliefert hat.'
  }
  if (typeof roh !== 'string') return schlecht
  const teile = roh.trim().split(TRENNER)
  if (teile.length !== 2) return schlecht
  const [instantRoh, idRoh] = teile as [string, string]
  const instant = normalisiereInstant(instantRoh)
  const id = idRoh.toLowerCase()
  if (instant === null || !UUID.test(id)) return schlecht
  return { ok: true, wert: { publiziert_am: instant, id } }
}

/**
 * An instant in the one form the filter compares against: UTC, milliseconds.
 * Postgres answers a timestamp in whatever form the driver renders; the
 * comparison has to be on the same string either way.
 */
function normalisiereInstant(roh: string): string | null {
  if (roh.trim() === '') return null
  const zeit = new Date(roh)
  if (Number.isNaN(zeit.getTime())) return null
  return zeit.toISOString()
}

/**
 * The cursor condition, as a Directus filter: strictly after the instant of
 * the Stand. The id is NOT part of it — see the header — which is why the
 * page has to be cut along whole instants (`schneideSeite`). The caller
 * merges it into its own `status = publiziert` condition.
 */
export function standFilter(stand: Stand): { publiziert_am: { _gt: string } } {
  return { publiziert_am: { _gt: stand.publiziert_am } }
}

/**
 * A page of `grenze + 1` rows, cut so that no group of rows sharing one
 * instant is split by the boundary.
 *
 * Three outcomes. Fewer rows than asked: the page is the end, as it is. The
 * extra row starts a new instant: the page is the first `grenze` rows, the
 * extra one falls off. The extra row CONTINUES the instant of the last kept
 * row: the whole group is held back to the next page — unless the group
 * begins at the very top, in which case the page IS that group and the
 * caller has to fetch it whole (`ganzeGruppe`), because holding it back
 * would hold it back for ever.
 */
export function schneideSeite<T extends { publiziert_am: string | null }>(
  zeilen: readonly T[],
  grenze: number
): { seite: T[]; ganzeGruppe: string | null } {
  if (zeilen.length <= grenze) return { seite: [...zeilen], ganzeGruppe: null }
  const extra = zeilen[grenze]
  const letzte = zeilen[grenze - 1]
  if (
    extra === undefined ||
    letzte === undefined ||
    extra.publiziert_am !== letzte.publiziert_am
  )
    return { seite: zeilen.slice(0, grenze), ganzeGruppe: null }
  const instant = letzte.publiziert_am
  const anfang = zeilen.findIndex((z) => z.publiziert_am === instant)
  if (anfang <= 0) return { seite: [], ganzeGruppe: instant }
  return { seite: zeilen.slice(0, anfang), ganzeGruppe: null }
}

/** The block a list carries when a consumer asked with `?abnehmer=`. */
export interface Abholung {
  abnehmer: string
  /** The Stand the consumer had confirmed before this call — null on first contact. */
  bisher: string | null
  /** The Stand to confirm once THIS page is stored — null when the page is empty. */
  stand: string | null
}

export function abholungVon(
  kennung: string,
  bisher: AbnehmerZeile | null,
  seite: readonly { publiziert_am: string | null; id: string }[]
): Abholung {
  const letzte = seite[seite.length - 1]
  return {
    abnehmer: kennung,
    bisher: standVon(bisher),
    stand: letzte === undefined ? null : baueStand(letzte)
  }
}

/** The body of `GET /v1/abnehmer/:kennung` and of a successful confirmation. */
export interface AbnehmerStand {
  abnehmer: string
  stand: string | null
  abgeholt_bis: string | null
  abgeholt_am: string | null
  /** How many published articles lie behind the Stand — what the next list would offer. */
  offen: number
}

export function abnehmerStand(
  kennung: string,
  zeile: AbnehmerZeile | null,
  offen: number
): AbnehmerStand {
  return {
    abnehmer: kennung,
    stand: standVon(zeile),
    abgeholt_bis: zeile?.abgeholt_bis ?? null,
    abgeholt_am: zeile?.abgeholt_am ?? null,
    offen
  }
}

/** The stored half of a confirmation: what `speichereAbnehmer` writes. */
export function zeileAus(
  kennung: string,
  stand: Stand,
  jetzt: string
): AbnehmerZeile {
  return {
    kennung,
    abgeholt_bis: stand.publiziert_am,
    abgeholt_id: stand.id,
    abgeholt_am: jetzt
  }
}
