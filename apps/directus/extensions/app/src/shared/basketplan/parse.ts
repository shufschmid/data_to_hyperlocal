// Reading Swiss Basketball's schedule XML — the pure half.
//
// The association publishes Basketplan's data under its own origin, and that
// origin's robots.txt allows everything. `showLeagueSchedule.do` with
// `xmlView=rss` answers `text/xml`, one `<GameRSS>` per match inside the group
// it was asked for:
//
//     <GameRSS date="2025-09-27" id="348301" locationCity="Aarau 4 Telli"
//              locationName="Sportanlage Telli Spielhalle" time="14:30"
//              videoLink="https://www.youtube.com/watch?v=…">
//       <guestTeam clubId="22" gender="M" id="6511" name="DDV Wild Ducks"
//                  result="42" resultQ1="10" …/>
//       <homeTeam  clubId="87" gender="M" id="1043" name="BC Alte Kanti Aarau"
//                  result="85" resultQ1="19" …/>
//     </GameRSS>
//
// Four things measured on 17 September 2026 decide this module:
//
//  1. `GameRSS/@id` is a real six-digit identity at the source, so no composed
//     key is needed (volleyball has none and has to build one).
//  2. An unplayed match carries NO `result` attribute at all — not «0». The
//     handball trap («0 - 0» is not a draw) therefore does not exist here. The
//     clock still decides: a score is only read once the match is past, so a
//     figure can never arrive before the game did.
//  3. `referees="Nachname Vorname/Nachname Vorname"` names natural persons.
//     It is dropped at this boundary and reaches no object, no row, no prompt.
//     `findTeamById.do` is never called at all: its answer carries a club
//     official's private address and mobile numbers.
//  4. The XML lists the GUEST first. Playing order is `homeTeam` then
//     `guestTeam`, and reading it off the document order would invert every
//     result in the newsroom.
//
// No XML package: the answer is flat and regular, and a bundle that already
// carries unpdf does not need a second parser for eight attributes. Written by
// hand, tested against two real responses.

/** One match of one group, as the association publishes it. */
export interface BasketballBegegnung {
  /** `GameRSS/@id` — the identity at the source. */
  spielnummer: string
  /**
   * Local wall-clock, `YYYY-MM-DDTHH:mm:00`.
   *
   * The source prints `date` and `time` separately and names no zone; the
   * football and volleyball connectors store the same shape, and crons and the
   * process run in Europe/Zurich. Handball is the exception only because its
   * page publishes a real instant of its own.
   */
  datum: string
  heim: string
  gast: string
  /** `homeTeam/@id` — the TEAM at the source, not the club. */
  heimTeam: string
  /** `guestTeam/@id`. */
  gastTeam: string
  heimClub: string
  gastClub: string
  toreHeim: number | null
  toreGast: number | null
  ort: string | null
  videoLink: string | null
}

export interface Basketballspielplan {
  /** `LeagueHoldingRSS/@leagueName`, e.g. «NLB Women». Null on an empty answer. */
  liga: string | null
  /** The group inside the league, `LeagueHoldingRSS/@name`. */
  gruppe: string | null
  spiele: BasketballBegegnung[]
}

const GAME = /<GameRSS\b([^>]*)>([\s\S]*?)<\/GameRSS>/g
const HOLDING = /<LeagueHoldingRSS\b([^>]*)>/
const HEIM = /<homeTeam\b([^>]*?)\/?>/
const GAST = /<guestTeam\b([^>]*?)\/?>/
const ATTRIBUT = /([A-Za-z][A-Za-z0-9]*)="([^"]*)"/g

/** Attributes we never read, whatever the source sends. */
const VERBOTEN = new Set(['referees'])

function entities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, ziffern: string) =>
      String.fromCodePoint(Number.parseInt(ziffern, 10))
    )
    .replace(/&amp;/g, '&')
}

/**
 * The attributes of one tag.
 *
 * `referees` is dropped HERE rather than at the far end, so no later change can
 * carry it onward by accident: what the parser never holds cannot leak.
 */
function attribute(roh: string): Record<string, string> {
  const gefunden: Record<string, string> = {}
  for (const treffer of roh.matchAll(ATTRIBUT)) {
    const name = treffer[1] as string
    if (VERBOTEN.has(name)) continue
    gefunden[name] = entities(treffer[2] as string)
  }
  return gefunden
}

function text(wert: string | undefined): string | null {
  const getrimmt = (wert ?? '').trim()
  return getrimmt === '' ? null : getrimmt
}

function zahl(wert: string | undefined): number | null {
  if (wert === undefined || !/^-?\d+$/.test(wert)) return null
  return Number.parseInt(wert, 10)
}

/**
 * The schedule of one group.
 *
 * `jetzt` is injected so the played/unplayed decision is testable and does not
 * drift with the wall clock — the same arrangement as handball.
 */
