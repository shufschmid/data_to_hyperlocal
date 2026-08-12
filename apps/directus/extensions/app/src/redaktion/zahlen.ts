// Catching percentages the model worked out for itself.
//
// The generator is handed every comparison ready-made — "Grüngut: 34.9
// gegenueber 91.42 im Kantonsschnitt — 61.83 Prozent unter dem Kantonsschnitt".
// It still occasionally recomputes one and gets it wrong: an observed article
// turned that 61.83 into "rund 68 Prozent". Nothing about the sentence looks
// wrong, which is precisely why a human proofreader waves it through.
//
// So percentages are checked rather than trusted. Only percentages: the raw
// values appear in the text legitimately and in many forms, while a percentage
// is always a derived figure and always one we supplied.

/** German decimals use a comma; the data uses a point. Accept both. */
const PROZENT = /(\d+(?:[.,]\d+)?)\s*(?:Prozent|%)/gi

export function findeProzentangaben(text: string): number[] {
  const gefunden: number[] = []

  for (const treffer of text.matchAll(PROZENT)) {
    const roh = (treffer[1] ?? '').replace(',', '.')
    const zahl = Number.parseFloat(roh)
    if (Number.isFinite(zahl)) gefunden.push(zahl)
  }

  return gefunden
}

/**
 * Percentages in the text that we never supplied.
 *
 * The tolerance is what makes this usable rather than pedantic: an article that
 * rounds 61.83 to "rund 62 Prozent" is doing its job, and flagging that would
 * train the editor to ignore the warnings. One percentage point of slack
 * accepts honest rounding and still catches 68 against 61.83.
 */
export function unbelegteProzentangaben(
  text: string,
  erlaubt: readonly number[],
  toleranz = 1
): number[] {
  return findeProzentangaben(text).filter(
    (zahl) => !erlaubt.some((quelle) => Math.abs(zahl - quelle) <= toleranz)
  )
}

/** Pulls the percentages out of what `beschreibeEinordnung` produced. */
export function erlaubteProzentangaben(einordnung: string): number[] {
  return findeProzentangaben(einordnung)
}

/** The correction handed back on the retry, naming the offending figures. */
export function zahlenKorrekturHinweis(unbelegt: readonly number[]): string {
  if (unbelegt.length === 0) return ''

  return (
    `Der Text enthaelt Prozentangaben, die nicht aus der Einordnung stammen: ` +
    `${unbelegt.map((z) => `${z} Prozent`).join(', ')}. ` +
    'Rechne nicht selbst — uebernimm die Prozentangaben aus der Einordnung ' +
    'woertlich oder lass sie weg.'
  )
}
