// Das Vierzehn-Tage-Fenster des Arbeitsplatzes.
//
// Die Redaktion am 16. November 2026: der Cheftisch leert sich nie — dort
// lagen 124 offene Fährten, 98 davon älter als zwei Wochen, und der Zähler
// stand auf 99+. Was vierzehn Tage unentschieden liegt, geht ins ARCHIV: es
// bleibt eine Zeile mit all ihren Knöpfen, einen Klick entfernt, aber der
// Tisch zeigt es nicht mehr und der Zähler zählt es nicht mehr. Dasselbe
// Fenster gilt für die zwei Sendungen: geladen werden die letzten vierzehn
// Tage, der Rest auf Verlangen.
//
// Nichts wird gelöscht oder im Status verändert — das Archiv ist eine Ansicht.
// Eine Zeile ohne Datum gilt als aktuell: ein unbekanntes Alter versteckt nie.

export const ARCHIV_TAGE = 14

/** Älter als das Fenster — nach dem Zeitpunkt, an dem die Zeile entstand. */
export function istArchiv(
  entstanden: string | null | undefined,
  heute: Date = new Date(),
  tage: number = ARCHIV_TAGE
): boolean {
  if (entstanden == null) return false
  const zeit = Date.parse(entstanden)
  if (Number.isNaN(zeit)) return false
  return zeit < heute.getTime() - tage * 86_400_000
}

/** Teilt Zeilen in das, was auf dem Tisch liegt, und das Archiv — die Reihenfolge bleibt. */
export function teileNachAlter<T extends { date_created?: string | null }>(
  zeilen: readonly T[],
  heute: Date = new Date(),
  tage: number = ARCHIV_TAGE
): { aktuell: T[]; archiv: T[] } {
  const aktuell: T[] = []
  const archiv: T[] = []
  for (const zeile of zeilen) (istArchiv(zeile.date_created, heute, tage) ? archiv : aktuell).push(zeile)
  return { aktuell, archiv }
}

/** Der Kalendertag `tage` Tage vor heute, JJJJ-MM-TT in Ortszeit — die untere Grenze einer Abfrage. */
export function tagVor(heute: Date = new Date(), tage: number = ARCHIV_TAGE): string {
  const d = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - tage)
  const zwei = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`
}

/**
 * Der Zähler des Cheftischs: offene Fährten und offene Perlen-Fragen der
 * letzten vierzehn Tage. Das Archiv zählt nicht — sonst steht er für immer
 * auf 99+ und sagt nichts mehr.
 */
export function anzahlChefredaktion(
  hinweise: ReadonlyArray<{ status: string; date_created?: string | null }>,
  perlen: ReadonlyArray<{ date_created?: string | null }>,
  heute: Date = new Date()
): number {
  return (
    teileNachAlter(
      hinweise.filter((h) => h.status === 'offen'),
      heute
    ).aktuell.length + teileNachAlter(perlen, heute).aktuell.length
  )
}
