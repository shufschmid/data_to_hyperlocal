// The two addresses a municipality's own website is read at, and the one rule
// they share: the page is READ BEFORE IT IS WRITTEN.
//
// A mistyped address should fail the form, not become a row that errors every
// day at one. That rule was the news page's from the start; the events page
// gets the same one rather than a second, gentler one — which is why both
// routes are this function with a different `art`.
//
// The kind of page also travels into the read, because the two templates are
// told apart from the HTML: an events address pasted into the news field is
// caught at the form, not discovered weeks later as an empty desk.

import type { Seitenart } from '../../shared/gemeindeseite'

export type { Seitenart }

export interface AdressFeld {
  /** The column on `gemeinden` this kind of page lives in. */
  spalte: 'news_url' | 'veranstaltungen_url'
  /** What the form and the error messages call it, in German. */
  bezeichnung: string
}

export const ADRESSFELDER: Record<Seitenart, AdressFeld> = {
  nachricht: { spalte: 'news_url', bezeichnung: 'Newsuebersicht' },
  termin: {
    spalte: 'veranstaltungen_url',
    bezeichnung: 'Veranstaltungsuebersicht'
  }
}

export interface AdressDienst {
  updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
}

export interface AdressEingabe {
  art: Seitenart
  /** Whatever the request body carried — anything but a string counts as empty. */
  roh: unknown
  id: string
  gemeinden: AdressDienst
  /** Reads the overview and answers how many entries it names; throws when it cannot. */
  liesSeite: (adresse: string, art: Seitenart) => Promise<number>
}

export type AdressErgebnis =
  | { status: 'geleert' }
  | { status: 'gesetzt'; adresse: string; gefunden: number }
  | { status: 'ungueltig'; grund: string }
  | { status: 'nicht_lesbar'; grund: string }

function fehlerText(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : 'Die Seite konnte nicht gelesen werden.'
}

/**
 * The two status lines are the NEWS page's, not the municipality's second
 * page: they are cleared when the news address changes, and left alone
 * otherwise, so a stored events address never wipes a real error the news read
 * wrote. Both go together — a cap declared on yesterday's page says nothing
 * about the one that was just entered.
 */
function nutzlast(
  art: Seitenart,
  wert: string | null
): Record<string, unknown> {
  const feld = { [ADRESSFELDER[art].spalte]: wert }
  return art === 'nachricht'
    ? { ...feld, news_letzter_fehler: null, news_letzter_hinweis: null }
    : feld
}

export async function speichereAdresse(
  eingabe: AdressEingabe
): Promise<AdressErgebnis> {
  const adresse = typeof eingabe.roh === 'string' ? eingabe.roh.trim() : ''

  if (adresse === '') {
    await eingabe.gemeinden.updateOne(eingabe.id, nutzlast(eingabe.art, null))
    return { status: 'geleert' }
  }
  if (!/^https?:\/\/\S+$/i.test(adresse)) {
    return {
      status: 'ungueltig',
      grund: 'Das ist keine Web-Adresse (https://…).'
    }
  }

  let gefunden: number
  try {
    gefunden = await eingabe.liesSeite(adresse, eingabe.art)
  } catch (fehler) {
    return { status: 'nicht_lesbar', grund: fehlerText(fehler) }
  }

  await eingabe.gemeinden.updateOne(eingabe.id, nutzlast(eingabe.art, adresse))
  return { status: 'gesetzt', adresse, gefunden }
}
