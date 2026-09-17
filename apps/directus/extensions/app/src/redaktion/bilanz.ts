// How much lies on which desk, and for how long — the one number the newsroom
// itself does not have.
//
// The Lagebild of 15 September named it D8: three systems wait for the same
// person. Measured on 17 September at the door: 175 published articles, 8 of
// them in the two days since, and nowhere a figure that says whether that is a
// backlog or a quiet week. The desks count their own badges, and each badge
// lives in its own component; nothing adds them up and nothing leaves the house.
//
// **This counts Meldungen, not candidates.** A candidate desk decides what is
// «open» by its own rule (`bleibtAufDemTisch` in the front, one per desk, each
// of them deliberate), and rebuilding those rules here would be a second truth
// that drifts from the first. What every desk shares is the article it produces:
// an article waiting for a signature is the bottleneck D8 is about, whatever
// desk it came from. The triage backlog is a different measurement and is not
// made here.
//
// Pure: no clock, no database, no Directus. The caller says what time it is.

/** A desk, derived from the origin row an article carries. */
export type Tisch =
  | 'statistik'
  | 'sport'
  | 'presseschau'
  | 'amtsblatt'
  | 'gemeindeseite'
  | 'sendung'
  | 'entsorgung'
  | 'ohne'

/**
 * Every desk, in the order they are reported.
 *
 * A desk with nothing on it stays in the list. Dropping it would read as «this
 * desk does not exist» rather than «this desk has nothing to do», and that
 * confusion is what let twelve silent sources live for a quarter next door.
 */
export const TISCHE: readonly Tisch[] = [
  'statistik',
  'sport',
  'presseschau',
  'amtsblatt',
  'gemeindeseite',
  'sendung',
  'entsorgung',
  'ohne'
] as const

/** The narrow slice of a Meldung this measurement reads. */
export interface BilanzZeile {
  status: string
  lauf: string | null
  spiel: string | null
  kandidat: string | null
  amtsblattmeldung: string | null
  gemeindemitteilung: string | null
  sendungskandidat: string | null
  erscheint_am: string | null
  date_created: string | null
  freigegeben_am: string | null
  publiziert_am: string | null
  zurueckgezogen_am: string | null
}

export interface TischBilanz {
  tisch: Tisch | 'alle'
  /** Waiting for a person: `entwurf` and `in_pruefung`. */
  offen: number
  /** Signed and waiting for the scheduled run — no longer anybody's decision. */
  freigegeben: number
  /** Age in whole days of the oldest waiting article, or null if none waits. */
  aeltester_tage: number | null
  publiziert_im_fenster: number
  freigegeben_im_fenster: number
  zurueckgezogen_im_fenster: number
}

export interface Bilanz {
  stand: string
  fenster_tage: number
  gesamt: TischBilanz
  tische: TischBilanz[]
}

/** Waiting for a person. `freigegeben` is not here, and that is the point. */
const WARTET = new Set(['entwurf', 'in_pruefung'])

export const FENSTER_TAGE = 7

/**
 * Which desk an article came from.
 *
 * **The order is the logic.** The six foreign keys are mutually exclusive by
 * construction, but `erscheint_am` is not one of them: it is a plain date, and
 * the schema only promises that waste reminders carry it. It therefore decides
 * last — a row that owns an origin row belongs to that desk, whatever date it
 * also carries.
 */
export function tischVon(zeile: BilanzZeile): Tisch {
  if (zeile.lauf !== null) return 'statistik'
  if (zeile.spiel !== null) return 'sport'
  if (zeile.kandidat !== null) return 'presseschau'
  if (zeile.amtsblattmeldung !== null) return 'amtsblatt'
  if (zeile.gemeindemitteilung !== null) return 'gemeindeseite'
  if (zeile.sendungskandidat !== null) return 'sendung'
  if (zeile.erscheint_am !== null) return 'entsorgung'
  return 'ohne'
}

function tage(von: string, bis: string): number | null {
  const anfang = Date.parse(von)
  const ende = Date.parse(bis)
  if (!Number.isFinite(anfang) || !Number.isFinite(ende)) return null
  return Math.floor((ende - anfang) / 86_400_000)
}

function imFenster(stempel: string | null, ab: number): boolean {
  if (stempel === null) return false
  const zeitpunkt = Date.parse(stempel)
  return Number.isFinite(zeitpunkt) && zeitpunkt >= ab
}

function leer(tisch: Tisch | 'alle'): TischBilanz {
  return {
    tisch,
    offen: 0,
    freigegeben: 0,
    aeltester_tage: null,
    publiziert_im_fenster: 0,
    freigegeben_im_fenster: 0,
    zurueckgezogen_im_fenster: 0
  }
}

/**
 * The balance over a set of Meldungen.
 *
 * **Only stamps that exist are counted.** `verworfen` has no timestamp of its
 * own, so a discarded article cannot be placed in a window without guessing —
 * `date_updated` would call any later save a decision. It is therefore not
 * reported at all rather than reported wrongly. Whoever wants that number adds
 * the column first.
 */
export function redaktionsbilanz(
  zeilen: readonly BilanzZeile[],
  { jetzt, fensterTage = FENSTER_TAGE }: { jetzt: string; fensterTage?: number }
): Bilanz {
  const ab = Date.parse(jetzt) - fensterTage * 86_400_000
  const je = new Map<Tisch, TischBilanz>(TISCHE.map((t) => [t, leer(t)]))
  const gesamt = leer('alle')

  for (const zeile of zeilen) {
    const zeilen_bilanz = je.get(tischVon(zeile))
    if (zeilen_bilanz === undefined) continue
    for (const ziel of [zeilen_bilanz, gesamt]) {
      if (WARTET.has(zeile.status)) ziel.offen += 1
      if (zeile.status === 'freigegeben') ziel.freigegeben += 1
      if (imFenster(zeile.publiziert_am, ab)) ziel.publiziert_im_fenster += 1
      if (imFenster(zeile.freigegeben_am, ab)) ziel.freigegeben_im_fenster += 1
      if (imFenster(zeile.zurueckgezogen_am, ab))
        ziel.zurueckgezogen_im_fenster += 1
    }
    if (!WARTET.has(zeile.status) || zeile.date_created === null) continue
    const alter = tage(zeile.date_created, jetzt)
    if (alter === null) continue
    for (const ziel of [zeilen_bilanz, gesamt]) {
      if (ziel.aeltester_tage === null || alter > ziel.aeltester_tage)
        ziel.aeltester_tage = alter
    }
  }

  return {
    stand: jetzt,
    fenster_tage: fensterTage,
    gesamt,
    tische: TISCHE.map((t) => je.get(t) ?? leer(t))
  }
}
