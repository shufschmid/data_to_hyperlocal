// The revision watchdog, as the desk sees it.
//
// The backend writes `revision_hinweis` on a PUBLISHED article when the source
// has revised the figures it stands on. That is the rarest and the loudest of
// all warnings here: everything else on this desk is about work in progress,
// while this is about something already out in the world that may now be wrong.
//
// So it sorts to the top and it counts in the tab's badge. It never changes an
// article's status — the watchdog states, a person decides.

/** The one field the desk needs. Structural, so every query shape fits. */
export interface MitRevision {
  revision_hinweis: string | null
}

/** Whitespace is not a finding: an empty string must not light up a badge. */
export function hatRevision(zeile: MitRevision): boolean {
  return typeof zeile.revision_hinweis === 'string' && zeile.revision_hinweis.trim() !== ''
}

/**
 * Articles with a revision finding first, everything else in the order it came.
 *
 * A stable partition rather than a sort: the callers hand over lists that are
 * already ordered the way the newsroom wants them (by municipality, by date),
 * and re-sorting would quietly throw that away.
 */
export function nachRevision<T extends MitRevision>(zeilen: readonly T[]): T[] {
  return [...zeilen.filter(hatRevision), ...zeilen.filter((z) => !hatRevision(z))]
}

/** What the tab's badge shows. */
export function revisionZaehler(zeilen: readonly MitRevision[]): number {
  return zeilen.filter(hatRevision).length
}
