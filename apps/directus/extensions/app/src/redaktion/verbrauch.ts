// The newsroom's own cost view: what every call to the model cost, by desk.
//
// Asked for on 30 September 2026, after a day of guessing which desk spends
// what — the answer is a table, not an estimate, and it comes from the usage
// block the API returns with every answer (`shared/claude.ts` records it,
// `hooks/modellverbrauch` stores it in `modellaufrufe`). Tokens, not francs:
// prices change and live in nobody's code; a reader multiplies.

import type { Modellaufruf } from '../types/schema'

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
}

export interface VerbrauchJeTisch extends VerbrauchsSumme {
  tisch: string
  /** The same numbers split by model, because Opus and Haiku do not cost the same. */
  modelle: Array<VerbrauchsSumme & { modell: string }>
  /** The single most expensive purposes of this desk, by output tokens — where to look first. */
  zwecke: Array<VerbrauchsSumme & { zweck: string }>
}

export interface VerbrauchsBilanz {
  tage: number
  gesamt: VerbrauchsSumme
  tische: VerbrauchJeTisch[]
}

const LEER = (): VerbrauchsSumme => ({
  aufrufe: 0,
  eingabe_tokens: 0,
  ausgabe_tokens: 0,
  cache_gelesen_tokens: 0,
  cache_geschrieben_tokens: 0,
  abgebrochen: 0,
  fehler: 0
})

function addiere(summe: VerbrauchsSumme, z: VerbrauchsZeile): void {
  summe.aufrufe += 1
  summe.eingabe_tokens += z.eingabe_tokens
  summe.ausgabe_tokens += z.ausgabe_tokens
  summe.cache_gelesen_tokens += z.cache_gelesen_tokens
  summe.cache_geschrieben_tokens += z.cache_geschrieben_tokens
  if (z.abgebrochen) summe.abgebrochen += 1
  if (z.fehler !== null && z.fehler !== '') summe.fehler += 1
}

/** Output tokens first — they cost the most — then input, as the tie-breaker. */
function teurer(a: VerbrauchsSumme, b: VerbrauchsSumme): number {
  return (
    b.ausgabe_tokens - a.ausgabe_tokens ||
    b.eingabe_tokens - a.eingabe_tokens ||
    b.aufrufe - a.aufrufe
  )
}

/** How many purposes a desk lists before the rest is left out. */
export const ZWECKE_JE_TISCH = 6

export function verbrauchsBilanz(
  zeilen: readonly VerbrauchsZeile[],
  tage: number
): VerbrauchsBilanz {
  const gesamt = LEER()
  const tische = new Map<
    string,
    {
      summe: VerbrauchsSumme
      modelle: Map<string, VerbrauchsSumme>
      zwecke: Map<string, VerbrauchsSumme>
    }
  >()
  for (const z of zeilen) {
    addiere(gesamt, z)
    let t = tische.get(z.tisch)
    if (t === undefined) {
      t = { summe: LEER(), modelle: new Map(), zwecke: new Map() }
      tische.set(z.tisch, t)
    }
    addiere(t.summe, z)
    const m = t.modelle.get(z.modell) ?? LEER()
    addiere(m, z)
    t.modelle.set(z.modell, m)
    const w = t.zwecke.get(z.zweck) ?? LEER()
    addiere(w, z)
    t.zwecke.set(z.zweck, w)
  }
  return {
    tage,
    gesamt,
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
          .slice(0, ZWECKE_JE_TISCH)
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
