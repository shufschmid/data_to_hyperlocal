// How often an Anlass recurs — read off its dates AND its text.
//
// Both signals are needed, measured: Arlesheim's calendar SHOWS the
// repetition (one row per date), Pratteln's and Binningen's say it in words
// ("jeden Freitagnachmittag", "einmal im Monat", "jeweils am letzten
// Mittwoch") on a row that appears once. The rhythm decides ONLY what is
// routine; it never decides news value — that is the editor's, and the
// Sichtung's, after her.

import type { Rhythmus } from '../../types/schema'

export type { Rhythmus }

export interface RhythmusBefund {
  rhythmus: Rhythmus
  /** The rhythm came from words, not from the dates. */
  ausText: boolean
  /** The text says the offer runs all year — a printed end date is then not an end. */
  ganzjaehrig: boolean
  /** A date that breaks the pattern (another weekday, not the last Wednesday), or null. */
  abweichung: string | null
  /** A date the pattern expects inside the known dates and that is missing, or null. */
  fehlend: string | null
}

const WOCHENTAGE = [
  'sonntag',
  'montag',
  'dienstag',
  'mittwoch',
  'donnerstag',
  'freitag',
  'samstag'
] as const

/** 0 = Sunday … 6 = Saturday, computed in UTC so no timezone shifts the day. */
export function wochentagVon(iso: string): number {
  const [j, m, t] = iso.split('-').map(Number)
  return new Date(Date.UTC(j ?? 1970, (m ?? 1) - 1, t ?? 1)).getUTCDay()
}

function tageZwischen(a: string, b: string): number {
  const [aj, am, at] = a.split('-').map(Number)
  const [bj, bm, bt] = b.split('-').map(Number)
  return Math.round(
    (Date.UTC(bj ?? 1970, (bm ?? 1) - 1, bt ?? 1) -
      Date.UTC(aj ?? 1970, (am ?? 1) - 1, at ?? 1)) /
      86_400_000
  )
}

export function verschiebeTage(iso: string, tage: number): string {
  const [j, m, t] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(j ?? 1970, (m ?? 1) - 1, (t ?? 1) + tage))
  return d.toISOString().slice(0, 10)
}

/** Which occurrence of its weekday in its month a day is: 1 = first … and -1 = last. */
export function ordinalImMonat(iso: string): { n: number; letzter: boolean } {
  const [j, m, t] = iso.split('-').map(Number)
  const tag = t ?? 1
  const tageImMonat = new Date(Date.UTC(j ?? 1970, m ?? 1, 0)).getUTCDate()
  return { n: Math.ceil(tag / 7), letzter: tag + 7 > tageImMonat }
}

// --- words -----------------------------------------------------------------

const ORDINAL: Record<string, number> = {
  ersten: 1,
  erste: 1,
  '1.': 1,
  zweiten: 2,
  zweite: 2,
  '2.': 2,
  dritten: 3,
  dritte: 3,
  '3.': 3,
  vierten: 4,
  vierte: 4,
  '4.': 4,
  letzten: -1,
  letzte: -1
}

export interface Monatsmuster {
  /** 1–4, or -1 for "letzten". */
  ordinal: number
  /** 0 = Sunday … 6 = Saturday. */
  wochentag: number
}

const MONATSMUSTER =
  /\b(jeden|jeweils am|am|immer am)\s+(ersten|zweiten|dritten|vierten|letzten|1\.|2\.|3\.|4\.)\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)(\s+(?:im|des|pro|jeden) monats?)?/iu

/**
 * "jeweils am letzten Mittwoch (im Monat)" → the pattern a date can be
 * checked against. German is ambiguous in one spot: "jeden zweiten
 * Donnerstag" means every OTHER Thursday (fortnightly) unless "im Monat"
 * follows, while "am zweiten Donnerstag" is the month's second — so that one
 * reading is left to the weekly words.
 */
export function monatsmusterAus(text: string): Monatsmuster | null {
  const treffer = MONATSMUSTER.exec(text.normalize('NFC').toLowerCase())
  if (treffer === null) return null
  const ordinal = ORDINAL[treffer[2] ?? '']
  const wochentag = WOCHENTAGE.indexOf(
    (treffer[3] ?? '') as (typeof WOCHENTAGE)[number]
  )
  if (ordinal === undefined || wochentag < 0) return null
  if (treffer[1] === 'jeden' && ordinal === 2 && treffer[4] === undefined)
    return null
  return { ordinal, wochentag }
}

