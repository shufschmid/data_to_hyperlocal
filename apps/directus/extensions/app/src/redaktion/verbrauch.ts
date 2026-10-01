// The newsroom's own cost view: what every call to the model cost, by desk.
//
// Asked for on 30 September 2026, after a day of guessing which desk spends
// what — the answer is a table, not an estimate, and it comes from the usage
// block the API returns with every answer (`shared/claude.ts` records it,
// `hooks/modellverbrauch` stores it in `modellaufrufe`). Since 1 October
// 2026 the tokens are priced too (`modellpreise`, one row per model, seeded
// from the Anthropic price list and maintained by the newsroom), and each
// purpose reports the budget it went out with against the largest answer it
// got — the number to look at before lowering a budget.

import type { Modellaufruf, Modellpreis } from '../types/schema'

export type VerbrauchsZeile = Pick<
  Modellaufruf,
  | 'tisch'
  | 'zweck'
  | 'modell'
  | 'eingabe_tokens'
  | 'ausgabe_tokens'
  | 'cache_gelesen_tokens'
  | 'cache_geschrieben_tokens'
  | 'abgebrochen'
  | 'fehler'
> & { max_tokens?: number | null }

export type Preis = Pick<
  Modellpreis,
  | 'modell'
  | 'eingabe_je_mio'
  | 'ausgabe_je_mio'
  | 'cache_lesen_je_mio'
  | 'cache_schreiben_je_mio'
  | 'waehrung'
>

export interface VerbrauchsSumme {
  aufrufe: number
  eingabe_tokens: number
  ausgabe_tokens: number
  cache_gelesen_tokens: number
  cache_geschrieben_tokens: number
  /** Answers that hit `max_tokens` — paid for and thrown away. */
  abgebrochen: number
  /** Calls the API refused or that never completed. */
  fehler: number
  /** What the priced calls cost; calls of a model without a price are counted in `ohne_preis`. */
  kosten: number
  ohne_preis: number
}

export interface VerbrauchJeZweck extends VerbrauchsSumme {
  zweck: string
  /** The model of the last call of this purpose — what a setting would replace. */
  modell_zuletzt: string | null
  /** The budget of the last call, and the largest answer seen — the pair that says whether a budget is tight. */
  max_tokens_zuletzt: number | null
  ausgabe_max: number
}

export interface VerbrauchJeTisch extends VerbrauchsSumme {
  tisch: string
  /** The same numbers split by model, because Opus and Haiku do not cost the same. */
  modelle: Array<VerbrauchsSumme & { modell: string }>
  /** Every purpose of this desk, most expensive first. */
  zwecke: VerbrauchJeZweck[]
}

export interface VerbrauchsBilanz {
  tage: number
  /** The currency of the price rows; null without prices. */
  waehrung: string | null
  gesamt: VerbrauchsSumme
  tische: VerbrauchJeTisch[]
  /** Models that occurred without a price row — their calls carry no cost. */
  ohnePreis: string[]
}

const LEER = (): VerbrauchsSumme => ({
  aufrufe: 0,
  eingabe_tokens: 0,
  ausgabe_tokens: 0,
  cache_gelesen_tokens: 0,
  cache_geschrieben_tokens: 0,
  abgebrochen: 0,
  fehler: 0,
  kosten: 0,
  ohne_preis: 0
})

/**
 * The price row for a model: the exact id, else the id without its date
 * suffix (the API answers `claude-haiku-4-5-20251001` for a request naming
 * `claude-haiku-4-5`, and the list may carry either), else nothing.
 */
export function preisFuer(
  modell: string,
  preise: readonly Preis[]
): Preis | null {
  const genau = preise.find((p) => p.modell === modell)
  if (genau !== undefined) return genau
  const ohneDatum = modell.replace(/-\d{8}$/, '')
  return preise.find((p) => p.modell === ohneDatum) ?? null
}