export function parseSpielplan(
  xml: string,
  jetzt: Date = new Date()
): Basketballspielplan {
  const kopf = HOLDING.exec(xml)
  const gruppendaten = kopf === null ? {} : attribute(kopf[1] as string)

  const spiele: BasketballBegegnung[] = []
  for (const treffer of xml.matchAll(GAME)) {
    const spiel = attribute(treffer[1] as string)
    const inhalt = treffer[2] as string

    const heimRoh = HEIM.exec(inhalt)
    const gastRoh = GAST.exec(inhalt)
    if (heimRoh === null || gastRoh === null) continue

    const heim = attribute(heimRoh[1] as string)
    const gast = attribute(gastRoh[1] as string)

    const spielnummer = text(spiel['id'])
    const datumTag = text(spiel['date'])
    const heimName = text(heim['name'])
    const gastName = text(gast['name'])
    const heimTeam = text(heim['id'])
    const gastTeam = text(gast['id'])
    if (
      spielnummer === null ||
      datumTag === null ||
      heimName === null ||
      gastName === null ||
      heimTeam === null ||
      gastTeam === null
    ) {
      continue
    }

    const uhrzeit = text(spiel['time']) ?? '00:00'
    const datum = `${datumTag}T${uhrzeit}:00`

    // A score only once the match is past. The source is honest about it —
    // an unplayed match carries no `result` at all — but «it cannot really
    // happen» is not a rule, and a phantom result is exactly what the digit
    // check guards against.
    const vorbei = new Date(datum).getTime() <= jetzt.getTime()
    const toreHeim = zahl(heim['result'])
    const toreGast = zahl(gast['result'])
    const gespielt = vorbei && toreHeim !== null && toreGast !== null

    const ortsteile = [text(spiel['locationName']), text(spiel['locationCity'])]
      .filter((teil): teil is string => teil !== null)
      .join(', ')

    spiele.push({
      spielnummer,
      datum,
      heim: heimName,
      gast: gastName,
      heimTeam,
      gastTeam,
      heimClub: text(heim['clubId']) ?? '',
      gastClub: text(gast['clubId']) ?? '',
      toreHeim: gespielt ? toreHeim : null,
      toreGast: gespielt ? toreGast : null,
      ort: ortsteile === '' ? null : ortsteile,
      videoLink: text(spiel['videoLink'])
    })
  }

  return {
    liga: text(gruppendaten['leagueName']),
    gruppe: text(gruppendaten['name']),
    spiele
  }
}

// ---------------------------------------------------------------------------
// Which of our clubs a match belongs to
// ---------------------------------------------------------------------------

export interface BasketballZuordnung<V> {
  spiel: BasketballBegegnung
  verein: V
}

export interface BasketballZuordnungen<V> {
  zugeordnet: BasketballZuordnung<V>[]
  /** Matches of a group that belong to nobody we cover — counted, not stored. */
  ohneVerein: number
}

/**
 * Locally, without a model, on the team id at the source.
 *
 * On the TEAM (`externe_id`), not the club: one group request carries several
 * of our municipalities' clubs — BC Allschwil-Algon and Liestal Basket 44 play
 * in the same NL1 Men group as BC Arlesheim's men — and a club fields more than
 * one team under one `clubId`. The team id is what makes «the first team» a
 * property of the registration rather than a guess.
 *
 * A match between two of our own clubs goes to the HOME side and is stored
 * once: `spiele.spielnummer` is unique, and two rows for one match would mean
 * two articles about it. The football connector decides the same way.
 */
export function ordneBasketballZu<V extends { externe_id: string | null }>(
  spiele: readonly BasketballBegegnung[],
  vereine: readonly V[]
): BasketballZuordnungen<V> {
  const nachTeam = new Map<string, V>()
  for (const verein of vereine) {
    const kennung = (verein.externe_id ?? '').trim()
    // A club without an id at the source matches nothing — better silent and
    // countable than attached to every match of the group.
    if (kennung !== '') nachTeam.set(kennung, verein)
  }

  const zugeordnet: BasketballZuordnung<V>[] = []
  let ohneVerein = 0

  for (const spiel of spiele) {
    const verein =
      nachTeam.get(spiel.heimTeam) ?? nachTeam.get(spiel.gastTeam) ?? null
    if (verein === null) {
      ohneVerein += 1
      continue
    }
    zugeordnet.push({ spiel, verein })
  }

  return { zugeordnet, ohneVerein }
}

// ---------------------------------------------------------------------------
// The page a reader can open
// ---------------------------------------------------------------------------

/**
 * The public league page behind a `leagueName`.
 *
 * The address the connector READS is a machine door: `showLeagueSchedule.do`
 * answers `text/xml` whether or not `xmlView=rss` is asked for (measured), so
 * it is no source line for a reader. The association's own page for the league
 * is, and its shape was measured from the site's navigation on 17 September
 * 2026: six pages, `/de/national-competitions/<sbl|nlb|nl1>/<men|women>`.
 *
 * Nothing is guessed beyond those six. A league we have not measured — a youth
 * or cup competition — answers null, and the caller keeps the address it
 * actually read. Better an ugly true link than a pretty invented one.
 */
const LIGASEITEN = new Set(['sbl', 'nlb', 'nl1'])

export function oeffentlicheLigaseite(liga: string | null): string | null {
  const treffer = /^\s*(sbl|nlb|nl1)\s+(men|women)\s*$/i.exec(liga ?? '')
  if (treffer === null) return null
  const stufe = (treffer[1] as string).toLowerCase()
  const geschlecht = (treffer[2] as string).toLowerCase()
  if (!LIGASEITEN.has(stufe)) return null
  return `https://swiss.basketball/de/national-competitions/${stufe}/${geschlecht}`
}
