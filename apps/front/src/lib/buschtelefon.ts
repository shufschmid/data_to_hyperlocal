import type { BuschtelefonFundFelder } from '@/graphql/redaktion'

// Presentation rules for the Buschtelefon desk. Pure, so they are tested
// without a component. The same shape as `lib/smd.ts` on purpose — the desks
// work the same way. What differs: the material is raw, unconfirmed posts of
// private persons, so the desk says so at all times, and there is no model
// proposal and no learning.

export { datumText } from './amtsblatt'

/** Why a find is turned down. «personenbezug» and «unbestaetigt» are this desk's own. */
export const ABLEHNUNGSGRUENDE: { wert: string; text: string }[] = [
  { wert: 'nicht_relevant', text: 'Nicht relevant' },
  { wert: 'unbestaetigt', text: 'Nicht zu bestätigen' },
  { wert: 'personenbezug', text: 'Betrifft eine Privatperson' },
  { wert: 'doublette', text: 'Doublette' },
  { wert: 'veraltet', text: 'Veraltet' },
  { wert: 'andere', text: 'Anderer Grund' }
]

/** Always shown on the desk: what these finds are. */
export const MATERIAL_HINWEIS =
  'Rohmaterial aus den sozialen Netzwerken der Gemeinden, von Privatpersonen geschrieben und nicht bestätigt. ' +
  'Ein Fund ist ein Anhaltspunkt, kein Beleg. Gruppe, Konto und Link erscheinen nie in einer Meldung. ' +
  'Die Meldung entsteht auf Klick, trägt «nicht bestätigt» und läuft einzeln durch die normale Statusmaschine.'

/** The channel as an editor reads it. */
export function kanalText(kanal: string): string {
  switch (kanal) {
    case 'facebook':
      return 'Facebook'
    case 'instagram':
      return 'Instagram'
    case 'tiktok':
      return 'TikTok'
    default:
      return kanal
  }
}

/** «12 Kommentare · 40 Reaktionen · 3 geteilt» — only what the door knows. */
export function zahlenText(
  fund: Pick<BuschtelefonFundFelder, 'n_kommentare' | 'n_reaktionen' | 'n_geteilt'>
): string {
  const teile = [`${fund.n_kommentare} ${fund.n_kommentare === 1 ? 'Kommentar' : 'Kommentare'}`]
  if (fund.n_reaktionen !== null) teile.push(`${fund.n_reaktionen} Reaktionen`)
  if (fund.n_geteilt !== null) teile.push(`${fund.n_geteilt} geteilt`)
  return teile.join(' · ')
}

/** What the post is called on the desk: its title, else the start of its text. */
export function fundTitel(fund: Pick<BuschtelefonFundFelder, 'titel' | 'text' | 'zusammenfassung'>): string {
  const t = (fund.titel ?? '').trim()
  if (t !== '') return t
  const text = (fund.zusammenfassung ?? fund.text ?? '').trim()
  if (text === '') return '(ohne Text)'
  return text.length > 90 ? `${text.slice(0, 87)}…` : text
}

/**
 * What stays on the desk: the open finds, and a taken-over one while its
 * Meldung is still being edited. Everything decided leaves at once.
 */
export function bleibtAufDemTisch(
  fund: BuschtelefonFundFelder,
  meldungStatus: string | null = null
): boolean {
  if (fund.entscheid === 'offen') return true
  if (fund.entscheid !== 'uebernommen') return false
  if (meldungStatus === null) return false
  return meldungStatus !== 'publiziert' && meldungStatus !== 'verworfen'
}

/** Newest post first; where the date is unknown, by when the newsroom received it. */
export function sortiere(funde: readonly BuschtelefonFundFelder[]): BuschtelefonFundFelder[] {
  const zeit = (f: BuschtelefonFundFelder) => f.veroeffentlicht_am ?? f.erfasst_am
  return [...funde].sort((a, b) => zeit(b).localeCompare(zeit(a)))
}

export interface Filter {
  gemeinde: string | null
  kanal: string | null
  suche: string
}

function normalisiere(text: string): string {
  return text.toLocaleLowerCase('de-CH').normalize('NFD').replace(/\p{M}/gu, '')
}

