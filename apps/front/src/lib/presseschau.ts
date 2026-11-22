// Welche Kandidaten eines Wochenblatts oben auf dem Tisch stehen und welche
// unten eingeklappt. Pur, damit die Regel pruefbar ist.
//
// Die Redaktion am 27. September 2026: was ein Wochenblatt als VORSCHAU
// bringt, verfaellt fuer sie, sobald der Tag des Anlasses vorbei ist — fuer
// alle Blaetter und alle Gemeinden. Eine RUECKSCHAU (das Blatt war dabei, hat
// Bilder) verfaellt nicht so. Verfallene Vorschauen verschwinden nicht, sie
// werden unten angehaengt, und erst die naechste Ausgabe raeumt sie ab
// (`raeumeAlteVorschlaegeAuf` im Backend). Das Datum hat der Code im Beitrag
// gefunden (`parseInventar`), nie das Modell allein.
//
// Spiegelt `vorschauVorbei` und `formulierbare` in `redaktion/presseschau.ts`;
// aendert sich die eine Seite, aendert sich die andere.

import type { KandidatFelder } from '@/graphql/redaktion'
import { istVorschlag, STANDARD_EINSTELLUNG } from './tische'

type Zeitbezug = Pick<KandidatFelder, 'zeitbezug' | 'anlass_am' | 'entscheid'>

/** Eine offene Vorschau, deren Anlass vorbei ist — ab dem Tag danach. */
export function vorschauVorbei(kandidat: Zeitbezug, heute: string): boolean {
  if (kandidat.entscheid !== 'offen') return false
  if (kandidat.zeitbezug !== 'vorschau') return false
  const tag = kandidat.anlass_am ?? null
  return tag !== null && tag < heute
}

/**
 * Oben die Arbeit, unten eingeklappt die Vorschauen, deren Anlass vorbei ist.
 *
 * Seit dem 22. November 2026 benotet das Inventar jeden Kandidaten (1–4): die
 * hoechste Stufe liegt zuoberst, innerhalb einer Stufe bleibt die Reihenfolge
 * des Blatts (nach Seite). Ein unbenoteter Kandidat — vor diesem Tag gelesen —
 * steht nach den benoteten, in seiner alten Reihenfolge.
 */
export function ordneKandidaten<T extends Zeitbezug & Pick<KandidatFelder, 'vorschlag_wert'>>(
  kandidaten: readonly T[],
  heute: string
): { aktuell: T[]; vorbei: T[] } {
  const aktuell: T[] = []
  const vorbei: T[] = []
  for (const k of kandidaten) (vorschauVorbei(k, heute) ? vorbei : aktuell).push(k)
  aktuell.sort((a, b) => (b.vorschlag_wert ?? 0) - (a.vorschlag_wert ?? 0))
  return { aktuell, vorbei }
}

/**
 * Ob der Lauf zu diesem Kandidaten den Entwurf selbst schreibt: benotet ab
 * der Schwelle des Tischs. Ein unbenoteter nie — der bleibt beim Knopf.
 * Spiegelt `formulierbare(…, abStufe)` im Backend.
 */
export function abSchwelle(
  kandidat: Pick<KandidatFelder, 'vorschlag_wert'>,
  schwelle: number = STANDARD_EINSTELLUNG.schwelle
): boolean {
  return istVorschlag(kandidat.vorschlag_wert, schwelle)
}

/** Die Meldungen dieses Tischs, die jetzt publiziert werden duerfen — `in_pruefung` bleibt aussen vor. */
export function publizierbare<T extends { kandidat?: { id: string } | null; status: string }>(
  meldungen: readonly T[]
): T[] {
  return meldungen.filter(
    (m) => (m.kandidat ?? null) !== null && (m.status === 'entwurf' || m.status === 'freigegeben')
  )
}

/**
 * Wofuer «Übrige Meldungen formulieren» einen Entwurf schreiben wuerde: offen,
 * noch ohne Meldung, mit Fakten, und keine Vorschau, deren Anlass vorbei ist.
 * Dieselbe Auswahl wie `formulierbare` im Backend — hier nur gezaehlt. Seit
 * dem 22. November 2026 hat der Lauf die Kandidaten ab der Schwelle schon
 * beschrieben; uebrig sind die tiefer benoteten und die unbenoteten.
 */
export function formulierbar(
  kandidat: Zeitbezug & Pick<KandidatFelder, 'zusammenfassung'>,
  hatMeldung: boolean,
  heute: string
): boolean {
  if (kandidat.entscheid !== 'offen' || hatMeldung) return false
  if (vorschauVorbei(kandidat, heute)) return false
  return (kandidat.zusammenfassung ?? '').trim() !== ''
}

/** Der Chip am Kandidaten: was das Inventar ueber den Zeitbezug sagt. */
export function zeitbezugText(kandidat: Pick<KandidatFelder, 'zeitbezug' | 'anlass_am'>): string | null {
  if (kandidat.zeitbezug === 'rueckschau') return 'Rückschau'
  if (kandidat.zeitbezug !== 'vorschau') return null
  const tag = kandidat.anlass_am
  if (tag === null) return 'Vorschau'
  const [j, m, t] = tag.split('-')
  return `Vorschau · ${t}.${m}.${j}`
}
