// Which of a club's teams the newsroom follows at all.
//
// A village club fields several: SC Binningen played four times on 29 August
// 2026 — the first team in the 2. Liga interregional, a second team in the
// regional 2. Liga, a 4th-league and a 5th-league side. Nothing in the data
// says which team is which, and three articles about "SC Binningen" losing 0:2,
// 0:12 and winning 7:0 on one Saturday are not reporting, they are noise.
//
// So the newsroom's rule: the first team only, and women's sides are not
// reported as the club. The second half needs care, because "women's team" and
// "not the club's team" are not the same thing: Sm'Aesch Pfeffingen IS a
// women's Nationalliga A side and the flagship of its municipality. The
// exception below is what keeps it.
//
// Three things about the source, each measured on the Match Center and each
// the reason for one branch below.
//
// «2. Liga (FAEW)» is the regional MEN's 2. Liga, not a women's league. The
// FVNWS names women's leagues «Frauen 3. Liga», «Frauen 4. Liga»; the Basler
// Cup of the men annotates the same clubs with «(2. (FAEW))»; FC Pratteln's
// team list carries «2. Liga (FAEW)» and «5. Liga» as its two active teams.
// From 30 August to 12 October 2026 the rule read FAEW as women's and dropped
// the FIRST teams of FC Pratteln, FC Aesch and FC Amicitia Riehen, reporting
// their 5th- and 3rd-league sides instead.
//
// Two teams in ONE league carry a letter: «FC Münchenstein a» (4. Liga Gruppe 2)
// and «FC Münchenstein b» (4. Liga Gruppe 3). The league rank cannot tell them
// apart, so the letter does: the bare name before «a», «a» before «b».
//
// A cup draw annotates every team with its league — «FC Laufen (3.)»,
// «SC Binningen (2. (FAEW))», «FC Münchenstein a (4.)» — because the cup has
// no league name of its own. SC Binningen's cup side is its 2. Liga regional
// team (the interregional one is not eligible), and only that annotation says
// so. Where it is missing, a cup match still counts for the first team.
//
// The rule used to decide only what got WRITTEN — everything was stored and
// shown, on the theory that a fixture list is useful whole. It is not: the
// newsroom watched women's and lower-league sides pile up in the tab for months
// with no article ever coming of them. The filter therefore sits at the door
// now (`operations/sportresultate-holen`), and `ersteMannschaftAbgleich` is
// what also takes the ones already stored back out.

/**
 * Marks a women's competition — by the association's own words, never by a
 * code: «FAEW» looked like one and was not (see above). `FF-` is the girls'
 * junior category of the FVNWS.
 */
const FRAUEN = /\b(frauen|damen|ff-\d)\b/i

export function istFrauenwettbewerb(wettbewerb: string): boolean {
  return FRAUEN.test(wettbewerb)
}

// Swiss league order, best first. Only what our connectors actually produce
// plus the rungs above it, so an unexpected name ranks as null rather than
// silently sorting to the top.
const RANGFOLGE: readonly RegExp[] = [
  /nationalliga\s*a|\bnla\b/i,
  /nationalliga\s*b|\bnlb\b/i,
  /1\.\s*liga\s*(promotion|classic)/i,
  /1\.\s*liga/i,
  /2\.\s*liga\s*interregional/i,
  /2\.\s*liga/i,
  /3\.\s*liga/i,
  /4\.\s*liga/i,
  /5\.\s*liga/i
]

/**
 * How high a competition sits — 0 is the top, null means we cannot tell.
 *
 * Order matters in the list above: "2. Liga interregional" has to be tested
 * before "2. Liga", or the interregional side would rank as the lower one and
 * a club's first team would lose to its own third.
 */
export function ligaRang(wettbewerb: string): number | null {
  const index = RANGFOLGE.findIndex((muster) => muster.test(wettbewerb))
  return index === -1 ? null : index
}

/** A cup run carries no league name of its own. */
function istCup(wettbewerb: string): boolean {
  return /\bcup\b/i.test(wettbewerb)
}

/** A match as the rule sees it: the competition and the two sides as printed. */
export interface Mannschaftsspiel {
  wettbewerb: string
  heim: string
  gast: string
}

