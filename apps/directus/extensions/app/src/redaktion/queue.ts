// The queue's decisions, separated from the database work that carries them out.
//
// Leases rather than locks: a row is claimed with an expiry, and a claim whose
// expiry has passed is up for grabs again. That is what makes the container
// disposable — a process killed mid-article leaves a row marked `laeuft` with a
// lease in the past, and the next scheduled tick picks it up instead of the row
// being stuck forever.

/** How long a claim holds. Long enough for a Claude call, short enough to recover. */
export const LEASE_MS = 5 * 60 * 1000

/** After this many failed attempts a row stops being retried and asks for a human. */
export const MAX_VERSUCHE = 3

/**
 * Wall-clock budget for one drain pass.
 *
 * Without it, a run with 25 municipalities would keep a scheduled tick busy for
 * minutes and the next tick would start on top of it. The pass stops handing
 * out new work when the budget is gone; whatever is left waits for the next tick.
 */
export const PASS_BUDGET_MS = 60 * 1000

export function leaseBis(jetzt: Date, dauerMs = LEASE_MS): Date {
  return new Date(jetzt.getTime() + dauerMs)
}

export function istLeaseAbgelaufen(
  gesperrtBis: string | Date | null,
  jetzt: Date
): boolean {
  if (gesperrtBis === null) return true
  const bis = gesperrtBis instanceof Date ? gesperrtBis : new Date(gesperrtBis)
  return Number.isNaN(bis.getTime()) || bis.getTime() <= jetzt.getTime()
}

/** Whether another attempt is worth making, or the row should be flagged. */
export function darfWiederholen(versuche: number, max = MAX_VERSUCHE): boolean {
  return versuche < max
}

export function budgetErschoepft(
  startMs: number,
  jetztMs: number,
  budgetMs = PASS_BUDGET_MS
): boolean {
  return jetztMs - startMs >= budgetMs
}

/**
 * What a run's status becomes once its articles have been worked through.
 *
 * A run is only `bereit` when nothing is outstanding *and* nothing failed —
 * an editor opening a run marked ready should not find half of it missing.
 */
export function laufStatusNachDurchlauf(zaehler: {
  offen: number
  fehler: number
}): 'schreibt' | 'bereit' | 'fehler' {
  if (zaehler.offen > 0) return 'schreibt'
  return zaehler.fehler > 0 ? 'fehler' : 'bereit'
}

/** Trims an error down to something that fits in a column and still helps. */
export function fehlerText(error: unknown, hoechstens = 500): string {
  const roh =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return roh.replace(/\s+/g, ' ').trim().slice(0, hoechstens)
}

/** Upstream statuses that mean "busy, ask again" rather than "this is wrong". */
const VORUEBERGEHENDE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529])

/**
 * Whether an error says "not now" instead of "not ever".
 *
 * This distinction decides whether an attempt is spent. A malformed answer or a
 * dataset with no rows is the row's own problem and must eventually stop being
 * retried, because every attempt is a paid call. An overloaded API is not: the
 * work is fine and would succeed ten minutes later, so burning the retry budget
 * on it strands a perfectly good run in `fehler` and demands a human who has
 * nothing to fix.
 */
export function istVoruebergehend(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const status = (error as { status?: unknown }).status
  if (typeof status === 'number' && VORUEBERGEHENDE_STATUS.has(status))
    return true

  const nachricht = error instanceof Error ? error.message : ''
  return /overloaded|rate.?limit|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i.test(
    nachricht
  )
}

export interface Laufkandidat {
  id: string
  /** Content fingerprint of the data as we last saw it. */
  letzter_stand: string | null
  /** The fingerprint a run was last opened for. */
  lauf_stand: string | null
}

/**
 * Which datasets still need a run opened.
 *
 * The queue used to be "the three oldest `relevant` datasets", and that is
 * head-of-line blocking with no way out: a dataset that can never open a run —
 * no date column, so no unambiguous period — held its seat on every tick, for
 * ever. Measured on the live database, three such seats were taken and
 * everything behind them was unreachable. No error surfaced, because a
 * scheduled operation's return value is read by nobody.
 *
 * A dataset whose `lauf_stand` matches its `letzter_stand` has been dealt with
 * for this state of the data. When the source check writes a new fingerprint,
 * it becomes a candidate again by itself — no extra bookkeeping, and no dataset
 * can hold a seat by being permanently unopenable.
 */
export function offeneLaeufe<T extends Laufkandidat>(
  kandidaten: readonly T[],
  hoechstens: number,
  /**
   * Ein Mensch hat diesen Datensatz ausdruecklich verlangt.
   *
   * Dann gilt „fuer diesen Stand erledigt" nicht: das ist Buchhaltung fuer die
   * naechtliche Warteschlange, keine Antwort auf einen Klick. Ohne diese
   * Unterscheidung verschwand „Meldungen erzeugen" wirkungslos — der Knopf tat
   * nichts und sagte auch nichts, weil der Datensatz gar nicht erst in die
   * Schleife kam.
   */
  ausdruecklich = false
): T[] {
  const offen = ausdruecklich
    ? [...kandidaten]
    : kandidaten.filter(
        (kandidat) =>
          kandidat.lauf_stand === null ||
          kandidat.lauf_stand !== kandidat.letzter_stand
      )

  return offen.slice(0, Math.max(hoechstens, 0))
}
