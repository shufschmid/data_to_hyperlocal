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

export const EINSTELLBARE_TISCHE: ReadonlyArray<{
  wert: 'gemeinde' | 'veranstaltung' | 'buschtelefon'
  text: string
}> = [
  { wert: 'gemeinde', text: 'Gemeindeseiten' },
  { wert: 'veranstaltung', text: 'Veranstaltungen' },
  // Seit 11. November 2026 der dritte benotende Tisch: die Schwelle sagt hier
  // auch, ab welcher Stufe der Lauf den Entwurf gleich mitschreibt.
  { wert: 'buschtelefon', text: 'Buschtelefon' }
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

// --- Auto-Publish -----------------------------------------------------------
//
// Seit dem 16. November 2026 darf ein Lauf die Entwürfe, die er zu Vorschlägen
// selbst geschrieben hat, auch gleich publizieren — je Tisch einzeln
// eingeschaltet, nur ohne Warnung (`redaktion/autopublish.ts` im Backend). Was
// so hinausging, bleibt auf seinem Tisch sichtbar und lässt sich zurückziehen.

/** Die Tische, deren Lauf die Entwürfe selbst schreibt — nur dort gibt es etwas zu publizieren. */
export const AUTO_TISCHE = [
  { wert: 'gemeinde', text: 'Gemeindeseiten', feld: 'gemeindemitteilung' },
  { wert: 'kanton', text: 'Kanton', feld: 'kantonsmitteilung' },
  { wert: 'buschtelefon', text: 'Buschtelefon', feld: 'buschtelefon_fund' },
  { wert: 'sport', text: 'Sportresultate', feld: 'spiel' },
  { wert: 'abstimmung', text: 'Abstimmungen', feld: 'abstimmung' }
] as const

export type AutoTisch = (typeof AUTO_TISCHE)[number]['wert']

/** Ob Auto-Publish für den Tisch eingeschaltet ist; ohne Zeile oder Feld: aus. */
export function autoPublizieren(zeilen: readonly TischeinstellungFelder[], tisch: AutoTisch): boolean {
  return zeilen.find((z) => z.tisch === tisch)?.auto_publizieren === true
}

/** Wie lange eine automatisch publizierte Meldung auf ihrem Tisch stehen bleibt. */
export const AUTO_SICHTBAR_TAGE = 14

interface AutoMeldung {
  status: string
  publiziert_durch: string | null
  publiziert_am: string | null
}

/**
 * Was der Lauf dieses Tischs von sich aus publiziert hat und noch draussen
 * ist — die letzten `tage` Tage, das Neueste zuerst. Eine zurückgezogene
 * Meldung ist nicht mehr `publiziert` und fällt heraus.
 */
export function automatischPublizierte<M extends AutoMeldung>(
  meldungen: readonly M[],
  tisch: AutoTisch,
  heute: string,
  tage: number = AUTO_SICHTBAR_TAGE
): M[] {
  const feld = AUTO_TISCHE.find((t) => t.wert === tisch)?.feld
  if (feld === undefined) return []
  const ab = verschiebe(heute, -tage)
  return meldungen
    .filter(
      (m) =>
        m.status === 'publiziert' &&
        m.publiziert_durch === 'automatik' &&
        (m as Record<string, unknown>)[feld] != null &&
        (m.publiziert_am ?? '').slice(0, 10) >= ab
    )
    .sort((a, b) => (b.publiziert_am ?? '').localeCompare(a.publiziert_am ?? ''))
}
