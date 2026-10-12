import type { SmdBeitragFelder } from '@/graphql/redaktion'

// Presentation rules for the SMD desk. Pure, so they are tested without a
// component. The same shape as `lib/kanton.ts` on purpose — the desks work the
// same way, and an editor should not have to learn two. What differs: the
// speaker is another medium, a row may be a blog's entry rather than an
// article, and every row says whether the piece stands online and behind a
// paywall — or that the newsroom read it as if in the printed paper.

export { datumText } from './amtsblatt'

/** The Kanton desk's reasons: «nur_erwaehnt» is the lesson here too. */
export const ABLEHNUNGSGRUENDE: { wert: string; text: string }[] = [
  { wert: 'nicht_relevant', text: 'Nicht relevant' },
  { wert: 'nur_erwaehnt', text: 'Nur am Rand erwähnt' },
  { wert: 'doublette', text: 'Doublette' },
  { wert: 'veraltet', text: 'Veraltet' },
  { wert: 'andere', text: 'Anderer Grund' }
]

/** The newsroom's wording of 12 October 2026 for a piece without an online address. */
export const NICHT_ONLINE = 'Artikel nicht online verfügbar'

export interface LinkChip {
  text: string
  farbe: 'success' | 'warning' | 'default'
}

/**
 * What the chip says about the online address: found and paywalled, found
 * and free, set by hand, or not available — with the reason the run gave.
 */
export function linkChip(eintrag: Pick<SmdBeitragFelder, 'link_url' | 'link_status' | 'link_abo'>): LinkChip {
  if (eintrag.link_url !== null) {
    const abo = eintrag.link_abo === false ? 'frei' : 'Abo'
    const hand = eintrag.link_status === 'manuell' ? ', von Hand' : ''
    return { text: `Online (${abo}${hand})`, farbe: 'success' }
  }
  if (eintrag.link_status === 'keine_tuer')
    return { text: `${NICHT_ONLINE} — keine Verlagstür`, farbe: 'default' }
  if (eintrag.link_status === 'fehler')
    return { text: `${NICHT_ONLINE} — Suche fehlgeschlagen`, farbe: 'warning' }
  return { text: NICHT_ONLINE, farbe: 'default' }
}

/** The link text the article will carry — the same rule the extension applies. */
export function linkText(eintrag: Pick<SmdBeitragFelder, 'medium' | 'link_url' | 'link_abo'>): string {
  if (eintrag.link_url === null) return `(${NICHT_ONLINE})`
  return `Artikel auf ${eintrag.medium}${eintrag.link_abo === false ? '' : ' (Abo)'}`
}

/** «bazonline.ch, 11. Oktober 2026» — or, for a blog entry, with the blog and the time. */
export function beitragsText(
  eintrag: Pick<SmdBeitragFelder, 'art' | 'medium' | 'blog' | 'datum' | 'zeit'>,
  datumText: (iso: string) => string
): string {
  const wann =
    eintrag.zeit === null ? datumText(eintrag.datum) : `${datumText(eintrag.datum)}, ${eintrag.zeit} Uhr`
  return eintrag.art === 'blogeintrag'
    ? `${eintrag.medium}, Blog «${eintrag.blog ?? ''}», Eintrag vom ${wann}`
    : `${eintrag.medium}, ${wann}`
}

/** The other municipalities the same piece names — the desk says so, the Sichtung judged only this one. */
export function weitereGemeinden(
  eintrag: Pick<SmdBeitragFelder, 'gemeinden_genannt' | 'gemeinde'>
): string[] {
  const eigene = eintrag.gemeinde?.name ?? null
  return (eintrag.gemeinden_genannt ?? []).filter((n) => n !== eigene)
}

/** The media on the desk, for the filter — in the order they appear. */
export function medien(eintraege: readonly SmdBeitragFelder[]): string[] {
  return [...new Set(eintraege.map((e) => e.medium))].sort((a, b) => a.localeCompare(b, 'de-CH'))
}

/**
 * What stays on the desk: the open rows, and a taken-over row while its
 * Meldung is still being edited — the editing happens here. Rejected and
 * handed-up rows leave at once; so does a Meldung that is published or
 * discarded. The rows themselves stay in the database — this feed's memory.
 */
export function bleibtAufDemTisch(eintrag: SmdBeitragFelder, meldungStatus: string | null = null): boolean {
  if (eintrag.entscheid === 'offen') return true
  if (eintrag.entscheid !== 'uebernommen') return false
  if (meldungStatus === null) return false
  return meldungStatus !== 'publiziert' && meldungStatus !== 'verworfen'
}

