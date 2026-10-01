// Was die Modellaufrufe kosten — die Antwort von GET /redaktion/verbrauch,
// und wie die Karte sie zeigt. Seit 1.10.2026 in Geld (die Preise je Modell
// pflegt die Redaktion in derselben Karte) und mit Modell und Etat je Zweck,
// die sie dort auch umstellt.

export interface VerbrauchsSumme {
  aufrufe: number
  eingabe_tokens: number
  ausgabe_tokens: number
  cache_gelesen_tokens: number
  cache_geschrieben_tokens: number
  abgebrochen: number
  fehler: number
  kosten: number
  ohne_preis: number
}

export interface VerbrauchJeZweck extends VerbrauchsSumme {
  zweck: string
  modell_zuletzt: string | null
  max_tokens_zuletzt: number | null
  ausgabe_max: number
}

export interface VerbrauchJeTisch extends VerbrauchsSumme {
  tisch: string
  modelle: Array<VerbrauchsSumme & { modell: string }>
  zwecke: VerbrauchJeZweck[]
}

export interface Modellpreis {
  modell: string
  eingabe_je_mio: number
  ausgabe_je_mio: number
  cache_lesen_je_mio: number
  cache_schreiben_je_mio: number
  waehrung: string
  quelle: string | null
}

export interface Modelleinstellung {
  zweck: string
  modell: string | null
  max_tokens: number | null
  notiz: string | null
}

export interface ModellWahl {
  id: string
  name: string
  hinweis: string
}

export interface VerbrauchsBilanz {
  tage: number
  waehrung: string | null
  gesamt: VerbrauchsSumme
  tische: VerbrauchJeTisch[]
  ohnePreis: string[]
  preise: Modellpreis[]
  einstellungen: Modelleinstellung[]
  modelle: ModellWahl[]
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

/** 0.0847 USD → «0.08 USD»; unter einem Rappen die dritte Stelle, damit Kleines nicht als null erscheint. */
export function betrag(n: number, waehrung: string | null): string {
  if (waehrung === null) return '–'
  const stellen = n > 0 && n < 0.01 ? 3 : 2
  return `${n.toLocaleString('de-CH', { minimumFractionDigits: stellen, maximumFractionDigits: stellen })} ${waehrung}`
}

/**
 * Was die Zeile eines Tischs an Warnung traegt: abgebrochene Antworten sind
 * bezahlt und verworfen, Fehler sind Aufrufe ohne Antwort — beides ist Geld
 * fuer nichts und darum rot, nicht grau.
 */
export function verlustText(s: Pick<VerbrauchsSumme, 'abgebrochen' | 'fehler'>): string | null {
  const teile: string[] = []
  if (s.abgebrochen > 0) teile.push(`${s.abgebrochen} abgebrochen`)
  if (s.fehler > 0) teile.push(`${s.fehler} gescheitert`)
  return teile.length === 0 ? null : teile.join(', ')
}

/** Die Einstellung, die fuer einen Zweck gilt: genau der Zweck, sonst sein Tisch, sonst keine. */
export function einstellungFuer(
  einstellungen: readonly Modelleinstellung[],
  zweck: string
): Modelleinstellung | null {
  const tisch = zweck.includes(':') ? zweck.slice(0, zweck.indexOf(':')) : zweck
  return einstellungen.find((e) => e.zweck === zweck) ?? einstellungen.find((e) => e.zweck === tisch) ?? null
}

/** Ob der Etat eines Zwecks knapp ist: die groesste Antwort kam nahe an die Grenze, oder eine brach ab. */
export function etatKnapp(
  z: Pick<VerbrauchJeZweck, 'max_tokens_zuletzt' | 'ausgabe_max' | 'abgebrochen'>
): boolean {
  if (z.abgebrochen > 0) return true
  if (z.max_tokens_zuletzt === null || z.max_tokens_zuletzt <= 0) return false
  return z.ausgabe_max / z.max_tokens_zuletzt >= 0.9
}
