import type { KantonsmitteilungFelder } from '@/graphql/redaktion'

// Presentation rules for the Kanton desk. Pure, so they are tested without a
// component. The same shape as `lib/gemeindeseiten.ts` on purpose — the two
// desks work the same way, and an editor should not have to learn two. What
// differs: the speaker is the canton or its police, never the municipality,
// and one notice may name several municipalities (one row each).

export { datumText } from './amtsblatt'

/** `nur_erwaehnt` is this desk's own lesson: a list of twenty municipalities is not a notice about Aesch. */
export const ABLEHNUNGSGRUENDE: { wert: string; text: string }[] = [
  { wert: 'nicht_relevant', text: 'Nicht relevant' },
  { wert: 'nur_erwaehnt', text: 'Nur am Rand erwähnt' },
  { wert: 'doublette', text: 'Doublette' },
  { wert: 'veraltet', text: 'Veraltet' },
  { wert: 'andere', text: 'Anderer Grund' }
]

const QUELLE_TEXT: Record<string, string> = {
  medienmitteilung: 'Medienmitteilung',
  polizeimeldung: 'Polizeimeldung'
}

/** What the chip says about the source: press release or police notice. */
export function quelleText(quelle: string): string {
  return QUELLE_TEXT[quelle] ?? quelle
}

/** The other municipalities the same notice names — the desk says so, the Sichtung judged only this one. */
export function weitereGemeinden(
  eintrag: Pick<KantonsmitteilungFelder, 'gemeinden_genannt' | 'gemeinde'>
): string[] {
  const eigene = eintrag.gemeinde?.name ?? null
  return (eintrag.gemeinden_genannt ?? []).filter((n) => n !== eigene)
}

/**
 * What stays on the desk: the open rows, and a taken-over row while its
 * Meldung is still being edited — the editing happens here. Rejected and
 * handed-up rows leave at once; so does a Meldung that is published or
 * discarded. The rows themselves stay in the database — this feed's memory.
 */
export function bleibtAufDemTisch(
  eintrag: KantonsmitteilungFelder,
  meldungStatus: string | null = null
): boolean {
  if (eintrag.entscheid === 'offen') return true
  if (eintrag.entscheid !== 'uebernommen') return false
  if (meldungStatus === null) return false
  return meldungStatus !== 'publiziert' && meldungStatus !== 'verworfen'
}

/** Newest notice first; a row without a date sorts by when it was read. */
export function sortiere(eintraege: readonly KantonsmitteilungFelder[]): KantonsmitteilungFelder[] {
  return [...eintraege].sort((a, b) => {
    const tag = (b.publiziert_am ?? '').localeCompare(a.publiziert_am ?? '')
    if (tag !== 0) return tag
    return (b.date_created ?? '').localeCompare(a.date_created ?? '')
  })
}

export interface Filter {
  gemeinde: string | null
  suche: string
}

function normalisiere(text: string): string {
  return text.toLocaleLowerCase('de-CH').normalize('NFD').replace(/\p{M}/gu, '')
}

export function passt(eintrag: KantonsmitteilungFelder, filter: Filter): boolean {
  if (filter.gemeinde !== null && eintrag.gemeinde?.id !== filter.gemeinde) return false
  if (filter.suche.trim() === '') return true
  const suche = normalisiere(filter.suche.trim())
  return [eintrag.titel, eintrag.teaser ?? '', eintrag.behoerde ?? '', eintrag.gemeinde?.name ?? '']
    .map(normalisiere)
    .some((feld) => feld.includes(suche))
}

/** How long an unproposed row waits before the run drops it. */
export const AUFRAEUM_TAGE = 7
/** How long an undecided proposal waits before the run lets it lapse. */
export const VORSCHLAG_VERFALL_TAGE = 14

