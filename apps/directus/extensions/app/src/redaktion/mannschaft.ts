// Which of a club's teams gets a match report.
//
// A village club fields several: SC Binningen played four times on 29 August
// 2026 — the first team in the 2. Liga interregional, plus a 4th-league, a
// 5th-league and a women's side. All four are stored (the fixture list is
// useful whole), but three articles about "SC Binningen" losing 0:2, 0:12 and
// winning 7:0 on one Saturday are not reporting, they are noise — and nothing
// in the data even says which team is which.
//
// So the newsroom's rule: the first team only, and women's sides are not
// reported as the club. The second half needs care, because "women's team" and
// "not the club's team" are not the same thing: Sm'Aesch Pfeffingen IS a
// women's Nationalliga A side and the flagship of its municipality. The
// exception below is what keeps it.

/** Marks a women's competition. `FAEW` is the FVNWS' own abbreviation. */
const FRAUEN = /\b(frauen|damen|faew|ff-\d)\b/i

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

/** A cup run belongs to the first team; it carries no league name. */
function istCup(wettbewerb: string): boolean {
  return /\bcup\b/i.test(wettbewerb)
}

/**
 * The matches of a club's first team, out of everything stored for it.
 *
 * Derived from the matches themselves rather than from `vereine.liga`, because
 * that column is an editor's free-text note — measured values include
 * "3. und 4. Liga" and null — and a rule that depends on it would quietly stop
 * reporting for half the clubs. The highest league a club appears in IS its
 * first team.
 *
 * `vereinsLiga` is consulted for one thing only: whether the club's registered
 * team is itself a women's side. Where it is, women's matches are the club's
 * matches and stay.
 */
export function ersteMannschaft<T extends { wettbewerb: string }>(
  spiele: readonly T[],
  vereinsLiga: string | null
): T[] {
  const frauenverein = vereinsLiga !== null && istFrauenwettbewerb(vereinsLiga)

  const infrage = frauenverein
    ? [...spiele]
    : spiele.filter((s) => !istFrauenwettbewerb(s.wettbewerb))
  if (infrage.length === 0) return []

  const raenge = infrage
    .map((s) => ligaRang(s.wettbewerb))
    .filter((r): r is number => r !== null)

  // No rankable league anywhere — a cup-only club, or a competition naming we
  // have not seen. Reporting all of it beats reporting none.
  if (raenge.length === 0) return infrage

  const bester = Math.min(...raenge)
  return infrage.filter((s) => {
    const rang = ligaRang(s.wettbewerb)
    return rang === bester || (rang === null && istCup(s.wettbewerb))
  })
}
