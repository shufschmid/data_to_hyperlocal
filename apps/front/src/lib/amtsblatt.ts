import type { AmtsblattFelder, GemeindeFelder } from '@/graphql/redaktion'

// Presentation rules for the official gazette desk. Pure, so they are tested
// without a component.

export const GRUPPEN: { wert: string; text: string }[] = [
  { wert: 'bauen', text: 'Bauen, Planung, Verkehr' },
  { wert: 'wirtschaft', text: 'Handelsregister' },
  { wert: 'behoerden', text: 'Behörden & Bürgerrecht' },
  { wert: 'grundbuch', text: 'Grundbuch' },
  { wert: 'personen', text: 'Konkurse & Betreibungen' }
]

export function gruppenText(gruppe: string | null): string {
  return GRUPPEN.find((g) => g.wert === gruppe)?.text ?? 'Übriges'
}

export const ABLEHNUNGSGRUENDE: { wert: string; text: string }[] = [
  { wert: 'nicht_relevant', text: 'Nicht relevant' },
  { wert: 'zu_privat', text: 'Zu privat' },
  { wert: 'doublette', text: 'Doublette' },
  { wert: 'veraltet', text: 'Veraltet' },
  { wert: 'falsche_gemeinde', text: 'Falsche Gemeinde' },
  { wert: 'andere', text: 'Anderer Grund' }
]

/**
 * What stays on the desk.
 *
 * The desk shows WORK, not history — the same rule as the press review, and it
 * has to be the same rule: a taken-over publication whose Meldung is still
 * being edited belongs here, because the editing happens here. Dropping it the
 * moment the Meldung existed made the row vanish under the editor's hands with
 * nothing on screen to say where the article had gone.
 *
 * Rejected and handed-up rows leave at once; so does a Meldung that is
 * published or discarded. The rows themselves stay in the database — they are
 * this feed's memory.
 */
export function bleibtAufDemTisch(eintrag: AmtsblattFelder, meldungStatus: string | null = null): boolean {
  if (eintrag.entscheid === 'offen') return true
  if (eintrag.entscheid !== 'uebernommen') return false
  if (meldungStatus === null) return false
  return meldungStatus !== 'publiziert' && meldungStatus !== 'verworfen'
}

/**
 * Proposals first, then everything else, each by deadline and then by date.
 *
 * The deadline leads within a group because it is the only thing here that
 * expires: a building permit whose objection period runs out on Monday is worth
 * more today than a council decision from the same morning.
 */
export function sortiere(eintraege: readonly AmtsblattFelder[]): AmtsblattFelder[] {
  return [...eintraege].sort((a, b) => {
    if (a.frist !== null && b.frist !== null && a.frist !== b.frist) return a.frist < b.frist ? -1 : 1
    if (a.frist !== null && b.frist === null) return -1
    if (a.frist === null && b.frist !== null) return 1
    return (b.publiziert_am ?? '').localeCompare(a.publiziert_am ?? '')
  })
}

export interface Filter {
  gemeinde: string | null
  gruppe: string | null
  suche: string
}

function normalisiere(text: string): string {
  // `\p{M}` rather than a literal character range — combining characters are
  // invisible in a diff and break silently. Same rule as `lib/redaktion.ts`.
  return text.toLocaleLowerCase('de-CH').normalize('NFD').replace(/\p{M}/gu, '')
}

export function passt(eintrag: AmtsblattFelder, filter: Filter): boolean {
  if (filter.gemeinde !== null && eintrag.gemeinde?.id !== filter.gemeinde) return false
  if (filter.gruppe !== null && eintrag.gruppe !== filter.gruppe) return false
  if (filter.suche.trim() === '') return true
  const suche = normalisiere(filter.suche.trim())
  return [eintrag.titel, eintrag.rubrik_name ?? '', eintrag.amt ?? '', eintrag.gemeinde?.name ?? '']
    .map(normalisiere)
    .some((feld) => feld.includes(suche))
}

export interface Tisch {
  /** What the triage put forward — the top of the desk. */
  vorschlaege: AmtsblattFelder[]
  /** Everything else it collected, one click away. Never hidden, only folded. */
  uebrige: AmtsblattFelder[]
}

/**
 * The desk in two piles.
 *
 * `vorschlag === null` — the triage did not get to it — belongs with the rest
 * and not with the proposals: undecided is not a recommendation. It is also not
 * a rejection, which is why nothing is ever dropped here.
 */
export function tisch(
  eintraege: readonly AmtsblattFelder[],
  filter: Filter,
  meldungStatus: ReadonlyMap<string, string> = new Map()
): Tisch {
  const offen = sortiere(
    eintraege.filter((e) => bleibtAufDemTisch(e, meldungStatus.get(e.id) ?? null) && passt(e, filter))
  )
  return {
    vorschlaege: offen.filter((e) => e.vorschlag === true),
    uebrige: offen.filter((e) => e.vorschlag !== true)
  }
}