/** Newest piece first; same day by the time of a blog entry, then by when it was read. */
export function sortiere(eintraege: readonly SmdBeitragFelder[]): SmdBeitragFelder[] {
  return [...eintraege].sort((a, b) => {
    const tag = b.datum.localeCompare(a.datum)
    if (tag !== 0) return tag
    const zeit = (b.zeit ?? '').localeCompare(a.zeit ?? '')
    if (zeit !== 0) return zeit
    return (b.date_created ?? '').localeCompare(a.date_created ?? '')
  })
}

export interface Filter {
  gemeinde: string | null
  medium: string | null
  suche: string
}

function normalisiere(text: string): string {
  return text.toLocaleLowerCase('de-CH').normalize('NFD').replace(/\p{M}/gu, '')
}

export function passt(eintrag: SmdBeitragFelder, filter: Filter): boolean {
  if (filter.gemeinde !== null && eintrag.gemeinde?.id !== filter.gemeinde) return false
  if (filter.medium !== null && eintrag.medium !== filter.medium) return false
  if (filter.suche.trim() === '') return true
  const suche = normalisiere(filter.suche.trim())
  return [eintrag.titel, eintrag.lead ?? '', eintrag.blog ?? '', eintrag.medium, eintrag.gemeinde?.name ?? '']
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
 * The view's half of the rule the 14:45 run enforces (`aufraeumAktionSmd`
 * in `redaktion/smd.ts`, which owns it): without the mirror the desk would
 * show for up to a day what the next run retires.
 */
export function abgelaufen(eintrag: SmdBeitragFelder, heute: string): boolean {
  if (eintrag.entscheid !== 'offen') return false
  const alter = alterInTagen(eintrag.datum ?? eintrag.date_created, heute)
  if (alter === null) return false
  return eintrag.vorschlag === true ? alter >= VORSCHLAG_VERFALL_TAGE : alter >= AUFRAEUM_TAGE
}

export interface Tisch {
  /** What the Sichtung put forward — the top of the desk. */
  vorschlaege: SmdBeitragFelder[]
  /** Everything else, one click away. Never hidden, only folded. */
  uebrige: SmdBeitragFelder[]
}

export function tisch(
  eintraege: readonly SmdBeitragFelder[],
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

/** The articles of this desk that may be published now — `in_pruefung` stays out, as on every desk with this grip. */
export function publizierbare<T extends { smd_beitrag?: { id: string } | null; status: string }>(
  meldungen: readonly T[]
): T[] {
  return meldungen.filter(
    (m) => (m.smd_beitrag ?? null) !== null && (m.status === 'entwurf' || m.status === 'freigegeben')
  )
}

/** The badge on the tab: the proposals, plus what is taken over and not finished. */
export function anzahlOffen(
  eintraege: readonly SmdBeitragFelder[],
  meldungStatus: ReadonlyMap<string, string> = new Map()
): number {
  return eintraege.filter((e) => {
    if (!bleibtAufDemTisch(e, meldungStatus.get(e.id) ?? null)) return false
    return e.vorschlag === true || e.entscheid === 'uebernommen'
  }).length
}

/** Which article belongs to which row — keyed by the row, so a discarded article cannot hide a later one. */
export function meldungJeBeitrag<T extends { smd_beitrag?: { id: string } | null }>(
  meldungen: readonly T[]
): Map<string, T> {
  const karte = new Map<string, T>()
  for (const meldung of meldungen) {
    const ursprung = meldung.smd_beitrag ?? null
    if (ursprung !== null) karte.set(ursprung.id, meldung)
  }
  return karte
}

/** The hand-started run, mirrored from the extension's process — the twin of `KantonLaufStatus`. */
export interface SmdLaufStatus {
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
export function laufText(status: SmdLaufStatus): string | null {
  if (status.laeuft) {
    return 'Der Lauf ist unterwegs — die neuen Dossiers werden gelesen und die Verlagsseiten gefragt, das dauert ein bis zwei Minuten; die Ansicht aktualisiert sich von selbst.'
  }
  if (status.beendet_um === null) return null
  if (status.ergebnis === null) return 'Der letzte Lauf hat nichts zurückgemeldet.'
  const e = status.ergebnis
  const links = (typeof e['links'] === 'object' && e['links'] !== null ? e['links'] : {}) as Record<
    string,
    unknown
  >
  const teile = [
    `${anzahl(e['mails'])} neue Dossiers`,
    `${anzahl(e['dokumente'])} Dokumente`,
    `${anzahl(e['neu'])} neue Beiträge`,
    `${anzahl(links['gefunden'])} online gefunden`,
    `${anzahl(e['vorschlaege'])} Vorschläge`
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
