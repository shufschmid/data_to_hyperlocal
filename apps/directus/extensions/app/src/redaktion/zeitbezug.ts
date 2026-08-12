// Guarding the "texts that last" rule.
//
// «Die Redaktion» writes classic journalism, not briefing notes: an article
// about the 2025 waste figures is still on the site in 2028, and "vergangenes
// Jahr" is wrong by then in a way no reader can repair. The prompt asks for
// explicit years; this is the check that the model actually did it.
//
// Two tiers, and the split matters more than the word lists. A single blocking
// list produces false positives on perfectly good sentences ("gegenüber dem
// Vorjahr 2024"), the editor stops trusting the check, and then it protects
// nothing. So: hard hits are always wrong, soft hits are shown and left to a
// human.
//
// The patterns carry real umlauts, unlike the German UI strings elsewhere in
// this codebase — they have to match what the model writes, not what we type.

/** Always wrong in a text meant to last. There is no context that rescues these. */
const HARTE_MUSTER: readonly string[] = [
  'gestern',
  'vorgestern',
  'heute',
  'heutzutage',
  'morgen',
  'übermorgen',
  'dieses Jahr',
  'diesem Jahr',
  'diesen Monat',
  'diesem Monat',
  'diese Woche',
  'dieser Woche',
  'letztes Jahr',
  'letzten Jahr',
  'letzte Woche',
  'letzten Monat',
  'vergangenes Jahr',
  'vergangenen Jahr',
  'vergangene Woche',
  'vergangenen Monat',
  'nächstes Jahr',
  'nächsten Jahr',
  'kommendes Jahr',
  'kommenden Jahr',
  'kürzlich',
  'vor kurzem',
  'jüngst',
  'unlängst',
  'neuerdings',
  'derzeit',
  'momentan',
  'zurzeit',
  'aktuell',
  'gegenwärtig',
  'in diesem Jahr',
  'im letzten Jahr',
  'im vergangenen Jahr'
]

/**
 * Fine when an anchor year stands nearby, wrong when it does not.
 *
 * "gegenüber dem Vorjahr" is normal journalistic German and blocking it would
 * be wrong; "seither ist der Wert gestiegen" with no year in sight is a problem.
 * A human decides.
 */
const WEICHE_MUSTER: readonly string[] = [
  'Vorjahr',
  'seither',
  'seitdem',
  'inzwischen',
  'mittlerweile',
  'bisher',
  'bislang',
  'zuletzt',
  'künftig',
  'fortan',
  'neu',
  'nun'
]

// \b does not understand umlauts in JavaScript, so a German-aware boundary is
// spelled out instead.
const VOR = '(?<![\\wäöüßÄÖÜ])'
const NACH = '(?![\\wäöüßÄÖÜ])'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findeMuster(text: string, muster: readonly string[]): string[] {
  const treffer: string[] = []

  for (const wort of muster) {
    const regex = new RegExp(`${VOR}${escapeRegExp(wort)}${NACH}`, 'iu')
    if (regex.test(text)) treffer.push(wort)
  }

  return treffer
}

export interface Zeitbefund {
  /** Must not be published. Triggers one retry, then a flagged draft. */
  hart: string[]
  /** Shown to the editor next to the article, never blocking. */
  weich: string[]
}

export function findeRelativeZeitangaben(text: string): Zeitbefund {
  return {
    hart: findeMuster(text, HARTE_MUSTER),
    weich: findeMuster(text, WEICHE_MUSTER)
  }
}

/**
 * Whether the reference year appears at all.
 *
 * An article about the 2025 figures that never writes "2025" reads as if it were
 * about now — which is exactly the failure the explicit-year rule exists to
 * prevent, and one no keyword list would catch.
 */
export function nenntJahr(text: string, periode: string): boolean {
  const jahr = periode.slice(0, 4)
  if (!/^(19|20)\d{2}$/.test(jahr)) return true

  return new RegExp(`(?<!\\d)${jahr}(?!\\d)`).test(text)
}

/** Everything an article has to satisfy before it may be stored as a draft. */
export function pruefeZeitbezug(
  text: string,
  periode: string
): { bestanden: boolean; hart: string[]; weich: string[]; jahrFehlt: boolean } {
  const befund = findeRelativeZeitangaben(text)
  const jahrFehlt = !nenntJahr(text, periode)

  return {
    bestanden: befund.hart.length === 0 && !jahrFehlt,
    hart: befund.hart,
    weich: befund.weich,
    jahrFehlt
  }
}

/**
 * The correction handed back to the model on the retry.
 *
 * Naming the offending words beats repeating the rule: the model already had the
 * rule in the system prompt and broke it anyway, so the retry has to say what
 * exactly was wrong.
 */
export function korrekturHinweis(
  befund: { hart: string[]; jahrFehlt: boolean },
  periode: string
): string {
  const teile: string[] = []

  if (befund.hart.length > 0) {
    teile.push(
      `Der Text enthaelt relative Zeitangaben: ${befund.hart.map((wort) => `"${wort}"`).join(', ')}. ` +
        'Ersetze jede davon durch die konkrete Jahreszahl oder das Datum.'
    )
  }
  if (befund.jahrFehlt) {
    teile.push(
      `Der Text nennt die Jahreszahl ${periode.slice(0, 4)} nicht. Nenne sie ausdruecklich.`
    )
  }

  return teile.join(' ')
}
