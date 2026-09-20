// From calendar rows to Anlässe — the grouping that turns 402 rows into the
// eleven things that actually happen in Arlesheim next week.

import type { ListenEintrag } from '../gemeindeseite/liste'
import { serienSchluessel, startZeit } from './schluessel'

export interface Anlass {
  schluessel: string
  titel: string
  /** Every distinct day the rows name, ascending. A span contributes its first and last day. */
  termine: string[]
  von: string
  /** Last known day; null when there is only one. */
  bis: string | null
  /** The source printed a span (von–bis) rather than one row per day. */
  spanne: boolean
  zeit: string | null
  lokalitaet: string | null
  ort: string | null
  veranstalter: string | null
  kategorie: string | null
  teaser: string | null
  /** The page of the first upcoming date — what the desk and the source line show. */
  url: string
  eintraege: ListenEintrag[]
  abgesagt: boolean
  /** The series' first day, where the markup says it (Backslash). */
  serieSeit: string | null
}

const erster = <T>(werte: readonly (T | null)[]): T | null =>
  werte.find((w): w is T => w !== null && w !== '') ?? null

function baue(schluessel: string, rows: readonly ListenEintrag[]): Anlass {
  const datiert = rows
    .filter((r) => r.veranstaltungAm !== null)
    .sort((a, b) =>
      (a.veranstaltungAm ?? '').localeCompare(b.veranstaltungAm ?? '')
    )
  const geordnet = datiert.length > 0 ? datiert : [...rows]
  const tage = new Set<string>()
  let spanne = false
  for (const r of rows) {
    if (r.veranstaltungAm !== null) tage.add(r.veranstaltungAm)
    if (r.veranstaltungBis !== null) {
      tage.add(r.veranstaltungBis)
      spanne = true
    }
  }
  const termine = [...tage].sort()
  const von = termine[0] ?? ''
  const letzter = termine[termine.length - 1] ?? null
  const kopf = geordnet[0] as ListenEintrag
  return {
    schluessel,
    titel: kopf.titel,
    termine,
    von,
    bis: letzter !== null && letzter !== von ? letzter : null,
    spanne,
    zeit: erster(geordnet.map((r) => r.zeit)),
    lokalitaet: erster(geordnet.map((r) => r.lokalitaet)),
    ort: erster(geordnet.map((r) => r.ort)),
    veranstalter: erster(geordnet.map((r) => r.veranstalter)),
    kategorie: erster(geordnet.map((r) => r.kategorie)),
    teaser: erster(geordnet.map((r) => r.teaser)),
    url: kopf.url,
    eintraege: geordnet,
    abgesagt: rows.some((r) => r.abgesagt),
    serieSeit: erster(geordnet.map((r) => r.serieSeit))
  }
}

/**
 * Groups rows by series key. A group whose rows fall on the SAME day at
 * different times is two groups (the time joins the key); otherwise the time
 * stays out of it, so a two-day fair with different hours on each day is one
 * Anlass. Rows without a date are grouped like the others — the window
 * decides what happens to them, not the grouping.
 */
export function gruppiereAnlaesse(
  eintraege: readonly ListenEintrag[]
): Anlass[] {
  const gruppen = new Map<string, ListenEintrag[]>()
  for (const e of eintraege) {
    const schluessel = serienSchluessel(e)
    const gruppe = gruppen.get(schluessel)
    if (gruppe === undefined) gruppen.set(schluessel, [e])
    else gruppe.push(e)
  }

  const anlaesse: Anlass[] = []
  for (const [schluessel, rows] of gruppen) {
    if (!gleicherTagAndereZeit(rows)) {
      anlaesse.push(baue(schluessel, rows))
      continue
    }
    const nachZeit = new Map<string, ListenEintrag[]>()
    for (const r of rows) {
      const feiner = serienSchluessel(r, true)
      const gruppe = nachZeit.get(feiner)
      if (gruppe === undefined) nachZeit.set(feiner, [r])
      else gruppe.push(r)
    }
    for (const [feiner, teil] of nachZeit) anlaesse.push(baue(feiner, teil))
  }
  return anlaesse
}

function gleicherTagAndereZeit(rows: readonly ListenEintrag[]): boolean {
  const zeitJeTag = new Map<string, string>()
  for (const r of rows) {
    if (r.veranstaltungAm === null) continue
    const zeit = startZeit(r.zeit)
    const bekannt = zeitJeTag.get(r.veranstaltungAm)
    if (bekannt === undefined) zeitJeTag.set(r.veranstaltungAm, zeit)
    else if (bekannt !== zeit && bekannt !== '' && zeit !== '') return true
  }
  return false
}

/** The next date on or after `heute`, or null when every date is past. */
export function naechsterTermin(
  termine: readonly string[],
  heute: string
): string | null {
  return termine.find((t) => t >= heute) ?? null
}
