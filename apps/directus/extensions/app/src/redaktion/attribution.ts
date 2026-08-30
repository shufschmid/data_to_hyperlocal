// Does the article say where its figures come from?
//
// The prompt asks for it (`buildArtikelSystemPrompt`), and this is the rule
// next to the request — the same pairing the project uses for relative time
// references and for percentages: a prompt is a wish, a check is a rule.
//
// Why it matters beyond good manners: these articles are assembled from an
// official statistic and read like reporting. A reader who cannot see that the
// numbers are the canton's own has no way to weigh them, and a correction
// later has nothing to point at.

/** The office, in the spellings a German sentence actually produces. */
const AMT =
  /\bstatistische[nrms]?\s+amt(?:e?s|e)?\b|\bstatistik\s*amt\b|\bamt\s+f(?:ü|ue)r\s+statistik\b/i

/** A source line the article carries instead of a sentence, e.g. "Quelle: …". */
const QUELLENZEILE = /\bquelle\s*:/i

/**
 * True when the text names neither the office nor a source line.
 *
 * Deliberately generous: any of the accepted spellings counts, and a plain
 * "Quelle: …" line counts too. The check exists to catch the article that
 * mentions its origin nowhere at all — not to police the wording.
 */
export function fehlendeAttribution(text: string): boolean {
  const gelesen = text.normalize('NFC')
  return !AMT.test(gelesen) && !QUELLENZEILE.test(gelesen)
}

/** What the one retry is told, in the same voice as the other two checks. */
export function attributionsKorrektur(): string {
  return [
    'Der Text nennt nicht, woher die Zahlen stammen.',
    'Ergaenze genau einen natuerlichen Satz, am besten im Lead oder im ersten',
    'Absatz, etwa "wie das Statistische Amt Basel-Landschaft meldet".'
  ].join(' ')
}
