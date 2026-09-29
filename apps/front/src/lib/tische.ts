import type { TischeinstellungFelder } from '@/graphql/redaktion'

// Die Einstellungen eines Tischs, wie der Arbeitsplatz sie liest — der
// Spiegel von `redaktion/tischeinstellungen.ts` im Backend, und aus demselben
// Grund pur: die Sichtung BENOTET (1–4), ab welcher Stufe etwas zuoberst
// liegt, stellt die Redaktion ein. Weil die Stufe auf der Zeile steht, wirkt
// ein Umstellen sofort — der Tisch rechnet dieselbe Regel wie der Lauf.

export interface Tischeinstellung {
  /** Ab dieser Stufe ist eine Zeile ein Vorschlag. */
  schwelle: number
  /** Tage vor dem Anker, ab denen eine Zeile dieser Stufe auf den Tisch kommt — nur Veranstaltungen. */
  vorlauf: Record<2 | 3 | 4, number>
  dauerangebote_je_woche: number
}

export const STANDARD_EINSTELLUNG: Tischeinstellung = {
  schwelle: 3,
  vorlauf: { 4: 30, 3: 10, 2: 5 },
  dauerangebote_je_woche: 1
}

/** Die vier Stellungen des Reglers, wie sie hinter dem Zahnrad heissen. */
export const SCHWELLEN: ReadonlyArray<{ wert: number; text: string }> = [
  { wert: 4, text: 'Nur Wichtiges (Stufe 4)' },
  { wert: 3, text: 'Normal (ab Stufe 3)' },
  { wert: 2, text: 'Grosszügig (ab Stufe 2)' },
  { wert: 1, text: 'Alles (ab Stufe 1)' }
]

export const EINSTELLBARE_TISCHE: ReadonlyArray<{ wert: 'gemeinde' | 'veranstaltung'; text: string }> = [
  { wert: 'gemeinde', text: 'Gemeindeseiten' },
  { wert: 'veranstaltung', text: 'Veranstaltungen' }
]

const STUFEN_TEXT: Record<number, string> = {
  4: 'wichtig',
  3: 'klare Meldung',
  2: 'möglich',
  1: 'Routine'
}

/** Wie eine Stufe auf der Zeile heisst; null ohne Note. */
export function stufeText(wert: number | null | undefined): string | null {
  if (wert == null) return null
  const text = STUFEN_TEXT[wert]
  return text === undefined ? `Stufe ${wert}` : `Stufe ${wert} · ${text}`
}

function ganzzahl(wert: unknown, von: number, bis: number): number | null {
  if (typeof wert !== 'number' || !Number.isInteger(wert)) return null
  return wert < von || wert > bis ? null : wert
}

/** Die Einstellung eines Tischs aus den gelesenen Zeilen — je Feld der Standard, wo nichts steht. */
export function einstellungFuer(zeilen: readonly TischeinstellungFelder[], tisch: string): Tischeinstellung {
  const zeile = zeilen.find((z) => z.tisch === tisch)
  if (zeile === undefined) return STANDARD_EINSTELLUNG
  const s = STANDARD_EINSTELLUNG
  return {
    schwelle: ganzzahl(zeile.schwelle, 1, 4) ?? s.schwelle,
    vorlauf: {
      4: ganzzahl(zeile.vorlauf_stufe4, 0, 120) ?? s.vorlauf[4],
      3: ganzzahl(zeile.vorlauf_stufe3, 0, 120) ?? s.vorlauf[3],
      2: ganzzahl(zeile.vorlauf_stufe2, 0, 120) ?? s.vorlauf[2]
    },
    dauerangebote_je_woche: ganzzahl(zeile.dauerangebote_je_woche, 0, 7) ?? s.dauerangebote_je_woche
  }
}

/** Eine benotete Zeile ist ein Vorschlag ab der Schwelle; eine unbenotete nie nach dieser Regel. */
export function istVorschlag(wert: number | null | undefined, schwelle: number): boolean {
  return wert != null && wert >= schwelle
}

/** Der Vorlauf einer Stufe; Stufe 1 nimmt den kuerzesten, eine unbenotete Zeile den normalen. */
export function vorlaufFuer(wert: number | null | undefined, einstellung: Tischeinstellung): number {
  if (wert === 4) return einstellung.vorlauf[4]
  if (wert === 2 || wert === 1) return einstellung.vorlauf[2]
  return einstellung.vorlauf[3]
}

function verschiebe(tag: string, tage: number): string {
  const d = new Date(`${tag.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + tage)
  return d.toISOString().slice(0, 10)
}

/** Im Vorlauf: von `Vorlauf` Tagen vor dem Anker bis zum Anker selbst. */
export function imVorlauf(
  ankerAm: string | null,
  wert: number | null | undefined,
  heute: string,
  einstellung: Tischeinstellung
): boolean {
  if (ankerAm === null) return false
  return verschiebe(ankerAm, -vorlaufFuer(wert, einstellung)) <= heute && heute <= ankerAm
}

/** Die Regel des Veranstaltungstischs: hoch genug benotet UND im Vorlauf dieser Stufe. */
export function anlassVorschlag(
  zeile: { vorschlag_wert?: number | null; anker_am: string | null },
  heute: string,
  einstellung: Tischeinstellung
): boolean {
  return (
    istVorschlag(zeile.vorschlag_wert, einstellung.schwelle) &&
    imVorlauf(zeile.anker_am, zeile.vorschlag_wert, heute, einstellung)
  )
}
