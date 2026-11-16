// Auto-Publish: a run publishes the drafts it has just written — on the desks
// where the newsroom switched that on.
//
// The newsroom on 16 November 2026: several desks work well enough that their
// proposals may go out without a click; the option exists per desk and each
// is switched on by itself («Gelerntes» → «Tische»). What goes out stays
// visible on its desk and can be taken back by hand.
//
// Four rules, each a line of code below:
//
// - **Only what THIS run wrote.** The writers hand over the ids of the
//   drafts they created; nothing older is touched. Switching the option on
//   therefore never publishes a backlog, and a draft an editor asked for or
//   revised is hers.
// - **Only a draft without a warning.** A warning is a check that found
//   something; a person reads it before the article leaves the house.
// - **Through the status hook, one row at a time.** The state machine judges
//   an automatic publication like any other, and a refusal is named.
// - **Signed as what it is.** `publiziert_durch: 'automatik'` — the
//   Pruefsiegel says `automatisch`, never `redaktion`.
//
// Off is the default, and an unreadable setting is OFF: a dial that cannot be
// read must never publish.

export type AutoTisch =
  | 'gemeinde'
  | 'kanton'
  | 'buschtelefon'
  | 'sport'
  | 'abstimmung'

/** The desks whose run writes its own drafts — the only ones with something to publish. */
export const AUTO_TISCHE: readonly AutoTisch[] = [
  'gemeinde',
  'kanton',
  'buschtelefon',
  'sport',
  'abstimmung'
]

export function istAutoTisch(wert: unknown): wert is AutoTisch {
  return (
    typeof wert === 'string' &&
    (AUTO_TISCHE as readonly string[]).includes(wert)
  )
}

interface LeseDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
}

interface MeldungsDienst extends LeseDienst {
  updateOne(
    key: string,
    payload: Record<string, unknown>
  ): Promise<string | number>
}

type Protokoll = { warn: (fehler: unknown, text?: string) => void }

/** Whether the newsroom switched Auto-Publish on for this desk. Anything else than a stored `true` is off. */
export async function ladeAutoPublizieren(
  einstellungen: LeseDienst,
  tisch: AutoTisch,
  logger: Protokoll
): Promise<boolean> {
  try {
    const [zeile] = (await einstellungen.readByQuery({
      filter: { tisch: { _eq: tisch } },
      fields: ['auto_publizieren'],
      limit: 1
    })) as Array<{ auto_publizieren?: unknown }>
    return zeile?.auto_publizieren === true
  } catch (fehler) {
    logger.warn(
      fehler,
      `auto-publish: Einstellung ${tisch} nicht lesbar — bleibt aus.`
    )
    return false
  }
}

export interface AutoKandidat {
  id: string
  status: string
  zeit_warnungen: string[] | null
}

/** Why a draft stays on the desk — null when it may go out. */
export function haltegrund(meldung: AutoKandidat): string | null {
  if (meldung.status !== 'entwurf') return `Status ${meldung.status}`
  const warnungen = meldung.zeit_warnungen?.length ?? 0
  if (warnungen > 0)
    return warnungen === 1 ? '1 Warnung' : `${warnungen} Warnungen`
  return null
}

export interface AutoErgebnis {
  /** Ids that went out. */
  publiziert: string[]
  /** Drafts that stay for a person, with the reason — counted, never silent. */
  zurueckgehalten: Array<{ id: string; grund: string }>
}

/**
 * Publishes the drafts a run has just written, where the desk allows it.
 * Never throws: an article that cannot go out stays a draft and is named.
 */
export async function publiziereAutomatisch(
  dienste: {
    meldungen: MeldungsDienst
    einstellungen: LeseDienst
    logger: Protokoll
  },
  tisch: AutoTisch,
  ids: readonly string[]
): Promise<AutoErgebnis> {
  const ergebnis: AutoErgebnis = { publiziert: [], zurueckgehalten: [] }
  if (ids.length === 0) return ergebnis
  if (
    !(await ladeAutoPublizieren(dienste.einstellungen, tisch, dienste.logger))
  )
    return ergebnis

  let kandidaten: AutoKandidat[]
  try {
    kandidaten = (await dienste.meldungen.readByQuery({
      filter: { id: { _in: [...ids] } },
      fields: ['id', 'status', 'zeit_warnungen'],
      limit: -1
    })) as AutoKandidat[]
  } catch (fehler) {
    dienste.logger.warn(fehler, `auto-publish: ${tisch} nicht lesbar.`)
    return ergebnis
  }

  for (const meldung of kandidaten) {
    const grund = haltegrund(meldung)
    if (grund !== null) {
      ergebnis.zurueckgehalten.push({ id: meldung.id, grund })
      continue
    }
    try {
      await dienste.meldungen.updateOne(meldung.id, {
        status: 'publiziert',
        publiziert_durch: 'automatik'
      })
      ergebnis.publiziert.push(meldung.id)
    } catch (fehler) {
      ergebnis.zurueckgehalten.push({
        id: meldung.id,
        grund: fehler instanceof Error ? fehler.message : 'abgewiesen'
      })
    }
  }
  return ergebnis
}

/** One line for a run's hints; null when Auto-Publish did nothing. */
export function autoHinweis(ergebnis: AutoErgebnis): string | null {
  const raus = ergebnis.publiziert.length
  const bleibt = ergebnis.zurueckgehalten.length
  if (raus === 0 && bleibt === 0) return null
  const teile = [
    `Auto-Publish: ${raus} ${raus === 1 ? 'Meldung' : 'Meldungen'} publiziert`
  ]
  if (bleibt > 0)
    teile.push(
      `${bleibt} ${bleibt === 1 ? 'bleibt' : 'bleiben'} als Entwurf (Warnung oder abgewiesen)`
    )
  return `${teile.join(', ')}.`
}
