import type { Monatsblatt, Tag } from '../shared/euroairport'
import { monatDeutsch, type GespeicherterMonat } from './suedanfluglauf'

// The south-approach quota as the newsroom judges it — and it judges only.
//
// Nothing in this module writes an article, and nothing in it calls a model.
// An exceeded threshold produces a PROPOSAL on the month's row; whether that
// becomes a Meldung is a person's decision, exactly as on the four desks that
// came before. That is the rule of the house and it holds for a figure that
// speaks for itself too.
//
// **The quota belongs to the airport, not to a municipality.** The source has
// no breakdown by place and there is none to be had: runway 33 is approached
// over the south, and who lies under that approach is editorial knowledge
// (`gemeinden.suedanflug`), not a column. Every sentence written from these
// figures has to keep that straight, which is why there is a check for it
// further down and not only a line in the prompt.

/** The thresholds, as the source row carries them. */
export interface Schwellen {
  /** The newsroom's own, in percent of a month. Jolanda's word: 40. */
  monatsschwelle: number
  /**
   * The runway-use agreement of 10 February 2006, over the year: above 8
   * percent the federal office looks into the causes, above 10 measures have
   * to be examined. These are the AUTHORITY's numbers, and an article that
   * uses them says whose they are.
   */
  jahresschwellen: number[]
}

export const STANDARD_SCHWELLEN: Schwellen = {
  monatsschwelle: 40,
  jahresschwellen: [8, 10]
}

function istZahl(wert: unknown): wert is number {
  return typeof wert === 'number' && Number.isFinite(wert)
}

/**
 * The thresholds out of `quellen.konfiguration`.
 *
 * They live in the row rather than in the code or the prompt, so the newsroom
 * can move its own threshold without a deploy. Anything unreadable falls back
 * to the default per FIELD rather than wholesale: a typo in one number must
 * not quietly restore the other.
 */
export function leseSchwellen(konfiguration: unknown): Schwellen {
  if (typeof konfiguration !== 'object' || konfiguration === null) {
    return STANDARD_SCHWELLEN
  }
  const roh = konfiguration as Record<string, unknown>

  const monatsschwelle = istZahl(roh['monatsschwelle'])
    ? roh['monatsschwelle']
    : STANDARD_SCHWELLEN.monatsschwelle

  const jahresRoh = roh['jahresschwellen']
  const jahresschwellen = Array.isArray(jahresRoh)
    ? jahresRoh.filter(istZahl)
    : STANDARD_SCHWELLEN.jahresschwellen

  return {
    monatsschwelle,
    jahresschwellen:
      jahresschwellen.length === 0
        ? STANDARD_SCHWELLEN.jahresschwellen
        : jahresschwellen
  }
}

/** A month the newsroom already holds, for comparison. */
export interface Nachbarmonat {
  jahr: number
  monat: number
  quote: number | null
}

/** The day with the highest share, as the facts hand it over. */
export interface Spitzentag {
  datum: string
  anfluege: number
  suedlandungen: number
  quote: number
}

export interface Bewertung {
  /** True when this month is worth a look. A proposal, never an article. */
  vorschlag: boolean
  /** German, for the row — null when there is nothing to propose. */
  begruendung: string | null
  /** Every threshold this month's figures stand above — the STATE. */
  ueberschritten: string[]
  /**
   * The thresholds this month actually CROSSED — the news.
   *
   * The distinction is measured, not tidy. The canton's south-approach year
   * has run above 10 percent every year the Schutzverband published (2022:
   * 11,48; 2023: 13,79; 2024: 13,42), so "the year is above 8 percent" is true
   * from about February onwards and a proposal built on it would fire every
   * month for ever — which is the same as never firing. What is news is the
   * month the year's figure passes the mark. The newsroom's own monthly
   * threshold is different: 43,7 percent in July is news whether or not June
   * was 41, so exceeding that one always proposes.
   */
  neuUeberschritten: string[]
  jahresAnfluege: number
  jahresSuedlandungen: number
  jahresquote: number | null
  /**
   * How many months of that year the figure above covers.
   *
   * Complete or declared: a year quota from three of twelve months is a
   * partial year, and whoever writes from it has to be able to say so.
   */
  jahresmonate: number
  vormonat: Nachbarmonat | null
  vorjahresmonat: Nachbarmonat | null
  tageUeber30: number
  tageUeber50: number
  hoechsterTag: Spitzentag | null
}

function quoteAus(teil: number, ganzes: number): number | null {
  if (ganzes === 0) return null
  return Math.round((teil / ganzes) * 1000) / 10
}

function alsDeutsch(zahl: number): string {
  return String(zahl).replace('.', ',')
}

/** A day's share as the sheet printed it, or as the two counts give it. */
function tagesquote(tag: Tag): number {
  return tag.quote ?? quoteAus(tag.suedlandungen, tag.anfluege) ?? 0
}

function nachbar(monat: GespeicherterMonat): Nachbarmonat {
  return { jahr: monat.jahr, monat: monat.monat, quote: monat.quote }
}