export function passtInsMonatsmuster(
  iso: string,
  muster: Monatsmuster
): boolean {
  if (wochentagVon(iso) !== muster.wochentag) return false
  const { n, letzter } = ordinalImMonat(iso)
  return muster.ordinal === -1 ? letzter : n === muster.ordinal
}

const TAEGLICH =
  /\b(?:t[äa]glich|jeden tag|jeden abend|jeden morgen|jeden nachmittag|durchgehend ge[öo]ffnet)\b/iu
const WOECHENTLICH_TEXT =
  /\bjeden\s+(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\w*|\bjeweils\s+(?:am\s+)?(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)s?\b(?!\s*,?\s*\d)|\b(?:w[öo]chentlich|jede woche|alle wochen|1x w[öo]chentlich)\b|\b(?:14-?t[äa]glich|alle (?:zwei|2|14) (?:wochen|tage)|zweiw[öo]chentlich|jede zweite woche|jeden zweiten \w+tag)\b/iu
const MONATLICH_TEXT =
  /\b(?:monatlich|einmal (?:im|pro) monat|jeden monat|1x (?:im|pro) monat)\b/iu
const JAEHRLICH_TEXT =
  /\b(?:j[äa]hrlich|allj[äa]hrlich|einmal (?:im|pro) jahr)\b/iu
const GANZJAEHRIG =
  /\bdas ganze jahr (?:[üu]ber|hindurch)\b|\bganzj[äa]hrig\b|\bdurchgehend\b/iu

function rhythmusAusText(text: string): Rhythmus | null {
  const t = text.normalize('NFC').toLowerCase()
  if (MONATLICH_TEXT.test(t) || monatsmusterAus(t) !== null) return 'monatlich'
  if (WOECHENTLICH_TEXT.test(t)) return 'woechentlich'
  if (TAEGLICH.test(t)) return 'laufend'
  if (JAEHRLICH_TEXT.test(t)) return 'seltener'
  return null
}

// --- dates -----------------------------------------------------------------

/** A multi-day one-off (a two-day fair) is still one event, not a running span. */
const KURZE_SPANNE_TAGE = 3
/** A series the site dates back further than this with one date in view is "seltener", not "einmalig". */
const ALTE_SERIE_TAGE = 90

function haeufigster(werte: readonly number[]): number {
  const zaehler = new Map<number, number>()
  for (const w of werte) zaehler.set(w, (zaehler.get(w) ?? 0) + 1)
  let best = werte[0] ?? 0
  let bestN = 0
  for (const [w, n] of zaehler)
    if (n > bestN) {
      best = w
      bestN = n
    }
  return best
}

function rhythmusAusDaten(
  termine: readonly string[],
  spanne: boolean,
  serieSeit: string | null
): { rhythmus: Rhythmus; abweichung: string | null; fehlend: string | null } {
  const n = termine.length
  if (n === 0) return { rhythmus: 'unbekannt', abweichung: null, fehlend: null }
  const von = termine[0] ?? ''
  const bis = termine[n - 1] ?? von

  if (spanne) {
    const laenge = tageZwischen(von, bis)
    return {
      rhythmus: laenge <= KURZE_SPANNE_TAGE ? 'einmalig' : 'laufend',
      abweichung: null,
      fehlend: null
    }
  }
  if (n === 1) {
    const alt =
      serieSeit !== null && tageZwischen(serieSeit, von) > ALTE_SERIE_TAGE
    return {
      rhythmus: alt ? 'seltener' : 'einmalig',
      abweichung: null,
      fehlend: null
    }
  }

  const abstaende: number[] = []
  for (let i = 1; i < n; i += 1)
    abstaende.push(tageZwischen(termine[i - 1] ?? '', termine[i] ?? ''))

  // Ein laufendes Angebot, das EINEN Wochentag geschlossen hat, ist immer noch
  // ein laufendes Angebot. Gemessen am ersten Lauf (20.09.2026): Arlesheim
  // druckt die Ausstellung «HAP Grieshaber» als eine Zeile je Oeffnungstag,
  // 52 Tage lang, montags zu — lauter Abstaende von 1 mit jedem siebten auf 2.
  // Die strenge Fassung («jeder Abstand ist 1») liess sie bis unten
  // durchfallen und nannte sie „seltener": eine Ausstellung waere so zur
  // gelegentlichen Erinnerung geworden statt zu dem, was sie ist — und ihr
  // letzter Tag waere nie als letzte Gelegenheit erkannt worden, die Regel,
  // auf der die Redaktion ausdruecklich besteht.
  const dicht = abstaende.every((a) => a <= 2) && abstaende.some((a) => a === 1)
  if (dicht) {
    return {
      rhythmus:
        tageZwischen(von, bis) <= KURZE_SPANNE_TAGE ? 'einmalig' : 'laufend',
      abweichung: null,
      fehlend: null
    }
  }

  // Monthly before weekly: every four weeks IS monthly (Münchenstein's
  // Värsli-Zyt, 28 days apart, is the third Tuesday of the month), while a
  // mix of 14s with one 28 is a fortnightly group that skipped once.
  if (abstaende.every((a) => a >= 20 && a <= 40)) {
    return {
      rhythmus: 'monatlich',
      abweichung: monatsAbweichung(termine),
      fehlend: null
    }
  }
  // Weekly with one outlier allowed: a date moved to another weekday is
  // exactly the deviation the newsroom wants named, not a reason to call
  // the whole series irregular.
  const imTakt = abstaende.filter((a) => a % 7 === 0 && a <= 28)
  if (n >= 3 && imTakt.length >= 2 && imTakt.length >= abstaende.length - 1) {
    const takt = haeufigster(imTakt)
    return {
      rhythmus: 'woechentlich',
      abweichung: wochentagAbweichung(termine),
      fehlend: fehlenderTermin(termine, abstaende, takt)
    }
  }
  return { rhythmus: 'seltener', abweichung: null, fehlend: null }
}

/** Among weekly dates, one on another weekday than the rest. */
function wochentagAbweichung(termine: readonly string[]): string | null {
  const tage = termine.map(wochentagVon)
  const ueblich = haeufigster(tage)
  const abweichler = termine.filter((t) => wochentagVon(t) !== ueblich)
  return abweichler.length === 1 ? (abweichler[0] ?? null) : null
}

/** Among monthly dates, one whose weekday-ordinal differs from the rest ("last Wednesday" on the third). */
function monatsAbweichung(termine: readonly string[]): string | null {
  if (termine.length < 3) return null
  const muster = termine.map((t) => {
    const { n, letzter } = ordinalImMonat(t)
    return `${wochentagVon(t)}:${letzter ? 'l' : n}`
  })
  const zaehler = new Map<string, number>()
  for (const m of muster) zaehler.set(m, (zaehler.get(m) ?? 0) + 1)
  let ueblich = ''
  let ueblichN = 0
  for (const [m, n] of zaehler)
    if (n > ueblichN) {
      ueblich = m
      ueblichN = n
    }
  if (ueblichN < termine.length - 1) return null
  const index = muster.findIndex((m) => m !== ueblich)
  return index === -1 ? null : (termine[index] ?? null)
}

/** In a weekly series, a gap of exactly two beats where the rest are one: the missed date. */
function fehlenderTermin(
  termine: readonly string[],
  abstaende: readonly number[],
  takt: number
): string | null {
  if (takt !== 7 && takt !== 14) return null
  const index = abstaende.findIndex((a) => a === takt * 2)
  if (index === -1) return null
  return verschiebeTage(termine[index] ?? '', takt)
}

export interface RhythmusEingabe {
  termine: readonly string[]
  /** Teaser plus description — where the words are. */
  text: string
  spanne?: boolean
  serieSeit?: string | null
}

/**
 * Text first, dates second: a list shows only its window, and "jeden Freitag"
 * with one Friday in view is weekly all the same. A text pattern of the
 * "last Wednesday" kind is then checked against every date, so the one month
 * that deviates is named — that deviation is what the newsroom wants to hear
 * about.
 */
export function erkenneRhythmus(e: RhythmusEingabe): RhythmusBefund {
  const ganzjaehrig = GANZJAEHRIG.test(e.text.normalize('NFC').toLowerCase())
  const ausDaten = rhythmusAusDaten(
    e.termine,
    e.spanne ?? false,
    e.serieSeit ?? null
  )
  const ausText = rhythmusAusText(e.text)
  if (ausText === null) return { ...ausDaten, ausText: false, ganzjaehrig }

  let abweichung = ausDaten.abweichung
  const muster = monatsmusterAus(e.text)
  if (muster !== null) {
    const abweichler = e.termine.filter((t) => !passtInsMonatsmuster(t, muster))
    abweichung = abweichler.length === 1 ? (abweichler[0] ?? null) : abweichung
  }
  // A span the text calls weekly is a weekly group with a season, not an
  // exhibition — the text wins; the dates keep their deviation findings.
  return {
    rhythmus: ausText,
    ausText: true,
    ganzjaehrig,
    abweichung:
      ausText === ausDaten.rhythmus || muster !== null ? abweichung : null,
    fehlend: ausText === ausDaten.rhythmus ? ausDaten.fehlend : null
  }
}
