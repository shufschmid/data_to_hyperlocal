// Parsing Swiss Volley's Game Center team page.
//
// Different shape from football, which is why `vereine.ergebnis_url` is stored
// per club rather than derived from `sportart`: football has one page for the
// whole association, volleyball has one page per *team*.
//
// The page has two sections, and the crawler renders them differently —
// measured on 11 October 2026, the day after Sm'Aesch's first match of the
// season, which was the first time a result ever stood on the page. «Kommende
// Spiele» arrive TWICE: once as three plain lines per match, the venue glued to
// the kick-off time and an em dash where the score will go —
//
//     Samstag, 10. Oktober 2026, 20:00Aarau
//     BTV Aarau—
//     Sm`Aesch Pfeffingen
//
// — and once more inside one long markdown link per match, both club logos as
// images and the match's own page as the address. «Letzte Ergebnisse» arrive
// ONLY in that link form, with the set result glued between the venue and the
// first logo and the set scores right after it:
//
//     [Samstag, 10\. Oktober 2026, 20:00Aarau2318:2525:2010:2525:2213:15![BTV Aarau](…)BTV Aarau—![Sm`Aesch Pfeffingen](…)Sm\`Aesch Pfeffingen](https://www.volleyball.ch/de/game-center/game/400971)
//
// That is 2:3 in sets, then 18:25 25:20 10:25 25:22 13:15. A parser reading
// the plain lines alone sees six upcoming matches and no result — which is
// exactly what happened to that match. Both forms are read now, and a block
// the page carries that could not be read is COUNTED, because a result that
// goes missing here looks just like a match not yet played.
//
// Home is the first-named team, as on the Match Center. The plain lines carry
// no match number, so the identity is composed from the team and the pairing —
// see `spielSchluessel`.

export interface VolleyBegegnung {
  schluessel: string
  /** Local wall-clock, `YYYY-MM-DDTHH:mm:00`. */
  datum: string
  heim: string
  gast: string
  ort: string | null
  /** Sets won — a volleyball result is counted in sets, never in points. */
  toreHeim: number | null
  toreGast: number | null
  /** The set scores as printed, `25:20`, in playing order; empty until played. */
  saetze: string[]
}

export interface GameCenterLesung {
  begegnungen: VolleyBegegnung[]
  /**
   * Matches the page carries that yielded no row, plus rows whose result stood
   * on the page and could not be read. The run names the count: silence here
   * is indistinguishable from "not played yet".
   */
  unlesbar: number
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
// which the page renders without a separator (plus the result, once played).
const KOPF =
  /^\p{L}+,\s*(\d{1,2})\.\s*(\p{L}+)\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*(.*)$/u

// A markdown image, its address allowed one level of parentheses: the logo
// URLs carry `filters:format(webp):quality(80)`.
const BILD = /!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/gu

// What a logo is replaced with. The images are the only thing separating the
// venue from the home team's name ("20:00Aesch" + "Sm`Aesch Pfeffingen"), so
// they are not dropped but turned into a marker no name contains.
const TRENNER = '\u0001'

// One match in link form, logos already replaced by the marker:
//   [Samstag, 10\. Oktober 2026, 20:00<venue+result>|<heim>—|<gast>](…/game/<id>)
const LINK = new RegExp(
  String.raw`\[\p{L}+,\s*(\d{1,2})\\?\.\s*(\p{L}+)\s+(\d{4}),\s*(\d{1,2}):(\d{2})([^\u0001\[\]]*)\u0001([^\u0001\]]*?)[—–-]\u0001([^\u0001\]]*)\]\(https?://[^)\s]*/game-center/game/(\d+)\)`,
  'gu'
)

const SPIEL_ID = /\/game-center\/game\/(\d+)/gu

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
 * Reads the fixtures on one team page — both forms the crawler renders.
 *
 * `externeId` identifies the team at the source and only feeds the key. A block
 * that does not yield both team names is skipped rather than guessed — the page
 * repeats its navigation around the fixture list, and half a fixture is worse
 * than none. Where the same match appears in both forms, the reading that
 * carries a result wins; otherwise the first.
 */
export function parseGameCenter(
  markdown: string,
  externeId: string
): GameCenterLesung {
  const gefunden = new Map<string, VolleyBegegnung>()
  let resultateUnlesbar = 0

  const merke = (
    datum: string,
    rest: string,
    heimRoh: string,
    gastRoh: string
  ): boolean => {
    const heim = mannschaft(heimRoh)
    const gast = mannschaft(gastRoh)
    if (heim === null || gast === null) return false

    const gelesen = ortUndResultat(rest)
    if (gelesen.unlesbar) resultateUnlesbar += 1

    const schluessel = spielSchluessel(externeId, heim, gast)
    const neu: VolleyBegegnung = {
      schluessel,
      datum,
      heim,
      gast,
      ort: gelesen.ort,
      toreHeim: gelesen.toreHeim,
      toreGast: gelesen.toreGast,
      saetze: gelesen.saetze
    }
    const bisher = gefunden.get(schluessel)
    if (
      bisher === undefined ||
      (bisher.toreHeim === null && neu.toreHeim !== null)
    ) {
      gefunden.set(schluessel, neu)
    }
    return true
  }

  // The plain form: three lines per match.
  const zeilen = markdown
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z !== '')