/** What the rule needs to know about the club the matches belong to. */
export interface Vereinsangaben {
  name: string
  /** The editor's free-text league note; consulted for the women's exception only. */
  liga: string | null
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

/**
 * What the source appended to the club's name on its side of the match.
 *
 * '' for the bare name, «a», «b (4.)», «(2. (FAEW))», «1 (M1)» … — and null
 * where neither side is the club (a basketball row names the team at the
 * source, not the club). The same prefix match `ordneVereinZu` attaches a
 * match with, so what it attached this can read.
 */
export function mannschaftsZusatz(
  spiel: { heim: string; gast: string },
  vereinsname: string
): string | null {
  const v = normalisiere(vereinsname)
  for (const seite of [spiel.heim, spiel.gast]) {
    const m = normalisiere(seite)
    if (m === v) return ''
    if (m.startsWith(`${v} `) || m.startsWith(`${v}(`)) {
      return m.slice(v.length).trim()
    }
  }
  return null
}

/**
 * Where a team stands among its club's teams of the SAME league: 0 for the
 * bare name, 1 for «a» or «1», 2 for «b» or «2» …
 *
 * Only the leading token counts: «a (4.)» is team a, «(2. (FAEW))» carries no
 * letter and is the bare team. Unknown means 0 — the rule never demotes on a
 * guess.
 */
export function teamNummer(zusatz: string | null): number {
  if (zusatz === null) return 0
  const token = /^([a-z]|\d)(?=\s|\(|$)/.exec(zusatz)
  if (token === null || token[1] === undefined) return 0
  const t = token[1]
  return /\d/.test(t) ? Number.parseInt(t, 10) : t.charCodeAt(0) - 96
}

/**
 * The league a cup draw annotates a team with, as a rank: «(3.)» is the
 * 3. Liga, «(2. (FAEW))» the regional 2. Liga, «(2. inter)» would be the
 * interregional one. Null where the annotation is missing or unreadable.
 */
export function annotierterRang(zusatz: string | null): number | null {
  if (zusatz === null) return null
  const treffer = /\((\d)\.\s*(?:\(([^)]*)\)|([a-z]+))?\s*\)/i.exec(zusatz)
  if (treffer === null || treffer[1] === undefined) return null
  const stufe = treffer[1]
  const beiname = treffer[2] ?? treffer[3] ?? ''
  const liga = /inter/i.test(beiname)
    ? `${stufe}. Liga interregional`
    : `${stufe}. Liga${beiname === '' ? '' : ` (${beiname})`}`
  return ligaRang(liga)
}

/**
 * The rank of one match: the competition's league, or, in a cup, the league
 * the draw annotated our team with.
 */
function spielRang(
  spiel: Mannschaftsspiel,
  vereinsname: string
): number | null {
  const rang = ligaRang(spiel.wettbewerb)
  if (rang !== null) return rang
  if (!istCup(spiel.wettbewerb)) return null
  return annotierterRang(mannschaftsZusatz(spiel, vereinsname))
}

/**
 * The matches of a club's first team, out of everything handed in.
 *
 * Derived from the matches themselves rather than from `vereine.liga`, because
 * that column is an editor's free-text note — measured values include
 * "3. und 4. Liga" and null — and a rule that depends on it would quietly stop
 * reporting for half the clubs. The highest league a club appears in IS its
 * first team; among several teams in that league, the lowest letter is.
 *
 * `verein.liga` is consulted for one thing only: whether the club's registered
 * team is itself a women's side. Where it is, women's matches are the club's
 * matches and stay.
 */
export function ersteMannschaft<T extends Mannschaftsspiel>(
  spiele: readonly T[],
  verein: Vereinsangaben
): T[] {
  const frauenverein = verein.liga !== null && istFrauenwettbewerb(verein.liga)

  const infrage = frauenverein
    ? [...spiele]
    : spiele.filter((s) => !istFrauenwettbewerb(s.wettbewerb))
  if (infrage.length === 0) return []

  const bewertet = infrage.map((spiel) => ({
    spiel,
    rang: spielRang(spiel, verein.name),
    nummer: teamNummer(mannschaftsZusatz(spiel, verein.name))
  }))

  const raenge = bewertet
    .map((b) => b.rang)
    .filter((r): r is number => r !== null)

  // No rankable league anywhere — a cup-only club, or a competition naming we
  // have not seen. Reporting all of it beats reporting none.
  if (raenge.length === 0) return infrage

  const bester = Math.min(...raenge)
  const erste = Math.min(
    ...bewertet.filter((b) => b.rang === bester).map((b) => b.nummer)
  )

  return bewertet
    .filter(
      (b) =>
        (b.rang === bester && b.nummer === erste) ||
        // A cup match without a readable annotation still belongs to the first
        // team — unless its letter says it is another one.
        (b.rang === null &&
          istCup(b.spiel.wettbewerb) &&
          (b.nummer === erste || b.nummer === 0))
    )
    .map((b) => b.spiel)
}

export interface Mannschaftsabgleich<Neu, Alt> {
  /** Of what the source just delivered, what belongs in the database. */
  behalten: Neu[]
  /** Of what is already stored, what does not — and has to go. */
  entfernen: Alt[]
}

/**
 * One club's fixtures, decided over the stored rows AND the new ones together.
 *
 * The union is the point. Which league is a club's best cannot be read off the
 * handful of matches that happen to be in today's window: a weekend on which
 * only the fourth team plays would otherwise promote it to first team for a
 * day, store its result and write an article about it. The stored rows are
 * already first-team-only, so they carry the club's real rank through such a
 * weekend.
 *
 * It also runs the other way, which is what makes the change land at all:
 * everything a club has stored below its best league — every women's side the
 * old rule kept but never wrote about — comes back as `entfernen`.
 */
export function ersteMannschaftAbgleich<
  Neu extends Mannschaftsspiel,
  Alt extends Mannschaftsspiel
>(
  neu: readonly Neu[],
  gespeichert: readonly Alt[],
  verein: Vereinsangaben
): Mannschaftsabgleich<Neu, Alt> {
  type Eintrag = Mannschaftsspiel & { neu: Neu | null; alt: Alt | null }
  const alle: Eintrag[] = [
    ...neu.map((n) => ({
      wettbewerb: n.wettbewerb,
      heim: n.heim,
      gast: n.gast,
      neu: n,
      alt: null
    })),
    ...gespeichert.map((a) => ({
      wettbewerb: a.wettbewerb,
      heim: a.heim,
      gast: a.gast,
      neu: null,
      alt: a
    }))
  ]

  const bleibt = new Set(ersteMannschaft(alle, verein))

  return {
    behalten: alle
      .filter((e) => e.neu !== null && bleibt.has(e))
      .map((e) => e.neu as Neu),
    entfernen: alle
      .filter((e) => e.alt !== null && !bleibt.has(e))
      .map((e) => e.alt as Alt)
  }
}
