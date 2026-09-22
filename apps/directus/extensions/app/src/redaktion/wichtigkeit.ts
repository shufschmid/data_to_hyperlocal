// Was die Redaktion zuletzt als WICHTIG einstufte — das Lernsignal fuer den
// Termin einer Meldung.
//
// „Wichtig" heisst: frueh ankuendigen, mehrere Auftritte im Briefing des
// Dorfkoenigs. Der Lauf schlaegt es vor (`wichtig_vorschlag`), die Redaktion
// bestaetigt oder kippt es (`wichtig`), und die Abweichung ist die Lehre —
// die Redaktion hat am 22. September 2026 genau das verlangt: lernen, was sie
// als wichtigen Anlass einstuft, wenn ihre Angabe vom Vorschlag abweicht.
//
// Geschmack ist der Redaktion, nicht einer Gemeinde: ein Dorffest ist in
// Aesch so wichtig wie in Riehen. Darum wird ueber den ganzen TISCH gelesen,
// nicht je Gemeinde — wie bei den Perlen der Presseschau. Abweichungen zuerst,
// weil sie das Signal sind; Bestaetigungen danach, weil sie den Massstab
// festigen; jede Kappung deklariert.

import type { ItemsServiceLike } from './lernsignale'

export const WICHTIGKEIT_FENSTER = 20

export type WichtigkeitUrsprung = 'gemeindemitteilung' | 'veranstaltung'

export interface WichtigkeitBeispiel {
  titel: string
  /** Das Urteil der Redaktion. */
  wichtig: boolean
  /** Was der Lauf vorgeschlagen hatte. */
  vorschlag: boolean
}

export interface WichtigkeitSignale {
  beispiele: WichtigkeitBeispiel[]
  /** Wie viele entschiedene Zeilen ueber das Fenster hinaus vorliegen. */
  weitere: number
}

/**
 * Die letzten Urteile der Redaktion ueber die Wichtigkeit, je Tisch.
 *
 * Nur Zeilen, auf denen BEIDES steht — Vorschlag und Urteil —, sagen etwas:
 * ein `wichtig` ohne `wichtig_vorschlag` stammt aus der Zeit vor diesem
 * Feld oder von einer Zeile, die der Lauf nie beurteilt hat.
 */
export async function ladeWichtigkeitSignale(
  meldungen: ItemsServiceLike,
  ursprung: WichtigkeitUrsprung,
  max = WICHTIGKEIT_FENSTER
): Promise<WichtigkeitSignale> {
  const filter = {
    [ursprung]: { _nnull: true },
    wichtig: { _nnull: true },
    wichtig_vorschlag: { _nnull: true }
  }
  const zeilen = (await meldungen.readByQuery({
    filter,
    fields: ['titel', 'wichtig', 'wichtig_vorschlag'],
    sort: ['-date_updated'],
    limit: max
  })) as Array<{
    titel: string | null
    wichtig: boolean
    wichtig_vorschlag: boolean
  }>
  const alle = (await meldungen.readByQuery({
    filter,
    fields: ['id'],
    limit: -1
  })) as Array<{ id: string }>

  const beispiele = zeilen.map(
    (z): WichtigkeitBeispiel => ({
      titel: (z.titel ?? '').trim(),
      wichtig: z.wichtig === true,
      vorschlag: z.wichtig_vorschlag === true
    })
  )
  return {
    beispiele: ordneBeispiele(beispiele),
    weitere: Math.max(0, alle.length - beispiele.length)
  }
}

/** Abweichungen zuerst — sie sind das Signal —, sonst in der geladenen Reihenfolge. */
export function ordneBeispiele(
  beispiele: readonly WichtigkeitBeispiel[]
): WichtigkeitBeispiel[] {
  const abweichend = beispiele.filter((b) => b.wichtig !== b.vorschlag)
  const bestaetigt = beispiele.filter((b) => b.wichtig === b.vorschlag)
  return [...abweichend, ...bestaetigt]
}

/**
 * Der Block fuer den User-Turn des Schreibers — leer, solange die Redaktion
 * noch nichts entschieden hat, damit ein junger Tisch nicht mit einem leeren
 * Titel daherkommt.
 */
export function wichtigkeitDigest(signale: WichtigkeitSignale): string {
  if (signale.beispiele.length === 0) return ''
  const zeile = (b: WichtigkeitBeispiel): string => {
    const urteil = b.wichtig ? 'WICHTIG' : 'nicht wichtig'
    const hinweis =
      b.wichtig === b.vorschlag
        ? 'wie vorgeschlagen'
        : `der Vorschlag war: ${b.vorschlag ? 'wichtig' : 'nicht wichtig'}`
    return `- "${b.titel}" → ${urteil} (${hinweis})`
  }
  return [
    'So hat die Redaktion zuletzt entschieden, was ein WICHTIGER Anlass ist (frueh ankuendigen, mehrere Auftritte) — richte dich danach:',
    ...signale.beispiele.map(zeile),
    ...(signale.weitere > 0
      ? [`(${signale.weitere} weitere Entscheide nicht aufgefuehrt)`]
      : [])
  ].join('\n')
}
