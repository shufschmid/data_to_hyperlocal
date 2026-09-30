// Was die Modellaufrufe kosten — die Antwort von GET /redaktion/verbrauch,
// und wie die Karte sie zeigt. Tokens, keine Franken: Preise leben in
// niemandes Code, eine Leserin multipliziert.

export interface VerbrauchsSumme {
  aufrufe: number
  eingabe_tokens: number
  ausgabe_tokens: number
  cache_gelesen_tokens: number
  cache_geschrieben_tokens: number
  abgebrochen: number
  fehler: number
}

export interface VerbrauchJeTisch extends VerbrauchsSumme {
  tisch: string
  modelle: Array<VerbrauchsSumme & { modell: string }>
  zwecke: Array<VerbrauchsSumme & { zweck: string }>
}

export interface VerbrauchsBilanz {
  tage: number
  gesamt: VerbrauchsSumme
  tische: VerbrauchJeTisch[]
}

/** Wie der Tisch auf der Karte heisst — der Schluessel ist der Teil des Zwecks vor dem Doppelpunkt. */
export const TISCH_NAMEN: Readonly<Record<string, string>> = {
  statistik: 'data to hyperlocal',
  sport: 'Sportresultate',
  entsorgung: 'Entsorgung',
  wochenblaetter: 'Wochenblätter',
  amtsblatt: 'Amtsblatt',
  gemeindeseiten: 'Gemeindeseiten',
  veranstaltungen: 'Veranstaltungen',
  kanton: 'Kanton',
  sendung: 'Regionaljournal / punkt6',
  regionaljournal: 'Regionaljournal',
  punkt6: 'punkt6',
  abstimmungen: 'Abstimmungen',
  suedanflug: 'Südanflug',
  lernen: 'Lernschicht',
  unbekannt: 'ohne Zuordnung'
}

export function tischName(tisch: string): string {
  return TISCH_NAMEN[tisch] ?? tisch
}

/** 1234567 → «1,2 Mio.», 45678 → «45,7 k», 999 → «999» — Tokens sind Groessenordnungen, keine Buchhaltung. */
export function tokensKurz(n: number): string {
  if (!Number.isFinite(n)) return '–'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} Mio.`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1).replace('.', ',')} k`
  return n.toLocaleString('de-CH')
}

/**
 * Was die Zeile eines Tischs an Warnung traegt: abgebrochene Antworten sind
 * bezahlt und verworfen, Fehler sind Aufrufe ohne Antwort — beides ist Geld
 * fuer nichts und darum rot, nicht grau.
 */
export function verlustText(s: VerbrauchsSumme): string | null {
  const teile: string[] = []
  if (s.abgebrochen > 0) teile.push(`${s.abgebrochen} abgebrochen`)
  if (s.fehler > 0) teile.push(`${s.fehler} gescheitert`)
  return teile.length === 0 ? null : teile.join(', ')
}