/**
 * What this month says, measured against the thresholds and its neighbours.
 *
 * `bestand` is every month already stored — that is what supplies the
 * year-to-date figure, the previous month and the same month a year ago. The
 * sheet being judged replaces its own stored row in that sum, so re-reading a
 * revised month does not count it twice.
 *
 * It judges; it does not write. There is no model call anywhere near it.
 */
export function bewerteMonat(
  blatt: Monatsblatt,
  bestand: readonly GespeicherterMonat[],
  schwellen: Schwellen
): Bewertung {
  const eigenesJahr = bestand.filter(
    (monat) => monat.jahr === blatt.jahr && monat.monat !== blatt.monat
  )

  const jahresAnfluege =
    blatt.anfluege +
    eigenesJahr.reduce((summe, monat) => summe + (monat.anfluege ?? 0), 0)
  const jahresSuedlandungen =
    blatt.suedlandungen +
    eigenesJahr.reduce((summe, monat) => summe + (monat.suedlandungen ?? 0), 0)
  const jahresquote = quoteAus(jahresSuedlandungen, jahresAnfluege)

  const vorherigerMonat = blatt.monat === 1 ? 12 : blatt.monat - 1
  const vorherigesJahr = blatt.monat === 1 ? blatt.jahr - 1 : blatt.jahr

  const vormonat =
    bestand.find(
      (monat) =>
        monat.jahr === vorherigesJahr && monat.monat === vorherigerMonat
    ) ?? null
  const vorjahresmonat =
    bestand.find(
      (monat) => monat.jahr === blatt.jahr - 1 && monat.monat === blatt.monat
    ) ?? null

  const tageUeber30 = blatt.tage.filter((tag) => tagesquote(tag) > 30).length
  const tageUeber50 = blatt.tage.filter((tag) => tagesquote(tag) > 50).length

  let hoechsterTag: Spitzentag | null = null
  for (const tag of blatt.tage) {
    const quote = tagesquote(tag)
    if (hoechsterTag !== null && quote <= hoechsterTag.quote) continue
    hoechsterTag = {
      datum: tag.datum,
      anfluege: tag.anfluege,
      suedlandungen: tag.suedlandungen,
      quote
    }
  }

  // The year as it stood BEFORE this month — what says whether a year
  // threshold was crossed now or was standing above it all along.
  const vorherAnfluege = jahresAnfluege - blatt.anfluege
  const vorherSued = jahresSuedlandungen - blatt.suedlandungen
  const jahresquoteVorher = quoteAus(vorherSued, vorherAnfluege)

  const ueberschritten: string[] = []
  const neuUeberschritten: string[] = []

  const monatText = `Monatsschwelle der Redaktion: ${alsDeutsch(schwellen.monatsschwelle)} Prozent`
  if (blatt.quote !== null && blatt.quote >= schwellen.monatsschwelle) {
    ueberschritten.push(monatText)
    neuUeberschritten.push(monatText)
  }

  for (const schwelle of [...schwellen.jahresschwellen].sort((a, b) => a - b)) {
    if (jahresquote === null || jahresquote < schwelle) continue
    const text = `Jahresschwelle der Pistenbenutzungsvereinbarung: ${alsDeutsch(schwelle)} Prozent`
    ueberschritten.push(text)
    // A year with no earlier month held has crossed everything it stands
    // above — there was no state to be above it before.
    if (jahresquoteVorher === null || jahresquoteVorher < schwelle) {
      neuUeberschritten.push(text)
    }
  }

  return {
    vorschlag: neuUeberschritten.length > 0,
    begruendung:
      neuUeberschritten.length === 0
        ? null
        : begruendungFuer(blatt, jahresquote, neuUeberschritten),
    ueberschritten,
    neuUeberschritten,
    jahresAnfluege,
    jahresSuedlandungen,
    jahresquote,
    jahresmonate: eigenesJahr.length + 1,
    vormonat: vormonat === null ? null : nachbar(vormonat),
    vorjahresmonat: vorjahresmonat === null ? null : nachbar(vorjahresmonat),
    tageUeber30,
    tageUeber50,
    hoechsterTag
  }
}

/** The sentence on the row — what the editor reads before deciding. */
function begruendungFuer(
  blatt: Monatsblatt,
  jahresquote: number | null,
  ueberschritten: readonly string[]
): string {
  const monatText =
    blatt.quote === null
      ? 'ohne gedruckte Quote'
      : `${alsDeutsch(blatt.quote)} Prozent`
  const jahrText =
    jahresquote === null
      ? ''
      : ` Im Jahr bisher ${alsDeutsch(jahresquote)} Prozent.`

  return (
    `${monatDeutsch(blatt.jahr, blatt.monat)}: ${monatText} der Landungen ` +
    `erfolgten ueber den Sueden.${jahrText} ` +
    `Ueberschritten: ${ueberschritten.join('; ')}.`
  )
}
