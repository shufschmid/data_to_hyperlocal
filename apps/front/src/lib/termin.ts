// Der Termin einer Meldung auf dem Tisch — was die Karte zeigt und was sie an
// den Endpunkt schickt. Pur, damit die Regeln pruefbar sind.
//
// Was der Dorfkoenig damit macht, steht in apps/directus/SCHNITTSTELLE.md
// („Termin und Auftritte"): `ideal` ist der Tag, an dem die Meldung fuer die
// Leserin zaehlt, `ende` der letzte Tag, an dem sie noch Sinn hat, `auftritte`
// die Lesetage im Briefing. Ohne Auftritte bringt er sie einmal, am Werktag
// vor `ideal`. Bei einem WICHTIGEN Anlass kommt „sofort" dazu — der erste
// Lesetag nach der Publikation, den rechnet die Auslieferung.

export interface Termin {
  ideal: string
  ende: string
  auftritte: string[]
}

/** Was die Karte an `POST /meldungen/:id/termin` schickt. */
export interface TerminEingabe {
  ideal: string | null
  ende: string | null
  auftritte: string[]
  wichtig: boolean
}

const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/

export function istIsoTag(wert: unknown): wert is string {
  return typeof wert === 'string' && ISO_TAG.test(wert)
}

/** `2026-10-17` → `17.10.2026` — knapp, fuer eine Zeile mit mehreren Tagen. */
export function kurzesDatum(iso: string): string {
  const [j, m, t] = iso.split('-')
  if (j === undefined || m === undefined || t === undefined) return iso
  return `${t}.${m}.${j}`
}

/** Die Eingabe, wie sie aus der gespeicherten Zeile kommt — leer, wenn nichts gesetzt ist. */
export function eingabeAus(termin: Termin | null, wichtig: boolean | null): TerminEingabe {
  return {
    ideal: termin?.ideal ?? null,
    ende: termin?.ende ?? null,
    auftritte: termin === null ? [] : [...termin.auftritte],
    wichtig: wichtig === true
  }
}

/**
 * Die eine Zeile ueber dem Artikel: Termin, Ende, Auftritte — oder dass es
 * keinen gibt und der Dorfkoenig das Datum weiterhin aus dem Text liest.
 */
export function terminSatz(termin: Termin | null, wichtig: boolean | null): string {
  if (termin === null) return 'Kein Termin — der Dorfkönig liest das Datum aus dem Text.'
  const teile = [`Termin ${kurzesDatum(termin.ideal)}`]
  if (termin.ende !== termin.ideal) teile.push(`bis ${kurzesDatum(termin.ende)}`)
  const tage = termin.auftritte.map(kurzesDatum)
  if (wichtig === true) {
    teile.push(`wichtig: Auftritte sofort nach Publikation${tage.length === 0 ? '' : `, ${tage.join(', ')}`}`)
  } else if (tage.length > 0) {
    teile.push(`Auftritte ${tage.join(', ')}`)
  } else {
    teile.push('ein Auftritt am Werktag davor')
  }
  return teile.join(' · ')
}

/** Ob die Redaktion vom Vorschlag des Laufs abgewichen ist — das ist das Lernsignal. */
export function weichtAb(
  termin: Termin | null,
  vorschlag: Termin | null,
  wichtig: boolean | null,
  wichtigVorschlag: boolean | null
): boolean {
  if ((wichtig === true) !== (wichtigVorschlag === true)) return true
  if (termin === null && vorschlag === null) return false
  if (termin === null || vorschlag === null) return true
  return (
    termin.ideal !== vorschlag.ideal ||
    termin.ende !== vorschlag.ende ||
    termin.auftritte.join(',') !== vorschlag.auftritte.join(',')
  )
}

/**
 * Was beim Umschalten von „wichtig" mit den Auftritten passiert: einschalten
 * ohne Liste setzt den Termin selbst als Auftritt, ausschalten leert sie —
 * dann gilt wieder die Standardregel. Eine von Hand gefuellte Liste bleibt.
 */
export function auftritteBeimUmschalten(
  auftritte: readonly string[],
  wichtig: boolean,
  ideal: string | null
): string[] {
  if (wichtig) {
    if (auftritte.length > 0) return [...auftritte]
    return ideal === null ? [] : [ideal]
  }
  return []
}

/** Der Fehler, den die Karte zeigt, bevor sie schickt — dieselben Regeln wie der Endpunkt. */
export function pruefeEingabe(e: TerminEingabe): string | null {
  if (e.ideal === null || e.ideal === '') {
    if (e.ende !== null && e.ende !== '') return 'Ein Ende braucht einen Termin.'
    if (e.auftritte.length > 0) return 'Auftritte brauchen einen Termin.'
    return null
  }
  if (!istIsoTag(e.ideal)) return 'Der Termin ist kein gültiges Datum.'
  if (e.ende !== null && e.ende !== '') {
    if (!istIsoTag(e.ende)) return 'Das Ende ist kein gültiges Datum.'
    if (e.ende < e.ideal) return 'Das Ende liegt vor dem Termin.'
  }
  const ende = e.ende === null || e.ende === '' ? e.ideal : e.ende
  for (const a of e.auftritte) {
    if (!istIsoTag(a)) return `Der Auftritt «${a}» ist kein gültiges Datum.`
    if (a > ende) return `Der Auftritt ${kurzesDatum(a)} liegt nach dem Ende.`
  }
  if (new Set(e.auftritte).size > 5) return 'Höchstens fünf Auftritte.'
  return null
}
