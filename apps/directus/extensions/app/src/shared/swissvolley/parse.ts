// Parsing Swiss Volley's Game Center team page.
//
// Different shape from football, which is why `vereine.ergebnis_url` is stored
// per club rather than derived from `sportart`: football has one page for the
// whole association, volleyball has one page per *team*.
//
// The page emits three lines per match, the venue glued to the kick-off time
// and an em dash where the score will go:
//
//     Samstag, 10. Oktober 2026, 20:00Aarau
//     BTV Aarau—
//     Sm`Aesch Pfeffingen
//
// Home is the first-named team, as on the Match Center. There is no match
// number, so the identity is composed from the team and the pairing — see
// `spielSchluessel`.

export interface VolleyBegegnung {
  schluessel: string
  /** Local wall-clock, `YYYY-MM-DDTHH:mm:00`. */
  datum: string
  heim: string
  gast: string
  ort: string | null
  toreHeim: number | null
  toreGast: number | null
}

const MONATE: Record<string, string> = {
  januar: '01',
  februar: '02',
  märz: '03',
  maerz: '03',
  april: '04',
  mai: '05',
  juni: '06',
  juli: '07',
  august: '08',
  september: '09',
  oktober: '10',
  november: '11',
  dezember: '12'
}

// "Samstag, 10. Oktober 2026, 20:00Aarau" — the trailing group is the venue,
// which the page renders without a separator.
const KOPF =
  /^\p{L}+,\s*(\d{1,2})\.\s*(\p{L}+)\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*(.*)$/u

/**
 * A stable identity for a fixture that carries no match number.
 *
 * Keyed on the pairing rather than the date on purpose: a postponed match keeps
 * its teams but changes its date, and keying on the date would file the new date
 * as a second, phantom fixture. Two legs stay distinct because home and away
 * swap places.
 */
export function spielSchluessel(
  externeId: string,
  heim: string,
  gast: string
): string {
  return `sv-${slug(externeId)}-${slug(heim)}-vs-${slug(gast)}`
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
 * Reads the fixtures on one team page.
 *
 * `externeId` identifies the team at the source and only feeds the key. A block
 * that does not yield both team names is skipped rather than guessed — the page
 * repeats its navigation around the fixture list, and half a fixture is worse
 * than none.
 */
export function parseGameCenter(
  markdown: string,
  externeId: string
): VolleyBegegnung[] {
  const zeilen = markdown
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z !== '')

  const gefunden = new Map<string, VolleyBegegnung>()

  for (let i = 0; i < zeilen.length - 2; i += 1) {
    const kopf = KOPF.exec(zeilen[i] as string)
    if (kopf === null) continue

    const [, tag, monatName, jahr, stunde, minute, ortRoh] = kopf
    if (tag === undefined || monatName === undefined || jahr === undefined)
      continue
    if (stunde === undefined || minute === undefined) continue

    const monat = MONATE[monatName.toLowerCase()]
    if (monat === undefined) continue

    const heimZeile = zeilen[i + 1] as string
    const gastZeile = zeilen[i + 2] as string

    const heim = mannschaft(heimZeile)
    const gast = mannschaft(gastZeile)
    if (heim === null || gast === null) continue

    const datum = `${jahr}-${monat}-${tag.padStart(2, '0')}T${stunde.padStart(2, '0')}:${minute}:00`
    const ort =
      ortRoh === undefined || ortRoh.trim() === '' ? null : ortRoh.trim()
    const schluessel = spielSchluessel(externeId, heim, gast)

    if (!gefunden.has(schluessel)) {
      gefunden.set(schluessel, {
        schluessel,
        datum,
        heim,
        gast,
        ort,
        // The page shows an em dash until a match is played. A set score would
        // need its own reading, and guessing one is worse than leaving it open.
        toreHeim: satzZahl(heimZeile),
        toreGast: satzZahl(gastZeile)
      })
    }
    i += 2
  }

  return [...gefunden.values()]
}

/** Strips the trailing score placeholder or set count from a team line. */
function mannschaft(zeile: string): string | null {
  const name = zeile
    .replace(/[—–-]\s*$/u, '')
    .replace(/\s*\d+\s*$/u, '')
    .trim()
  return name.length < 2 ? null : name
}

function satzZahl(zeile: string): number | null {
  const treffer = /(\d+)\s*$/.exec(zeile.replace(/[—–]\s*$/u, ''))
  if (treffer === null || treffer[1] === undefined) return null
  return Number.parseInt(treffer[1], 10)
}
