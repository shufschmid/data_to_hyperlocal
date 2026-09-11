// Parsing the SFV Match Center's "what's on" page.
//
// Why this page and not the club page: a club page (`?v=<id>`) lists only the
// club's OWN team, never the opponent, so it cannot say who played whom. It is
// therefore no use as a *fixture* source — but it does keep the score long
// after this page has moved on, which is what `parseVereinsseite` below is for.
// The two are read together, joined on the Spielnummer both of them print.
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

// ---------------------------------------------------------------------------
// Nachtrag: the score, read from a club page.
//
// The 'what's on' page only ever looks forward — measured on 20.08. its window
// was 20.–23.08., so the match played on the 19th had already rolled off it.
// A fixture stored while it was upcoming would therefore never receive its
// result from that source. The club page keeps it.
//
// The club page does not name the opponent in Markdown, which is why it is not
// a fixture source. It does not have to be: the fixture is already stored with
// heim and gast in playing order, so this pass only carries the score across,
// joined on the Spielnummer both pages print.
//
// Direction is heim:gast — visible in the browser, where the same rows read
// 'FC Aesch a – SC Binningen b  0 : 6' at Aesch's ground and
// 'SV Muttenz b – FC Aesch a  0 : 4' at Muttenz's. Only the opponent column is
// lost in conversion, never the order.

export interface Resultat {
  spielnummer: string
  toreHeim: number
  toreGast: number
}

/**
 * Reads every finished result on a club page.
 *
 * Rows without exactly two numbers are skipped: a fixture that has not been
 * played prints none, and a single number is a group or a table position.
 */
// ---------------------------------------------------------------------------
// Telegramme — the association's own match report behind the little icon
// ---------------------------------------------------------------------------

export interface Telegrammfund {
  /** The telegram page, absolute. */
  url: string
  heim: string
  gast: string
  toreHeim: number
  toreGast: number
  /** `YYYY-MM-DD` from the nearest date heading, or null. */
  datum: string | null
}

const TELEGRAMM_URL = /^\]?\((https?:[^)]*[?&]tg=\d+[^)]*)\)$/
const TELEGRAMM_INLINE =
  /^\[(?:!\[\]\([^)]*\))?\s*\]\((https?:[^)]*[?&]tg=\d+[^)]*)\)$/
const TELEGRAMM_ID = /[?&]tg=(\d+)/

/** The telegram's id inside a Match Center address, or null. */
export function telegrammId(url: string): number | null {
  const treffer = TELEGRAMM_ID.exec(url)
  const roh = treffer?.[1]
  if (roh === undefined) return null
  const zahl = Number.parseInt(roh, 10)
  return Number.isFinite(zahl) ? zahl : null
}

/**
 * Every telegram address among a rendered page's links — deduplicated by id
 * (the same telegram is linked from several rows and several pages) and NEWEST
 * FIRST, because the probe that follows is bounded: the fresh matches are the
 * ones still waiting for their telegram, the old ones were caught on earlier
 * runs.
 */
export function telegrammLinks(links: readonly string[]): string[] {
  const jeId = new Map<number, string>()
  for (const link of links) {
    const id = telegrammId(link)
    if (id !== null && !jeId.has(id)) jeId.set(id, link)
  }
  return [...jeId.entries()].sort(([a], [b]) => b - a).map(([, url]) => url)
}

/** Strips a markdown link down to its text: `[FC X](url)` → `FC X`. */
function ohneLink(zeile: string): string {
  const m = /^\[([^\]]+)\]\([^)]*\)$/.exec(zeile)
  return (m?.[1] ?? zeile).replace(/\\/g, '')
}

/**
 * Every telegram the page's markdown still carries, with the match it belongs
 * to.
 *
 * This is the FREE half of discovery: where the icon survives the markdown
 * conversion (measured: the "Resultate + Ranglisten" view keeps it as
 * `[\n](…tg=…)` anchors), the row shape names both teams and the score, so the
 * telegram attaches to its fixture without another request. Where the icon is
 * a JavaScript handler instead (the club's front page — zero anchors), the
 * crawler's `links` format still sees the address, but bare: those go through
 * `telegrammLinks` and the bounded probe, which fetches the page and matches
 * on the Spielnummer it prints.
 *
 * The row shape it anchors on, verbatim from the a=rr page: the anchor, then
 * home, away, and the two score digits, each on its own line.
 */
