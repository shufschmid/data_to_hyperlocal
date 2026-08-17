// Parsing Swiss Handball's Match Center team page.
//
// The friendliest of the three sources: every row carries a real ISO instant
// next to the human date, so no month names and no timezone arithmetic.
//
//     Sa 29.08.26 18:002026-08-29T18:00:00.000Z
//     TV Pratteln NS 1 (M1)
//     GC Amicitia Zürich (M1)
//     0 - 0 (0 - 0)
//
// The trap is that last line: a fixture that has not been played yet still
// prints `0 - 0`, which is indistinguishable from a genuine draw. The date
// decides — a score is only read once the match is in the past. Handball does
// not end 0:0 in practice, but "it cannot really happen" is not a rule, and a
// phantom draw in an article is exactly what `zahlen.ts` guards against.

export interface HandballBegegnung {
  schluessel: string
  /** The ISO instant the page itself publishes. */
  datum: string
  heim: string
  gast: string
  toreHeim: number | null
  toreGast: number | null
}

const ISO = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/
const RAUSCHEN = /^[|\-—–\s]*$/
const ZAHL = /^\(?(\d{1,3})\)?$/

export function spielSchluessel(
  teamId: string,
  heim: string,
  gast: string
): string {
  return `hb-${slug(teamId)}-${slug(heim)}-vs-${slug(gast)}`
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Reads the fixtures and results on one team page.
 *
 * `jetzt` is injected so the played/unplayed decision is testable and does not
 * drift with the wall clock.
 */
export function parseHandball(
  markdown: string,
  teamId: string,
  jetzt: Date = new Date()
): HandballBegegnung[] {
  const zeilen = markdown
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z !== '')

  const gefunden = new Map<string, HandballBegegnung>()

  for (let i = 0; i < zeilen.length; i += 1) {
    const treffer = ISO.exec(zeilen[i] as string)
    if (treffer === null || treffer[1] === undefined) continue

    // The first row of the table repeats its date line; skip the duplicates so
    // the team names are read from the right place.
    let j = i + 1
    while (j < zeilen.length && ISO.test(zeilen[j] as string)) j += 1

    const namen: string[] = []
    while (j < zeilen.length && namen.length < 2) {
      const zeile = zeilen[j] as string
      if (ISO.test(zeile)) break
      if (!RAUSCHEN.test(zeile) && !ZAHL.test(zeile)) namen.push(zeile)
      j += 1
    }
    if (namen.length < 2) continue

    const zahlen: number[] = []
    while (j < zeilen.length && zahlen.length < 2) {
      const zeile = zeilen[j] as string
      if (ISO.test(zeile)) break
      const zahl = ZAHL.exec(zeile)
      if (zahl !== null && zahl[1] !== undefined)
        zahlen.push(Number.parseInt(zahl[1], 10))
      else if (!RAUSCHEN.test(zeile)) break
      j += 1
    }

    const datum = `${treffer[1]}Z`
    const gespielt = new Date(datum).getTime() <= jetzt.getTime()
    const heim = namen[0] as string
    const gast = namen[1] as string
    const schluessel = spielSchluessel(teamId, heim, gast)

    if (!gefunden.has(schluessel)) {
      gefunden.set(schluessel, {
        schluessel,
        datum,
        heim,
        gast,
        toreHeim:
          gespielt && zahlen.length === 2 ? (zahlen[0] as number) : null,
        toreGast: gespielt && zahlen.length === 2 ? (zahlen[1] as number) : null
      })
    }
  }

  return [...gefunden.values()]
}