  for (let i = 0; i < zeilen.length - 2; i += 1) {
    const kopf = KOPF.exec(zeilen[i] as string)
    if (kopf === null) continue
    const datum = datumAus(kopf[1], kopf[2], kopf[3], kopf[4], kopf[5])
    if (datum === null) continue
    if (
      merke(
        datum,
        kopf[6] ?? '',
        zeilen[i + 1] as string,
        zeilen[i + 2] as string
      )
    ) {
      i += 2
    }
  }

  // The link form: one markdown link per match, carrying the match's own id.
  const ids = new Set<string>()
  for (const treffer of markdown.matchAll(SPIEL_ID)) {
    if (treffer[1] !== undefined) ids.add(treffer[1])
  }
  const gelesen = new Set<string>()
  const ohneBilder = markdown.replace(BILD, TRENNER)
  for (const treffer of ohneBilder.matchAll(LINK)) {
    const [, tag, monatName, jahr, stunde, minute, rest, heimRoh, gastRoh, id] =
      treffer
    const datum = datumAus(tag, monatName, jahr, stunde, minute)
    if (datum === null || id === undefined) continue
    if (merke(datum, rest ?? '', heimRoh ?? '', gastRoh ?? '')) gelesen.add(id)
  }

  return {
    begegnungen: [...gefunden.values()],
    unlesbar: ids.size - gelesen.size + resultateUnlesbar
  }
}

function datumAus(
  tag: string | undefined,
  monatName: string | undefined,
  jahr: string | undefined,
  stunde: string | undefined,
  minute: string | undefined
): string | null {
  if (tag === undefined || monatName === undefined || jahr === undefined)
    return null
  if (stunde === undefined || minute === undefined) return null
  const monat = MONATE[monatName.toLowerCase()]
  if (monat === undefined) return null
  return `${jahr}-${monat}-${tag.padStart(2, '0')}T${stunde.padStart(2, '0')}:${minute}:00`
}

/**
 * A team name as the page prints it, cleaned of what the rendering added.
 *
 * Markdown escapes come off, and so does the trailing dash that stands where
 * the score will go. The page prints a typewriter BACKTICK where the club
 * writes an apostrophe — «Sm`Aesch Pfeffingen» for Sm'Aesch Pfeffingen — and
 * the apostrophe is what the newsroom registered under `vereine.name`, so the
 * row carries the club's own spelling. (The key is unaffected: `slug` folds
 * both to a hyphen.) No trailing digit is read as a score any more — the page
 * never prints one there, and «VBC Aesch 2» is a team, not a result.
 */