/** The badge on the tab: what the desk actually shows. */
export function anzahlOffen(
  eintraege: readonly AmtsblattFelder[],
  meldungStatus: ReadonlyMap<string, string> = new Map()
): number {
  return eintraege.filter((e) => bleibtAufDemTisch(e, meldungStatus.get(e.id) ?? null)).length
}

/**
 * Which article belongs to which publication.
 *
 * Keyed by the publication, not the article: the desk asks "is there one for
 * this row", and a discarded article must not hide a later one.
 */
export function meldungJePublikation<T extends { amtsblattmeldung: { id: string } | null }>(
  meldungen: readonly T[]
): Map<string, T> {
  const karte = new Map<string, T>()
  for (const meldung of meldungen) {
    if (meldung.amtsblattmeldung !== null) karte.set(meldung.amtsblattmeldung.id, meldung)
  }
  return karte
}

/**
 * The label a link gets, derived from its kind rather than read back.
 *
 * The connector stores a `bezeichnung` too, but that string is data at rest:
 * rows written before a wording change keep the old one for ever. A UI label
 * belongs in the UI, where correcting it corrects every row at once.
 */
const UNTERLAGEN_TEXT: Record<string, string> = {
  plaene: 'Baugesuchspläne',
  akten: 'Gesuchsunterlagen',
  ebau: 'Baugesuch im eBau-Portal',
  karte: 'Lage auf der Karte',
  andere: 'Weitere Unterlagen'
}

export function unterlagenText(art: string): string {
  return UNTERLAGEN_TEXT[art] ?? 'Unterlagen'
}

/**
 * The document a reader can open, if any.
 *
 * The map deep-link is orientation for the editor, not a source — it is offered
 * separately, never as "the documents".
 */
export function unterlage(
  eintrag: AmtsblattFelder
): { art: string; bezeichnung: string; url: string; lesbar: boolean } | null {
  const alle = eintrag.unterlagen ?? []
  for (const art of ['plaene', 'akten', 'ebau']) {
    const treffer = alle.find((u) => u.art === art)
    if (treffer !== undefined) return treffer
  }
  return null
}

export function karte(eintrag: AmtsblattFelder): string | null {
  return (eintrag.unterlagen ?? []).find((u) => u.art === 'karte')?.url ?? null
}

/**
 * Whether the "read the documents" button does anything.
 *
 * Only Baselland publishes its building plans as plain images; Basel-Stadt and
 * Solothurn keep theirs behind viewers we cannot parse. The button is hidden
 * rather than shown-and-failing, and the link stays either way so the editor
 * can look for herself.
 */
export function kannUnterlagenLesen(eintrag: AmtsblattFelder): boolean {
  if (eintrag.plan_status === 'liest' || eintrag.plan_status === 'gelesen') return false
  return (eintrag.unterlagen ?? []).some((u) => u.lesbar)
}

export function liestUnterlagen(eintraege: readonly AmtsblattFelder[]): boolean {
  return eintraege.some((e) => e.plan_status === 'liest')
}

const PLAN_TEXT: Record<string, string> = {
  offen: 'Unterlagen noch nicht gelesen',
  liest: 'Unterlagen werden gelesen …',
  gelesen: 'Unterlagen gelesen',
  nicht_lesbar: 'Keine maschinell lesbaren Unterlagen',
  fehler: 'Unterlagen konnten nicht gelesen werden'
}

export function planStatusText(status: string): string {
  return PLAN_TEXT[status] ?? status
}

/**
 * Municipalities whose commercial-register and bankruptcy half stays invisible.
 *
 * Named rather than left silent: with no postcode the portal simply returns
 * nothing for that half, and an absence is indistinguishable from "nothing was
 * published".
 */
export function ohnePlz(gemeinden: readonly GemeindeFelder[]): GemeindeFelder[] {
  return gemeinden.filter((g) => g.aktiv && (g.plz ?? []).length === 0)
}

/** `2026-09-07` → `7. September 2026`. Absolute, never "in einer Woche". */
const MONATE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember'
]

export function datumText(iso: string | null): string {
  if (iso === null) return ''
  const [jahr, monat, tag] = iso.split('-')
  const name = MONATE[Number(monat) - 1]
  if (jahr === undefined || tag === undefined || name === undefined) return iso
  return `${Number(tag)}. ${name} ${jahr}`
}

/** Days until a deadline, negative once it has passed. `null` when there is none. */
export function tageBisFrist(frist: string | null, heute: string): number | null {
  if (frist === null) return null
  const ms = Date.parse(`${frist}T00:00:00Z`) - Date.parse(`${heute}T00:00:00Z`)
  if (Number.isNaN(ms)) return null
  return Math.round(ms / 86_400_000)
}
