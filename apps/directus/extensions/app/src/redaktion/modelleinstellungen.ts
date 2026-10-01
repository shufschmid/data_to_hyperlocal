// What the newsroom may set per purpose — model and token budget — and the
// rules that keep a setting from breaking a call. Pure; the wiring is in
// `endpoints/redaktion/index.ts`, the reading in `hooks/modellverbrauch`.
//
// The newsroom asked on 1 October 2026 to choose model and budget per desk
// from the cost table itself. A purpose is `tisch:zweck` as the call sites
// name it, or the desk alone for all of its purposes; the exact purpose wins
// over the desk, the desk over the code. `shared/claude.ts` applies it on
// every call and translates the thinking mode where a model needs it, so a
// switch here is never a 400 tomorrow morning.

export interface ModellWahl {
  id: string
  name: string
  hinweis: string
}

/**
 * The models the picker offers — each one tried against this house's call
 * shape (structured output, cached system block, thinking off) before it was
 * listed. A free id is accepted too; it is checked for shape, not existence.
 */
export const MODELLE: readonly ModellWahl[] = [
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Haiku 4.5',
    hinweis: 'am günstigsten — für Sortieraufgaben (Sichtung, Triage)'
  },
  {
    id: 'claude-sonnet-5',
    name: 'Sonnet 5',
    hinweis: 'der Standard des Hauses'
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Sonnet 5.5',
    hinweis: 'gleicher Preis wie Sonnet 5, neuere Generation'
  },
  {
    id: 'claude-opus-5-5',
    name: 'Opus 5.5',
    hinweis: 'das Doppelte von Sonnet; denkt immer, der Etat trägt es mit'
  },
  {
    id: 'claude-opus-5',
    name: 'Opus 5',
    hinweis: 'das Zweieinhalbfache von Sonnet'
  }
]

export const MAX_TOKENS_MIN = 256
export const MAX_TOKENS_MAX = 128_000

const ZWECK = /^[a-z0-9-]+(:[a-z0-9-]+)*$/
const MODELL_ID = /^claude-[a-z0-9.-]+$/

export interface Einstellung {
  zweck: string
  modell: string | null
  max_tokens: number | null
  notiz: string | null
}

export type EinstellungsPruefung =
  | { ok: true; einstellung: Einstellung }
  | { ok: false; grund: string }

/** The request body of `POST /redaktion/modelleinstellungen`, checked. Both values empty means: back to the code's own. */
export function pruefeEinstellung(roh: unknown): EinstellungsPruefung {
  const k = (roh ?? {}) as Record<string, unknown>
  const zweck = typeof k['zweck'] === 'string' ? k['zweck'].trim() : ''
  if (zweck === '' || zweck.length > 80 || !ZWECK.test(zweck))
    return {
      ok: false,
      grund: 'Der Zweck muss wie «tisch:zweck» oder «tisch» aussehen.'
    }
  const modellRoh = k['modell']
  let modell: string | null = null
  if (typeof modellRoh === 'string' && modellRoh.trim() !== '') {
    modell = modellRoh.trim()
    if (modell.length > 60 || !MODELL_ID.test(modell))
      return { ok: false, grund: 'Das ist keine Modell-ID (claude-…).' }
  } else if (
    modellRoh !== null &&
    modellRoh !== undefined &&
    modellRoh !== ''
  ) {
    return { ok: false, grund: 'Das Modell muss eine ID oder leer sein.' }
  }
  const tokensRoh = k['max_tokens']
  let maxTokens: number | null = null
  if (tokensRoh !== null && tokensRoh !== undefined && tokensRoh !== '') {
    const n = Number(tokensRoh)
    if (!Number.isInteger(n) || n < MAX_TOKENS_MIN || n > MAX_TOKENS_MAX)
      return {
        ok: false,
        grund: `Der Token-Etat muss eine ganze Zahl zwischen ${MAX_TOKENS_MIN} und ${MAX_TOKENS_MAX} sein.`
      }
    maxTokens = n
  }
  const notiz =
    typeof k['notiz'] === 'string' && k['notiz'].trim() !== ''
      ? k['notiz'].trim().slice(0, 500)
      : null
  return {
    ok: true,
    einstellung: { zweck, modell, max_tokens: maxTokens, notiz }
  }
}

export interface PreisEingabe {
  modell: string
  eingabe_je_mio: number
  ausgabe_je_mio: number
  cache_lesen_je_mio: number
  cache_schreiben_je_mio: number
  waehrung: string
}

export type PreisPruefung =
  | { ok: true; preis: PreisEingabe }
  | { ok: false; grund: string }

/** The request body of `POST /redaktion/modellpreise`, checked: four prices, none negative, one currency. */
export function pruefePreis(roh: unknown): PreisPruefung {
  const k = (roh ?? {}) as Record<string, unknown>
  const modell = typeof k['modell'] === 'string' ? k['modell'].trim() : ''
  if (modell === '' || modell.length > 60 || !MODELL_ID.test(modell))
    return { ok: false, grund: 'Das ist keine Modell-ID (claude-…).' }
  const zahl = (feld: string): number | null => {
    const n = Number(k[feld])
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const felder = [
    'eingabe_je_mio',
    'ausgabe_je_mio',
    'cache_lesen_je_mio',
    'cache_schreiben_je_mio'
  ] as const
  const werte: Partial<Record<(typeof felder)[number], number>> = {}
  for (const f of felder) {
    const n = zahl(f)
    if (n === null)
      return {
        ok: false,
        grund: 'Jeder Preis ist eine Zahl, null oder grösser.'
      }
    werte[f] = n
  }
  const waehrung =
    typeof k['waehrung'] === 'string' && /^[A-Z]{3}$/.test(k['waehrung'].trim())
      ? k['waehrung'].trim()
      : 'USD'
  return {
    ok: true,
    preis: {
      modell,
      eingabe_je_mio: werte.eingabe_je_mio ?? 0,
      ausgabe_je_mio: werte.ausgabe_je_mio ?? 0,
      cache_lesen_je_mio: werte.cache_lesen_je_mio ?? 0,
      cache_schreiben_je_mio: werte.cache_schreiben_je_mio ?? 0,
      waehrung
    }
  }
}
