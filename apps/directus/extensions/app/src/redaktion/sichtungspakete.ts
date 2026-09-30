// A Sichtung sorts; it does not deliberate. Since 30 September 2026 every
// Sichtung and triage goes out in PACKETS, with thinking off and a cached
// system prompt — and each of those three is measured, not assumed.
//
// The packet: the events Sichtung sent every ungraded row of a municipality
// in one call. Since rows are graded on first sight across a sixty-day
// window (29.09.2026), that was 112 rows for Riehen and 40 for Reinach, and
// one verdict costs 60–80 output tokens — the 8000-token ceiling fell in the
// middle of the answer. A truncated answer grades nothing, so the same rows
// came back the next day with the new ones on top: three municipalities paid
// the full input plus 8000 output tokens every run for nothing. Twenty-five
// rows fit comfortably, and a packet that fails costs only its own rows.
//
// Thinking off: the four cheap sorting calls of the house (agenda mapping,
// portal inventory, the learning layer) already run without it, and a grade
// with a one-sentence reason is that kind of answer. The budget then buys
// verdicts, not deliberation.

export const SICHTUNG_JE_AUFRUF = 25

/**
 * Enough for a full packet with a one-sentence reason each (about 80
 * tokens a verdict) and slack; a truncated packet is reported and its rows
 * are asked again tomorrow, alone.
 */
export const SICHTUNG_MAX_TOKENS = 4000

/** The options every Sichtung and triage shares — spread into the call. */
export const SICHTUNG_AUFRUF = {
  thinking: 'disabled' as const,
  maxTokens: SICHTUNG_MAX_TOKENS
}

export function pakete<T>(
  zeilen: readonly T[],
  groesse: number = SICHTUNG_JE_AUFRUF
): T[][] {
  const schritt = Math.max(1, Math.floor(groesse))
  const ergebnis: T[][] = []
  for (let i = 0; i < zeilen.length; i += schritt)
    ergebnis.push(zeilen.slice(i, i + schritt))
  return ergebnis
}

/**
 * The reason the run reports — it prefixes «Sichtung fehlgeschlagen:» itself,
 * so a single packet hands back its bare reason and several packets say
 * how many of how many, with the first reason.
 */
export function sichtungsFehlerText(
  fehler: readonly string[],
  anzahlPakete: number
): string | null {
  if (fehler.length === 0) return null
  const erster = fehler[0] ?? ''
  return anzahlPakete === 1
    ? erster
    : `${fehler.length} von ${anzahlPakete} Paketen — ${erster}`
}
