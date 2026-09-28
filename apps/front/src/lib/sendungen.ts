import type { AlleMeldungFelder, SendungskandidatFelder } from '@/graphql/redaktion'

// Presentation rules for the two broadcast tabs. Pure, so they are tested
// without rendering a card.
//
// The tabs themselves stay what they were ported as — a fast review of the
// show, for people who are not necessarily responsible for municipality news.
// Everything here is about the half that IS: a contribution the inventory found
// to be about a covered municipality gets highlighted and carries the three
// decisions, and nothing else on the card changes.

export const ABLEHNUNGSGRUENDE: { wert: string; text: string }[] = [
  { wert: 'nicht_relevant', text: 'Nicht relevant' },
  { wert: 'nur_erwaehnt', text: 'Nur am Rand erwähnt' },
  { wert: 'doublette', text: 'Doublette' },
  { wert: 'veraltet', text: 'Veraltet' },
  { wert: 'falsche_gemeinde', text: 'Falsche Gemeinde' },
  { wert: 'andere', text: 'Anderer Grund' }
]

/**
 * Whether a candidate still wants an answer.
 *
 * The same rule as the gazette desk, and for the same reason: a taken-over
 * candidate stays visible while its Meldung is being edited, because it is
 * edited right there on the card. Published or discarded is finished; rejected
 * and handed-up are finished at once.
 */
export function bleibtOffen(kandidat: SendungskandidatFelder, meldungStatus: string | null = null): boolean {
  if (kandidat.entscheid === 'offen') return true
  if (kandidat.entscheid !== 'uebernommen') return false
  if (meldungStatus === null) return false
  return meldungStatus !== 'publiziert' && meldungStatus !== 'verworfen'
}

/**
 * Which candidate belongs to which contribution.
 *
 * A Regionaljournal edition can hold several contributions and therefore
 * several candidates, so this maps to a LIST — the card looks up its own
 * headline in it.
 */
export function kandidatenJeEdition(
  kandidaten: readonly SendungskandidatFelder[]
): Map<string, SendungskandidatFelder[]> {
  const karte = new Map<string, SendungskandidatFelder[]>()
  for (const kandidat of kandidaten) {
    const id = kandidat.edition?.id ?? kandidat.punkt6_edition?.id
    if (id === undefined) continue
    const bisher = karte.get(id)
    if (bisher === undefined) karte.set(id, [kandidat])
    else bisher.push(kandidat)
  }
  return karte
}

/** Which article belongs to which candidate. */
export function meldungJeKandidat<T extends { sendungskandidat: { id: string } | null }>(
  meldungen: readonly T[]
): Map<string, T> {
  const karte = new Map<string, T>()
  for (const meldung of meldungen) {
    if (meldung.sendungskandidat !== null) karte.set(meldung.sendungskandidat.id, meldung)
  }
  return karte
}

/**
 * The badge on the tab: what still wants a decision.
 *
 * Only the candidates — the shows themselves are a review queue that never
 * empties, and counting their contributions would make the number meaningless.
 */
export function anzahlOffen(
  kandidaten: readonly SendungskandidatFelder[],
  meldungen: readonly AlleMeldungFelder[] = []
): number {
  const status = meldungJeKandidat(meldungen)
  return kandidaten.filter((k) => bleibtOffen(k, status.get(k.id)?.status ?? null)).length
}

/** `261` → `4:21`. The timestamp a listener actually jumps to. */
export function zeitText(sekunden: number | null): string {
  if (sekunden === null || sekunden < 0) return ''
  const min = Math.floor(sekunden / 60)
  const sek = Math.floor(sekunden % 60)
  return `${min}:${String(sek).padStart(2, '0')}`
}

/** Das Ergebnis einer Verarbeitung, wie der Knopf es zählt. */
export type Verarbeitungsergebnis =
  | 'verarbeitet'
  | 'wartet'
  | 'passt_nicht'
  | 'wiederholung'
  | 'fehlgeschlagen'

/** Liest die Antwort von POST …/process — Status und, beim Warten, den Grund. */
export function verarbeitungsergebnis(
  daten: { status?: string; grund?: string } | undefined
): Verarbeitungsergebnis {
  if (daten?.status === 'processed') return 'verarbeitet'
  if (daten?.status === 'wiederholung') return 'wiederholung'
  if (daten?.status === 'wartet') return daten.grund === 'passt_nicht' ? 'passt_nicht' : 'wartet'
  return 'fehlgeschlagen'
}

/**
 * Was ein Knopfdruck bewirkt hat, in einem Satz. Die zwei Arten zu warten
 * werden getrennt genannt: „noch keine Marken" ist zu früh, „Marken passen
 * nicht" ist ein anderer Schnitt als die Sendung — und eine Wiederholung ist
 * weder das eine noch das andere.
 */
export function verarbeitungsBericht(
  ergebnisse: readonly Verarbeitungsergebnis[],
  geholt: number | null
): string {
  const zahl = (e: Verarbeitungsergebnis) => ergebnisse.filter((x) => x === e).length
  const n = ergebnisse.length
  const teile = [
    geholt === null
      ? `${zahl('verarbeitet')} von ${n} Dossier${n === 1 ? '' : 's'} verarbeitet`
      : `${geholt} Dossier${geholt === 1 ? '' : 's'} geholt, ${zahl('verarbeitet')} verarbeitet`
  ]
  const wartet = zahl('wartet')
  if (wartet > 0)
    teile.push(`${wartet} ${wartet === 1 ? 'wartet' : 'warten'} auf die Beitragsmarken von telebasel.ch`)
  const passtNicht = zahl('passt_nicht')
  if (passtNicht > 0)
    teile.push(
      `bei ${passtNicht} passen die Beitragsmarken von telebasel.ch nicht zum Transkript (anderer Schnitt als die Sendung)`
    )
  const wiederholt = zahl('wiederholung')
  if (wiederholt > 0)
    teile.push(
      `${wiederholt} ${wiederholt === 1 ? 'ist eine Wiederholung' : 'sind Wiederholungen'} einer früheren Sendung und ${wiederholt === 1 ? 'wurde' : 'wurden'} nicht noch einmal aufbereitet`
    )
  const gescheitert = zahl('fehlgeschlagen')
  if (gescheitert > 0) teile.push(`${gescheitert} fehlgeschlagen`)
  return teile.join(', ') + '.'
}

/** „punkt6 vom 27.09.2026" aus dem Betreff des SMD-Mails, sonst null. */
export function sendungAusBetreff(betreff: string | null): string | null {
  const m = /punkt6\S*\s+vom\s+(\d{2}\.\d{2}\.\d{4})/i.exec(betreff ?? '')
  return m === null ? null : `punkt6 vom ${m[1]}`
}

/** Die erkannten Wiederholungen der letzten zwei Wochen — ältere interessieren den Tisch nicht mehr. */
export function jungeWiederholungen<T extends { date_created: string | null }>(
  dossiers: readonly T[],
  heute: Date = new Date()
): T[] {
  const grenze = heute.getTime() - 14 * 86_400_000
  return dossiers.filter((d) => d.date_created !== null && Date.parse(d.date_created) >= grenze)
}
