// Grouping and labels for the „Gelerntes" tab.
//
// Pure, kept apart from the component for the usual reason: the grouping and
// the automation tally are what can be wrong, and what a test can reach.

import type { RecherchehinweisFelder, WissenFelder } from '@/graphql/redaktion'

/** Tab order — the desks as the header shows them, then the configuration. */
export const BEREICHE: ReadonlyArray<{ wert: string; text: string }> = [
  { wert: 'statistik', text: 'Statistik' },
  { wert: 'sport', text: 'Sportresultate' },
  { wert: 'entsorgung', text: 'Entsorgung' },
  { wert: 'presseschau', text: 'Wochenblätter' },
  { wert: 'amtsblatt', text: 'Amtsblatt' },
  { wert: 'gemeinde', text: 'Gemeindeseiten' },
  { wert: 'sendung', text: 'Regionaljournal / punkt6' }
]

export function bereichText(wert: string): string {
  return BEREICHE.find((b) => b.wert === wert)?.text ?? wert
}

export const STUFEN: ReadonlyArray<{ wert: string; text: string }> = [
  { wert: 'sichtung', text: 'Sichtung — was vorgeschlagen wird' },
  { wert: 'text', text: 'Text — wie geschrieben wird' }
]

export function stufeText(wert: string): string {
  return wert === 'sichtung' ? 'Sichtung' : wert === 'text' ? 'Text' : wert
}

const HERKUNFT: Record<string, string> = {
  chat: 'aus einer Anweisung',
  kommentar: 'aus einem Kommentar',
  entscheid: 'aus wiederholten Entscheiden',
  manuell: 'von Hand'
}

export function herkunftText(wert: string): string {
  return HERKUNFT[wert] ?? wert
}

export function geltungText(regel: Pick<WissenFelder, 'geltungsbereich' | 'datensatz'>): string | null {
  if (regel.geltungsbereich === 'datensatz') return regel.datensatz?.titel ?? 'ein Datensatz'
  if (regel.geltungsbereich === 'quelle') return 'ganze Quelle'
  return null
}

export interface Regelgruppe {
  bereich: string
  text: string
  aktive: WissenFelder[]
  inaktive: WissenFelder[]
}

/**
 * The rules by desk, in tab order, newest first inside a group. A desk
 * without rules gets no group — an empty heading is noise.
 */
export function gruppiereRegeln(regeln: readonly WissenFelder[]): Regelgruppe[] {
  const gruppen: Regelgruppe[] = []
  const bekannt = new Set(BEREICHE.map((b) => b.wert))
  const reihenfolge = [
    ...BEREICHE.map((b) => b.wert),
    ...[...new Set(regeln.map((r) => r.bereich))].filter((b) => !bekannt.has(b))
  ]
  for (const bereich of reihenfolge) {
    const eigene = regeln
      .filter((r) => r.bereich === bereich)
      .sort((a, b) => (b.date_created ?? '').localeCompare(a.date_created ?? ''))
    if (eigene.length === 0) continue
    gruppen.push({
      bereich,
      text: bereichText(bereich),
      aktive: eigene.filter((r) => r.aktiv),
      inaktive: eigene.filter((r) => !r.aktiv)
    })
  }
  return gruppen
}

export interface AutomatikBilanz {
  offen: number
  brauchbar: number
  abgelegt: number
}

/**
 * What the Chefredaktion made of the leads a rule handed up by itself — the
 * track record shown on the rule card, computed from the leads rather than
 * stored twice.
 */
export function automatikBilanz(
  hinweise: readonly Pick<RecherchehinweisFelder, 'regel' | 'status'>[],
  regelId: string
): AutomatikBilanz {
  const bilanz: AutomatikBilanz = { offen: 0, brauchbar: 0, abgelegt: 0 }
  for (const h of hinweise) {
    if (h.regel?.id !== regelId) continue
    if (h.status === 'offen') bilanz.offen += 1
    else if (h.status === 'brauchbar') bilanz.brauchbar += 1
    else bilanz.abgelegt += 1
  }
  return bilanz
}

export function automatikText(b: AutomatikBilanz): string | null {
  const gesamt = b.offen + b.brauchbar + b.abgelegt
  if (gesamt === 0) return null
  return `${gesamt} ${gesamt === 1 ? 'Fährte' : 'Fährten'} automatisch weitergereicht · ${b.brauchbar} brauchbar · ${b.abgelegt} abgelegt · ${b.offen} offen`
}
