// Registering a calendar — the one rule it shares with every other address in
// the house: the page is READ BEFORE IT IS WRITTEN. A mistyped address fails
// the form, not tomorrow's run; a news page pasted as a calendar is told apart
// by its template at the form, not weeks later as a desk that never has
// anything.
//
// A platform or a venue (Crossiety, kalländer, riehenevents, the Z7) can be
// registered today and is read by nobody yet: the row is created INACTIVE and
// says so, so the newsroom's list of calendars is complete before the readers
// are.

import type { Plattform } from '../../shared/gemeindeseite'
import type { VeranstaltungsquelleArt } from '../../types/schema'

export interface QuelleEingabe {
  /** The request body, whatever it carried. */
  roh: unknown
  /** Reads the overview and answers what template it is and how many rows it names; throws when it cannot. */
  liesSeite: (
    adresse: string
  ) => Promise<{ plattform: Plattform; gefunden: number }>
}

export type QuelleErgebnis =
  | { status: 'ungueltig'; grund: string }
  | { status: 'nicht_lesbar'; grund: string }
  | {
      status: 'geprueft'
      felder: {
        url: string
        name: string
        art: VeranstaltungsquelleArt
        aktiv: boolean
        plattform: Plattform | null
        letzter_hinweis: string | null
      }
      gefunden: number
    }

const ARTEN: readonly VeranstaltungsquelleArt[] = [
  'gemeinde',
  'plattform',
  'ort'
]

function fehlerText(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : 'Die Seite konnte nicht gelesen werden.'
}

/** The name a calendar of the municipality's own site gets when the editor gave none. */
export function standardName(
  art: VeranstaltungsquelleArt,
  gemeinde: string,
  url: string
): string {
  if (art === 'gemeinde')
    return `Veranstaltungskalender der Gemeinde ${gemeinde}`
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export async function pruefeQuelle(
  eingabe: QuelleEingabe,
  gemeinde: string
): Promise<QuelleErgebnis> {
  const koerper = (eingabe.roh ?? {}) as Record<string, unknown>
  const url = typeof koerper['url'] === 'string' ? koerper['url'].trim() : ''
  if (!/^https?:\/\/\S+$/i.test(url))
    return {
      status: 'ungueltig',
      grund: 'Das ist keine Web-Adresse (https://…).'
    }
  const art = (
    typeof koerper['art'] === 'string' &&
    ARTEN.includes(koerper['art'] as VeranstaltungsquelleArt)
      ? koerper['art']
      : 'gemeinde'
  ) as VeranstaltungsquelleArt
  const name =
    typeof koerper['name'] === 'string' && koerper['name'].trim() !== ''
      ? koerper['name'].trim().slice(0, 200)
      : standardName(art, gemeinde, url)

  if (art !== 'gemeinde') {
    return {
      status: 'geprueft',
      felder: {
        url,
        name,
        art,
        aktiv: false,
        plattform: null,
        letzter_hinweis:
          'Plattform-Kalender: noch kein Leser — erfasst, aber nicht gelesen.'
      },
      gefunden: 0
    }
  }

  let gelesen: { plattform: Plattform; gefunden: number }
  try {
    gelesen = await eingabe.liesSeite(url)
  } catch (fehler) {
    return { status: 'nicht_lesbar', grund: fehlerText(fehler) }
  }
  return {
    status: 'geprueft',
    felder: {
      url,
      name,
      art,
      aktiv: true,
      plattform: gelesen.plattform,
      letzter_hinweis: null
    },
    gefunden: gelesen.gefunden
  }
}

/** What the "edit" route accepts: the switch and the name, nothing else. */
export function pruefeQuellenAenderung(
  roh: unknown
): Record<string, unknown> | null {
  const koerper = (roh ?? {}) as Record<string, unknown>
  const aenderung: Record<string, unknown> = {}
  if (typeof koerper['aktiv'] === 'boolean')
    aenderung['aktiv'] = koerper['aktiv']
  if (typeof koerper['name'] === 'string' && koerper['name'].trim() !== '')
    aenderung['name'] = koerper['name'].trim().slice(0, 200)
  return Object.keys(aenderung).length === 0 ? null : aenderung
}