/** What one call cost, in the price row's currency; null without a price. */
export function kostenAus(
  z: VerbrauchsZeile,
  preis: Preis | null
): number | null {
  if (preis === null) return null
  return (
    (z.eingabe_tokens * preis.eingabe_je_mio +
      z.ausgabe_tokens * preis.ausgabe_je_mio +
      z.cache_gelesen_tokens * preis.cache_lesen_je_mio +
      z.cache_geschrieben_tokens * preis.cache_schreiben_je_mio) /
    1_000_000
  )
}

function addiere(
  summe: VerbrauchsSumme,
  z: VerbrauchsZeile,
  kosten: number | null
): void {
  summe.aufrufe += 1
  summe.eingabe_tokens += z.eingabe_tokens
  summe.ausgabe_tokens += z.ausgabe_tokens
  summe.cache_gelesen_tokens += z.cache_gelesen_tokens
  summe.cache_geschrieben_tokens += z.cache_geschrieben_tokens
  if (z.abgebrochen) summe.abgebrochen += 1
  if (z.fehler !== null && z.fehler !== '') summe.fehler += 1
  if (kosten === null) summe.ohne_preis += 1
  else summe.kosten += kosten
}

/** Cost first, then output tokens (what costs most where no price is known), then input. */
function teurer(a: VerbrauchsSumme, b: VerbrauchsSumme): number {
  return (
    b.kosten - a.kosten ||
    b.ausgabe_tokens - a.ausgabe_tokens ||
    b.eingabe_tokens - a.eingabe_tokens ||
    b.aufrufe - a.aufrufe
  )
}

export function verbrauchsBilanz(
  zeilen: readonly VerbrauchsZeile[],
  tage: number,
  preise: readonly Preis[] = []
): VerbrauchsBilanz {
  const gesamt = LEER()
  const ohnePreis = new Set<string>()
  const tische = new Map<
    string,
    {
      summe: VerbrauchsSumme
      modelle: Map<string, VerbrauchsSumme>
      zwecke: Map<
        string,
        VerbrauchsSumme & {
          modell_zuletzt: string | null
          max_tokens_zuletzt: number | null
          ausgabe_max: number
        }
      >
    }
  >()
  for (const z of zeilen) {
    const preis = preisFuer(z.modell, preise)
    const kosten = kostenAus(z, preis)
    if (preis === null) ohnePreis.add(z.modell)
    addiere(gesamt, z, kosten)
    let t = tische.get(z.tisch)
    if (t === undefined) {
      t = { summe: LEER(), modelle: new Map(), zwecke: new Map() }
      tische.set(z.tisch, t)
    }
    addiere(t.summe, z, kosten)
    const m = t.modelle.get(z.modell) ?? LEER()
    addiere(m, z, kosten)
    t.modelle.set(z.modell, m)
    const w = t.zwecke.get(z.zweck) ?? {
      ...LEER(),
      modell_zuletzt: null,
      max_tokens_zuletzt: null,
      ausgabe_max: 0
    }
    addiere(w, z, kosten)
    // Rows arrive oldest first, so the last one seen is the latest.
    w.modell_zuletzt = z.modell
    w.max_tokens_zuletzt = z.max_tokens ?? w.max_tokens_zuletzt
    w.ausgabe_max = Math.max(w.ausgabe_max, z.ausgabe_tokens)
    t.zwecke.set(z.zweck, w)
  }
  return {
    tage,
    waehrung: preise[0]?.waehrung ?? null,
    gesamt,
    ohnePreis: [...ohnePreis].sort(),
    tische: [...tische.entries()]
      .map(([tisch, t]) => ({
        tisch,
        ...t.summe,
        modelle: [...t.modelle.entries()]
          .map(([modell, s]) => ({ modell, ...s }))
          .sort(teurer),
        zwecke: [...t.zwecke.entries()]
          .map(([zweck, s]) => ({ zweck, ...s }))
          .sort(teurer)
      }))
      .sort(teurer)
  }
}

/** `?tage=` clamped to a sane window; the default is a week. */
export function tageAus(roh: unknown, standard = 7): number {
  const n = Number(roh)
  if (!Number.isFinite(n) || n < 1) return standard
  return Math.min(365, Math.floor(n))
}
