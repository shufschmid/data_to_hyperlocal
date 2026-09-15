// The run's rules: which list entries are worth a detail fetch, how many, and
// how the parse results become one row. Pure, so the rules are tested without
// a network or a database.

import { verschiebe } from '../../redaktion/feiertage'
import type { DetailInhalt } from './detail'
import type { Plattform } from './erkennung'
import type { ListenEintrag } from './liste'
import { kappe, TEXT_MAX_ZEICHEN } from './text'

/** A first read of a page imports the last week, never the archive. */
export const ERSTLAUF_TAGE = 7
/** A daily read looks back three days: what was posted after yesterday's run, plus slack. */
export const NACHLAUF_TAGE = 3
/** Detail pages per host per run — a burst is worked off over mornings and declared. */
export const DETAILS_JE_HOST = 15
/** Documents read per item; the rest are listed as links. */
export const ANHAENGE_MAX = 3
export const ANHANG_MAX_BYTES = 15 * 1024 * 1024

export function fensterSeit(
  heute: string,
  erstlauf: boolean,
  nachlauf = NACHLAUF_TAGE,
  erstlaufTage = ERSTLAUF_TAGE
): string {
  return verschiebe(heute, -(erstlauf ? erstlaufTage : nachlauf))
}

/**
 * Entries recent enough to matter. Undated entries ride along on a daily run
 * (their detail page will date them) but not on a first run — without a date
 * there is no way to tell a fresh item from the archive.
 */
/**
 * What the window lets through: dated entries from `seit` on. An undated
 * entry is never opened — not even to date it from its page. It used to be,
 * on daily runs, and that was the archive's back door: an i-web list carries
 * its whole history, every entry the date check dropped became a "new"
 * item, and fifteen detail pages a day went to minutes from 2020 that the
 * desk then showed as news. Undated entries are counted instead, and the
 * run names them on the municipality's status line.
 */
export function kandidaten(
  eintraege: readonly ListenEintrag[],
  seit: string
): { drin: ListenEintrag[]; undatiert: ListenEintrag[] } {
  const drin: ListenEintrag[] = []
  const undatiert: ListenEintrag[] = []
  for (const e of eintraege) {
    if (e.datum === null) undatiert.push(e)
    else if (e.datum >= seit) drin.push(e)
  }
  return { drin, undatiert }
}

/** How many undated entries the status line names before it counts the rest. */
const GENANNTE_UNDATIERTE = 3

/**
 * The status line for undated entries names them, so an editor can tell a
 * standing notice (Reinach lists its permanent speed-check page among the
 * news, undated) from a parser that misses a date format.
 */
export function ohneDatumHinweis(undatiert: readonly ListenEintrag[]): string {
  const titel = undatiert
    .slice(0, GENANNTE_UNDATIERTE)
    .map((e) => `«${e.titel}»`)
    .join(', ')
  const rest = undatiert.length - GENANNTE_UNDATIERTE
  return `Ohne erkennbares Datum nicht gelesen: ${titel}${rest > 0 ? ` (+${rest} weitere)` : ''}`
}

/** Newest first, undated last, at most `deckel` — the rest is counted, not forgotten. */
export function waehleZuLesen(
  neue: readonly ListenEintrag[],
  deckel = DETAILS_JE_HOST
): { zuLesen: ListenEintrag[]; nichtGelesen: number } {
  const sortiert = [...neue].sort((a, b) => {
    if (a.datum === null && b.datum === null) return 0
    if (a.datum === null) return 1
    if (b.datum === null) return -1
    return b.datum.localeCompare(a.datum)
  })
  return {
    zuLesen: sortiert.slice(0, deckel),
    nichtGelesen: Math.max(0, sortiert.length - deckel)
  }
}

export type DatumQuelle = 'liste' | 'kalender' | 'detail' | 'keins'

/**
 * Which date the row carries. A full date on the detail page beats a calendar
 * badge whose year was inferred; otherwise the list's date stands and the
 * detail page fills the gap.
 */