export function passt(fund: BuschtelefonFundFelder, filter: Filter): boolean {
  if (filter.gemeinde !== null && fund.gemeinde?.id !== filter.gemeinde) return false
  if (filter.kanal !== null && fund.kanal !== filter.kanal) return false
  if (filter.suche.trim() === '') return true
  const suche = normalisiere(filter.suche.trim())
  return [fund.titel ?? '', fund.text ?? '', fund.gemeinde?.name ?? '', fund.quelle_name ?? '']
    .map(normalisiere)
    .some((feld) => feld.includes(suche))
}

/** The channels on the desk, for the filter. */
export function kanaele(funde: readonly BuschtelefonFundFelder[]): string[] {
  return [...new Set(funde.map((f) => f.kanal))].sort((a, b) => a.localeCompare(b, 'de-CH'))
}

export function tisch(
  funde: readonly BuschtelefonFundFelder[],
  filter: Filter,
  meldungStatus: ReadonlyMap<string, string> = new Map()
): BuschtelefonFundFelder[] {
  return sortiere(
    funde.filter((f) => bleibtAufDemTisch(f, meldungStatus.get(f.id) ?? null) && passt(f, filter))
  )
}

/** The badge on the tab: finds still undecided, plus what is taken over and not finished. */
export function anzahlOffen(
  funde: readonly BuschtelefonFundFelder[],
  meldungStatus: ReadonlyMap<string, string> = new Map()
): number {
  return funde.filter((f) => bleibtAufDemTisch(f, meldungStatus.get(f.id) ?? null)).length
}

/** Which article belongs to which find — keyed by the find, so a discarded article cannot hide a later one. */
export function meldungJeFund<T extends { buschtelefon_fund?: { id: string } | null }>(
  meldungen: readonly T[]
): Map<string, T> {
  const karte = new Map<string, T>()
  for (const meldung of meldungen) {
    const ursprung = meldung.buschtelefon_fund ?? null
    if (ursprung !== null) karte.set(ursprung.id, meldung)
  }
  return karte
}

/** The hand-started run, mirrored from the extension's process, plus whether the feed is set up. */
export interface BuschtelefonLaufStatus {
  laeuft: boolean
  gestartet_um: string | null
  beendet_um: string | null
  ergebnis: Record<string, unknown> | null
  fehler: string | null
  eingerichtet?: boolean
  /** Names of the missing environment variables — never values. */
  fehlend?: string[]
}

function anzahl(wert: unknown): number {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : 0
}

/** Set when the feed lacks its configuration: says so, by name. */
export function einrichtungText(status: BuschtelefonLaufStatus | null): string | null {
  if (status === null || status.eingerichtet !== false) return null
  const fehlend = status.fehlend ?? []
  return fehlend.length === 0
    ? 'Der Abnehmer ist nicht eingerichtet.'
    : `Der Abnehmer ist nicht eingerichtet, es fehlt: ${fehlend.join(', ')}.`
}

/** What the desk says about the run: under way, or what the last one brought. */
export function laufText(status: BuschtelefonLaufStatus): string | null {
  if (status.laeuft) return 'Der Abruf ist unterwegs, die Ansicht aktualisiert sich von selbst.'
  if (status.beendet_um === null) return null
  if (status.ergebnis === null) return 'Der letzte Abruf hat nichts zurückgemeldet.'
  const e = status.ergebnis
  if (e['status'] === 'nicht_eingerichtet') return null
  const teile = [
    `${anzahl(e['gelesen'])} gelesen`,
    `${anzahl(e['neu'])} neu`,
    `${anzahl(e['aktualisiert'])} aktualisiert`
  ]
  const ohne = anzahl(e['ohneGemeinde'])
  if (ohne > 0) teile.push(`${ohne} ohne Gemeinde`)
  const fehler = Array.isArray(e['fehler']) ? e['fehler'].length : 0
  if (fehler > 0) teile.push(`${fehler} Fehler`)
  const uhrzeit = new Date(status.beendet_um).toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich'
  })
  return `Letzter Abruf um ${uhrzeit} Uhr: ${teile.join(', ')}.`
}
