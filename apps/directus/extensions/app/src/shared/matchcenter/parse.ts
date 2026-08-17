// Parsing the SFV Match Center's "what's on" page.
//
// Why this page and not the club page: a club page (`?v=<id>`) lists only the
// club's OWN team plus the score, never the opponent. For an away match that
// leaves "FC Pratteln C1 — 4 — 2" with no way to tell whether Pratteln won 4:2
// or lost 2:4. Publishing a reversed scoreline is exactly the failure `zahlen.ts`
// exists to prevent, so the club page is not used as a result source.
//
// The "what's on" page names both teams in playing order and always sets the
// venue at the first-named team's ground — verified across three clubs by
// joining both pages on `Spielnummer`. First team is therefore home.
//
// The markdown is a flattened table, so the parse anchors on `Spielnummer`,
// which is the only unambiguous landmark: everything since the last kick-off
// time belongs to the match that number closes. Anything that does not yield a
// confident home/away pair is skipped rather than guessed.

export interface Begegnung {
  spielnummer: string
  /** Local wall-clock, `YYYY-MM-DDTHH:mm:00`. Crons and the process run in Europe/Zurich. */
  datum: string
  heim: string
  gast: string
  ort: string | null
  wettbewerb: string
  /** `verschoben`, `nicht gespielt (Gegner)` … — null when the match simply stands. */
  status: string | null
  toreHeim: number | null
  toreGast: number | null
}

const TAG = /^(Mo|Di|Mi|Do|Fr|Sa|So)\s+(\d{2})\.(\d{2})\.(\d{4})$/
const ZEIT = /^(\d{1,2}):(\d{2})$/
const SPIELNUMMER = /^Spielnummer\s+(\d+)$/
const WETTBEWERB =
  /^(Meisterschaft|Cup|Trainingsspiele|Testspiel|Turnier|Freundschaftsspiel)/i
const STATUS =
  /^(nicht gespielt|verschoben|abgesagt|forfait|annulliert|abgebrochen)/i
const NUR_ZAHL = /^\d{1,3}$/

/**
 * Teams a local newsroom would actually write about.
 *
 * The Match Center mixes a club's first team in with its juniors, its veterans
 * and its friendlies — a single club page carried 39 matches, of which four
 * were the kind anyone reports on. Keeping everything would bury the one result
 * that matters under a dozen D-9 tournaments.
 *
 * The competition name decides it, not the team label: "FC Pratteln (5.)" and
 * "FC Pratteln B1" are only distinguishable by what they are playing in.
 */
export function istInteressant(wettbewerb: string): boolean {
  const w = wettbewerb.toLowerCase()

  if (
    /junior|juniorinnen|senioren|trainingsspiel|firmensport|sffs|walking|beach|kids|grümpel|gruempel/.test(
      w
    )
  ) {
    return false
  }

  // An active league — "2. Liga interregional", "5. Liga", "Frauen 3. Liga" —
  // or the region's own cup.
  return /\d\.\s*liga/.test(w) || /cup/.test(w)
}

function istOrt(zeile: string): boolean {
  // Venues always carry their municipality after a comma: "Spiegelfeld, Binningen - 1".
  return zeile.includes(',') && !WETTBEWERB.test(zeile) && !STATUS.test(zeile)
}

/**
 * Reads every match on the page.
 *
 * Duplicate `Spielnummer` entries are normal — the page repeats the competition
 * and venue block — so the first complete reading of a number wins.
 */
export function parseWhatsOn(markdown: string): Begegnung[] {
  const zeilen = markdown
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z !== '')

  const gefunden = new Map<string, Begegnung>()
  let datum: string | null = null
  let zeit: string | null = null
  let puffer: string[] = []

  for (const zeile of zeilen) {
    const tag = TAG.exec(zeile)
    if (tag !== null) {
      const [, , t, m, j] = tag
      if (t !== undefined && m !== undefined && j !== undefined)
        datum = `${j}-${m}-${t}`
      puffer = []
      continue
    }

    const uhr = ZEIT.exec(zeile)
    if (uhr !== null) {
      const [, h, min] = uhr
      if (h !== undefined && min !== undefined)
        zeit = `${h.padStart(2, '0')}:${min}`
      puffer = []
      continue
    }

    const nummer = SPIELNUMMER.exec(zeile)
    if (nummer === null) {
      puffer.push(zeile)
      continue
    }

    const id = nummer[1]
    if (
      id !== undefined &&
      !gefunden.has(id) &&
      datum !== null &&
      zeit !== null
    ) {
      const begegnung = ausPuffer(id, `${datum}T${zeit}:00`, puffer)
      if (begegnung !== null) gefunden.set(id, begegnung)
    }
    puffer = []
  }

  return [...gefunden.values()]
}

function ausPuffer(
  spielnummer: string,
  datum: string,
  puffer: string[]
): Begegnung | null {
  const wettbewerb = puffer.find((z) => WETTBEWERB.test(z)) ?? null
  if (wettbewerb === null) return null

  const status = puffer.find((z) => STATUS.test(z)) ?? null
  const ort = puffer.find(istOrt) ?? null

  // Whatever is left, in page order, is the two team names. Single characters
  // are markers the table renders between the teams, not names.
  const namen = puffer.filter(
    (z) =>
      z !== wettbewerb &&
      z !== status &&
      z !== ort &&
      !NUR_ZAHL.test(z) &&
      z.length > 2 &&
      !WETTBEWERB.test(z) &&
      !STATUS.test(z)
  )
  if (namen.length < 2) return null

  const zahlen = puffer
    .filter((z) => NUR_ZAHL.test(z))
    .map((z) => Number.parseInt(z, 10))

  return {
    spielnummer,
    datum,
    heim: namen[0] as string,
    gast: namen[1] as string,
    ort,
    wettbewerb,
    status,
    // A score is two numbers, in playing order. One number alone is not a
    // result — it is a table position or a group number that wandered in.
    toreHeim: zahlen.length === 2 ? (zahlen[0] as number) : null,
    toreGast: zahlen.length === 2 ? (zahlen[1] as number) : null
  }
}

/**
 * Which of our clubs a match belongs to.
 *
 * Matched against the club names the newsroom entered, not against a list from
 * the source, so an entry only ever attaches to a club an editor confirmed.
 * The Match Center appends team suffixes — "FC Arlesheim b", "SC Binningen
 * (FF-17 1/S)" — so a prefix match on the stored name is what connects them.
 */
export function ordneVereinZu<T extends { id: string; name: string }>(
  begegnung: Begegnung,
  vereine: readonly T[]
): T | null {
  for (const seite of [begegnung.heim, begegnung.gast]) {
    const treffer = vereine.find((verein) => passt(seite, verein.name))
    if (treffer !== undefined) return treffer
  }
  return null
}

function passt(mannschaft: string, vereinsname: string): boolean {
  const m = normalisiere(mannschaft)
  const v = normalisiere(vereinsname)
  return m === v || m.startsWith(`${v} `) || m.startsWith(`${v}(`)
}

function normalisiere(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[`'’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