export function bestimmeDatum(
  eintrag: Pick<ListenEintrag, 'datum' | 'datumQuelle'>,
  detailDatum: string | null
): { datum: string | null; quelle: DatumQuelle } {
  if (eintrag.datumQuelle === 'kalender' && detailDatum !== null)
    return { datum: detailDatum, quelle: 'detail' }
  if (eintrag.datum !== null)
    return { datum: eintrag.datum, quelle: eintrag.datumQuelle ?? 'liste' }
  if (detailDatum !== null) return { datum: detailDatum, quelle: 'detail' }
  return { datum: null, quelle: 'keins' }
}

export type AnhangGrund =
  | 'deckel'
  | 'zu_gross'
  | 'kein_pdf'
  | 'nicht_erreichbar'
  | 'robots'
  | 'fremde_site'
  | 'kein_text'

export interface Anhang {
  bezeichnung: string
  url: string
  typ: 'pdf' | 'link'
  gelesen: boolean
  grund?: AnhangGrund
  groesse?: number
  seiten?: number
  text?: string | null
  abgeschnitten?: boolean
}

export interface MitteilungsZeile {
  gemeinde: string
  url: string
  url_kanonisch: string | null
  quelle_seite: string
  plattform: Plattform
  titel: string
  teaser: string | null
  publiziert_am: string | null
  kategorie: string | null
  inhalt_typ: 'html' | 'pdf'
  text: string | null
  text_abgeschnitten: boolean
  anhaenge: Anhang[]
  hinweise: string[] | null
  gelesen_am: string
}

export interface ZeilenEingabe {
  eintrag: ListenEintrag
  /** The parsed detail page, or null when the item was a file. */
  detail: DetailInhalt | null
  /** The text layer of a directly linked PDF, or null. */
  pdf: { text: string; seiten: number } | null
  anhaenge: Anhang[]
  gemeindeId: string
  quelleSeite: string
  plattform: Plattform
  gelesenAm: string
}

/**
 * The ONE mapping from parse results to columns. Every cap that bit and every
 * inference made is written into `hinweise`, so the desk can say it.
 */
export function zeileAus(eingabe: ZeilenEingabe): MitteilungsZeile {
  const { eintrag, detail, pdf, anhaenge } = eingabe
  const hinweise: string[] = []

  const rohText = pdf !== null ? pdf.text : (detail?.text ?? '')
  const gekappt = kappe(rohText.trim(), TEXT_MAX_ZEICHEN)
  if (gekappt.abgeschnitten) hinweise.push('Text gekürzt')
  if (gekappt.text === '') hinweise.push('Kein Text gefunden')

  const { datum, quelle } = bestimmeDatum(eintrag, detail?.datum ?? null)
  if (quelle === 'kalender')
    hinweise.push('Datum aus Kalender ohne Jahresangabe abgeleitet')
  if (quelle === 'detail') hinweise.push('Datum von der Detailseite übernommen')
  if (quelle === 'keins') hinweise.push('Kein Datum gefunden')

  if (pdf !== null) hinweise.push('Direkt verlinktes PDF – Text aus dem PDF')
  if (detail?.verfahren === 'generisch')
    hinweise.push('Inhalt generisch extrahiert – Seitenaufbau unbekannt')

  const ungelesen = anhaenge.filter((a) => !a.gelesen).length
  if (ungelesen > 0)
    hinweise.push(
      `${ungelesen} ${ungelesen === 1 ? 'Anhang' : 'Anhänge'} nicht gelesen`
    )

  return {
    gemeinde: eingabe.gemeindeId,
    url: eintrag.url,
    url_kanonisch: detail?.kanonisch ?? null,
    quelle_seite: eingabe.quelleSeite,
    plattform: eingabe.plattform,
    titel: detail?.titel ?? eintrag.titel,
    teaser: eintrag.teaser ?? detail?.lead ?? null,
    publiziert_am: datum,
    kategorie: eintrag.kategorie,
    inhalt_typ: pdf !== null ? 'pdf' : 'html',
    text: gekappt.text === '' ? null : gekappt.text,
    text_abgeschnitten: gekappt.abgeschnitten,
    anhaenge,
    hinweise: hinweise.length === 0 ? null : hinweise,
    gelesen_am: eingabe.gelesenAm
  }
}
