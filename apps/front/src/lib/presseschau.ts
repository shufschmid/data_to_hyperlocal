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

type Zeitbezug = Pick<KandidatFelder, 'zeitbezug' | 'anlass_am' | 'entscheid'>

/** Eine offene Vorschau, deren Anlass vorbei ist — ab dem Tag danach. */
export function vorschauVorbei(kandidat: Zeitbezug, heute: string): boolean {
  if (kandidat.entscheid !== 'offen') return false
  if (kandidat.zeitbezug !== 'vorschau') return false
  const tag = kandidat.anlass_am ?? null
  return tag !== null && tag < heute
}

/** Oben die Arbeit, unten eingeklappt die Vorschauen, deren Anlass vorbei ist. */
export function ordneKandidaten<T extends Zeitbezug>(
  kandidaten: readonly T[],
  heute: string
): { aktuell: T[]; vorbei: T[] } {
  const aktuell: T[] = []
  const vorbei: T[] = []
  for (const k of kandidaten) (vorschauVorbei(k, heute) ? vorbei : aktuell).push(k)
  return { aktuell, vorbei }
}

/**
 * Wofuer «Alle Meldungen formulieren» einen Entwurf schreiben wuerde: offen,
 * noch ohne Meldung, mit Fakten, und keine Vorschau, deren Anlass vorbei ist.
 * Dieselbe Auswahl wie `formulierbare` im Backend — hier nur gezaehlt.
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