function alterInTagen(datum: string | null, heute: string): number | null {
  if (datum === null) return null
  const ms = Date.parse(`${heute}T00:00:00Z`) - Date.parse(`${datum.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000)
}

/**
 * The view's half of the rule the 14:00 run enforces (`aufraeumAktionKanton`
 * in `redaktion/kanton.ts`, which owns it): without the mirror the desk would
 * show for up to a day what the next run retires.
 */
export function abgelaufen(eintrag: KantonsmitteilungFelder, heute: string): boolean {
  if (eintrag.entscheid !== 'offen') return false
  const alter = alterInTagen(eintrag.publiziert_am ?? eintrag.date_created, heute)
  if (alter === null) return false
  return eintrag.vorschlag === true ? alter >= VORSCHLAG_VERFALL_TAGE : alter >= AUFRAEUM_TAGE
}

export interface Tisch {
  /** What the Sichtung put forward — the top of the desk. */
  vorschlaege: KantonsmitteilungFelder[]
  /** Everything else, one click away. Never hidden, only folded. */
  uebrige: KantonsmitteilungFelder[]
}

export function tisch(
  eintraege: readonly KantonsmitteilungFelder[],
  filter: Filter,
  meldungStatus: ReadonlyMap<string, string> = new Map(),
  heute: string | null = null
): Tisch {
  const offen = sortiere(
    eintraege.filter(
      (e) =>
        bleibtAufDemTisch(e, meldungStatus.get(e.id) ?? null) &&
        passt(e, filter) &&
        (heute === null || !abgelaufen(e, heute))
    )
  )
  return {
    vorschlaege: offen.filter((e) => e.vorschlag === true),
    uebrige: offen.filter((e) => e.vorschlag !== true)
  }
}

/**
 * The articles of this desk that may be published now — `in_pruefung` stays
 * out, as on every desk with this grip. `?? null`, because an older answer
 * may omit the field.
 */
export function publizierbare<T extends { kantonsmitteilung?: { id: string } | null; status: string }>(
  meldungen: readonly T[]
): T[] {
  return meldungen.filter(
    (m) => (m.kantonsmitteilung ?? null) !== null && (m.status === 'entwurf' || m.status === 'freigegeben')
  )
}

/** The badge on the tab: the proposals, plus what is taken over and not finished. */
export function anzahlOffen(
  eintraege: readonly KantonsmitteilungFelder[],
  meldungStatus: ReadonlyMap<string, string> = new Map()
): number {
  return eintraege.filter((e) => {
    if (!bleibtAufDemTisch(e, meldungStatus.get(e.id) ?? null)) return false
    return e.vorschlag === true || e.entscheid === 'uebernommen'
  }).length
}

/** Which article belongs to which row — keyed by the row, so a discarded article cannot hide a later one. */
export function meldungJeMitteilung<T extends { kantonsmitteilung?: { id: string } | null }>(
  meldungen: readonly T[]
): Map<string, T> {
  const karte = new Map<string, T>()
  for (const meldung of meldungen) {
    const ursprung = meldung.kantonsmitteilung ?? null
    if (ursprung !== null) karte.set(ursprung.id, meldung)
  }
  return karte
}

/** The hand-started run, mirrored from the extension's process — the twin of `GemeindeseitenLaufStatus`. */
export interface KantonLaufStatus {
  laeuft: boolean
  gestartet_um: string | null
  beendet_um: string | null
  ergebnis: Record<string, unknown> | null
  fehler: string | null
}

function anzahl(wert: unknown): number {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : 0
}

/** What the desk says about the run: under way, or what the last one brought. */
export function laufText(status: KantonLaufStatus): string | null {
  if (status.laeuft) {
    return 'Der Lauf ist unterwegs — jeder neue Eintrag der zwei Listen wird geöffnet, das dauert einige Minuten; die Ansicht aktualisiert sich von selbst.'
  }
  if (status.beendet_um === null) return null
  if (status.ergebnis === null) return 'Der letzte Lauf hat nichts zurückgemeldet.'
  const e = status.ergebnis
  const teile = [
    `${anzahl(e['geoeffnet'])} Einträge geöffnet`,
    `${anzahl(e['neu'])} mit Gemeindebezug`,
    `${anzahl(e['vorschlaege'])} Vorschläge`,
    `${anzahl(e['meldungenGeschrieben'])} Meldungen geschrieben`
  ]
  const fehler = Array.isArray(e['fehler']) ? e['fehler'].length : 0
  if (fehler > 0) teile.push(`${fehler} Fehler`)
  const uhrzeit = new Date(status.beendet_um).toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich'
  })
  return `Letzter Lauf um ${uhrzeit} Uhr — ${teile.join(', ')}.`
}