export function parseTelegramme(markdown: string): Telegrammfund[] {
  const zeilen = markdown
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z !== '')

  const funde: Telegrammfund[] = []
  const gesehen = new Set<string>()
  let datum: string | null = null

  for (let i = 0; i < zeilen.length; i += 1) {
    const zeile = zeilen[i] as string

    const tag = TAG.exec(zeile)
    if (tag !== null) {
      datum = `${tag[4]}-${tag[3]}-${tag[2]}`
      continue
    }

    // The anchor comes in two prints: `[` and `](url)` on separate lines, or
    // the whole (possibly icon-carrying) link on one.
    let url: string | null = null
    let start = i
    const inline = TELEGRAMM_INLINE.exec(zeile)
    if (inline !== null) {
      url = inline[1] ?? null
      start = i + 1
    } else if (zeile === '[') {
      const naechste = TELEGRAMM_URL.exec(zeilen[i + 1] ?? '')
      if (naechste !== null) {
        url = naechste[1] ?? null
        start = i + 2
      }
    }
    if (url === null || gesehen.has(url)) continue

    const heim = ohneLink(zeilen[start] ?? '')
    const gast = ohneLink(zeilen[start + 1] ?? '')
    const tore1 = zeilen[start + 2] ?? ''
    const tore2 = zeilen[start + 3] ?? ''
    // Shape or nothing: an anchor inside a ranking table is followed by rank
    // rows, not by two teams and two digits, and is dropped here.
    if (
      heim === '' ||
      gast === '' ||
      NUR_ZAHL.test(heim) ||
      NUR_ZAHL.test(gast) ||
      !NUR_ZAHL.test(tore1) ||
      !NUR_ZAHL.test(tore2)
    ) {
      continue
    }

    gesehen.add(url)
    funde.push({
      url,
      heim,
      gast,
      toreHeim: Number.parseInt(tore1, 10),
      toreGast: Number.parseInt(tore2, 10),
      datum
    })
  }

  return funde
}

export interface Telegramm {
  /** The Spielnummer the page itself names — the guard against a wrong link. */
  spielnummer: string
  /** Header, scorers, cards and the event ticker — the lineups stay out. */
  text: string
}

/**
 * The telegram page's own content, cut to what a report can use.
 *
 * Measured on tg=4403552 (US Olympia 1963 – FC Aesch, Basler Cup): one header
 * line carrying `Spielnummer: 513497`, the two teams with their scorers and
 * minutes, the running score, one long ticker line with every goal and card —
 * then the lineups under `#### <team>` headings, which are bulk and stay out.
 */
export function parseTelegrammSeite(
  markdown: string,
  maxZeichen = 3500
): Telegramm | null {
  const zeilen = markdown.split('\n')
  const start = zeilen.findIndex((z) => /Spielnummer:\s*\d+/.test(z))
  if (start === -1) return null

  const nummer = /Spielnummer:\s*(\d+)/.exec(zeilen[start] as string)
  if (nummer?.[1] === undefined) return null

  const teile: string[] = []
  for (let i = start; i < zeilen.length; i += 1) {
    const zeile = (zeilen[i] as string).trim()
    if (i > start && zeile.startsWith('#### ')) break
    if (zeile !== '') teile.push(zeile)
  }

  const ganz = teile.join('\n')
  const text =
    ganz.length > maxZeichen
      ? `${ganz.slice(0, maxZeichen)}\n[… Telegramm gekuerzt]`
      : ganz

  return { spielnummer: nummer[1], text }
}

export function parseVereinsseite(markdown: string): Resultat[] {
  const zeilen = markdown
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z !== '')

  const gefunden = new Map<string, Resultat>()
  let puffer: string[] = []

  for (const zeile of zeilen) {
    if (ZEIT.test(zeile)) {
      puffer = []
      continue
    }

    const nummer = SPIELNUMMER.exec(zeile)
    if (nummer === null) {
      puffer.push(zeile)
      continue
    }

    const id = nummer[1]
    const zahlen = puffer
      .filter((z) => NUR_ZAHL.test(z))
      .map((z) => Number.parseInt(z, 10))

    if (id !== undefined && !gefunden.has(id) && zahlen.length === 2) {
      gefunden.set(id, {
        spielnummer: id,
        toreHeim: zahlen[0] as number,
        toreGast: zahlen[1] as number
      })
    }
    puffer = []
  }

  return [...gefunden.values()]
}