function mannschaft(zeile: string): string | null {
  const name = zeile
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1')
    .replace(/`/g, "'")
    .replace(/[—–-]\s*$/u, '')
    .trim()
  return name.length < 2 ? null : name
}

interface OrtUndResultat {
  ort: string | null
  toreHeim: number | null
  toreGast: number | null
  saetze: string[]
  /** A result stood there and no single reading of it held up. */
  unlesbar: boolean
}

// The run of digits and colons the page glues to the venue once a match is
// played: set result, then the set scores, no separator anywhere.
const RESULTAT_SCHWANZ = /^(.*?)([\d:]*\d:\d[\d:]*)$/u

/**
 * Splits «Aarau2318:2525:2010:2525:2213:15» into the venue, the sets and the
 * set scores — by enumeration, not by guessing.
 *
 * Nothing separates the four parts, and a set score can be one digit (25:8)
 * or two, so the run has more than one tokenisation. Every reading is tried
 * and kept only if it TALLIES: sets at most 3 each and not equal, exactly as
 * many set scores as sets, each set's winner matching the side that won it,
 * and every set decided (unequal, the winner at 15 or more). Exactly one
 * surviving reading is a result; none or several is declared unreadable and
 * leaves the match open rather than inventing a score.
 */
function ortUndResultat(rest: string): OrtUndResultat {
  const text = rest.trim()
  const treffer = RESULTAT_SCHWANZ.exec(text)
  if (treffer === null) {
    return {
      ort: oderNull(text),
      toreHeim: null,
      toreGast: null,
      saetze: [],
      unlesbar: false
    }
  }
  const vorne = treffer[1] ?? ''
  const schwanz = treffer[2] ?? ''

  const lesungen: Array<{
    ort: string
    heim: number
    gast: number
    saetze: string[]
  }> = []
  // Leading digits may still belong to the venue («Halle 2»): every split is tried.
  for (let ab = 0; ab <= schwanz.length - 2; ab += 1) {
    const vorneZiffern = schwanz.slice(0, ab)
    if (!/^\d*$/.test(vorneZiffern)) break
    const heim = Number.parseInt(schwanz.charAt(ab), 10)
    const gast = Number.parseInt(schwanz.charAt(ab + 1), 10)
    if (Number.isNaN(heim) || Number.isNaN(gast)) continue
    if (heim > 3 || gast > 3 || heim === gast) continue
    for (const saetze of satzLesungen(schwanz.slice(ab + 2))) {
      if (saetze.length !== heim + gast) continue
      const heimSaetze = saetze.filter(([a, b]) => a > b).length
      if (heimSaetze !== heim) continue
      lesungen.push({
        ort: vorne + vorneZiffern,
        heim,
        gast,
        saetze: saetze.map(([a, b]) => `${a}:${b}`)
      })
    }
  }

  const einzige = lesungen.length === 1 ? lesungen[0] : undefined
  if (einzige === undefined) {
    return {
      ort: oderNull(vorne),
      toreHeim: null,
      toreGast: null,
      saetze: [],
      unlesbar: true
    }
  }
  return {
    ort: oderNull(einzige.ort),
    toreHeim: einzige.heim,
    toreGast: einzige.gast,
    saetze: einzige.saetze,
    unlesbar: false
  }
}

/** Every way to read a glued run of set scores, each set decided. */
function satzLesungen(text: string): Array<Array<[number, number]>> {
  if (text === '') return [[]]
  const ergebnisse: Array<Array<[number, number]>> = []
  for (const aLaenge of [1, 2]) {
    for (const bLaenge of [1, 2]) {
      const kopf = new RegExp(`^(\\d{${aLaenge}}):(\\d{${bLaenge}})`).exec(text)
      if (kopf === null || kopf[1] === undefined || kopf[2] === undefined)
        continue
      const a = Number.parseInt(kopf[1], 10)
      const b = Number.parseInt(kopf[2], 10)
      if (a === b || Math.max(a, b) < 15) continue
      for (const weitere of satzLesungen(text.slice(kopf[0].length))) {
        ergebnisse.push([[a, b], ...weitere])
      }
    }
  }
  return ergebnisse
}

function oderNull(text: string): string | null {
  const t = text.trim()
  return t === '' ? null : t
}
