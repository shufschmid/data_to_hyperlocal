// The run's rules: which list entries are worth a detail fetch, how many, and
// how the parse results become one row. Pure, so the rules are tested without
// a network or a database.

import { verschiebe } from '../../redaktion/feiertage'
import type { DetailInhalt } from './detail'
import { listenArt, type Plattform, type Seitenart } from './erkennung'
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

/**
 * How far ahead the events window reaches.
 *
 * Two months is what a municipal events list actually talks about: measured on
 * 18.09.2026, Binningen's page carried 201 entries for the whole year and
 * Aesch's 21 into December, so without an upper bound a single first read
 * would put December's Christmas market on September's desk and let it lie
 * there for three months. Sixty days is long enough that a registration
 * deadline or an Einwohnerratssitzung is still worth writing about, and short
 * enough that the desk stays a desk.
 */
export const VERANSTALTUNGS_FENSTER_TAGE = 60

/**
 * The events window, and the one thing the events page really does
 * differently: it runs FORWARD. A news item is past and the question is how
 * old it is; an event lies ahead and the question is how far. An event that
 * has taken place is no longer news, so it never enters — the inversion of
 * `kandidaten`, and the reason the two are separate functions rather than one
 * with a flag.
 *
 * Undated entries are counted and named, exactly as on the news side.
 */
export function terminKandidaten(
  eintraege: readonly ListenEintrag[],
  heute: string,
  tage = VERANSTALTUNGS_FENSTER_TAGE
): { drin: ListenEintrag[]; undatiert: ListenEintrag[] } {
  const bis = verschiebe(heute, tage)
  const drin: ListenEintrag[] = []
  const undatiert: ListenEintrag[] = []
  for (const e of eintraege) {
    if (e.veranstaltungAm === null) undatiert.push(e)
    else if (e.veranstaltungAm >= heute && e.veranstaltungAm <= bis)
      drin.push(e)
  }
  return { drin, undatiert }
}

/** How many undated entries the status line names before it counts the rest. */
const GENANNTE_UNDATIERTE = 3

/**
 * The status line for a page whose entries carry no date at all — the run
 * names the first few, so an editor can tell a page of standing notices from
 * a parser that misses a date format. A single undated entry among dated
 * news (Reinach lists its permanent speed-check page there) never reaches
 * the status line; it is named in the run's result instead.
 */
export function ohneDatumHinweis(undatiert: readonly ListenEintrag[]): string {
  const titel = undatiert
    .slice(0, GENANNTE_UNDATIERTE)
    .map((e) => `«${e.titel}»`)
    .join(', ')
  const rest = undatiert.length - GENANNTE_UNDATIERTE
  return `Kein Eintrag trägt ein erkennbares Datum — nichts gelesen: ${titel}${rest > 0 ? ` (+${rest} weitere)` : ''}`
}

/**
 * Newest first, undated last, at most `deckel` — the rest is counted, not
 * forgotten. For events the order turns round with the window: soonest first,
 * because the cap should bite on December and never on next Saturday.
 */
export function waehleZuLesen(
  neue: readonly ListenEintrag[],
  deckel = DETAILS_JE_HOST,
  art: Seitenart = 'nachricht'
): { zuLesen: ListenEintrag[]; nichtGelesen: number } {
  const tag = (e: ListenEintrag): string | null =>
    art === 'termin' ? e.veranstaltungAm : e.datum
  const sortiert = [...neue].sort((a, b) => {
    const [x, y] = [tag(a), tag(b)]
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return art === 'termin' ? x.localeCompare(y) : y.localeCompare(x)
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
  /** The day the event takes place — set on an events row, null on a news row. */
  veranstaltung_am: string | null
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
  /** Which door the page came through; the row says when it was the crawler. */
  transport?: 'direkt' | 'crawler'
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

  // A Termin's two dates never merge. Measured on all six events pages: not
  // one prints when the entry was published, and the detail page prints the
  // event's own day — so reading a detail date as a publication date would
  // quietly make the event date do both jobs, and the cleanup would then
  // retire a row by the day it happens rather than by the day it was posted.
  // The row says so instead of leaving the column empty without a word.
  const istTermin = listenArt(eingabe.plattform) === 'termin'
  const { datum, quelle } = istTermin
    ? { datum: null, quelle: 'keins' as DatumQuelle }
    : bestimmeDatum(eintrag, detail?.datum ?? null)
  if (istTermin)
    hinweise.push('Veranstaltung — die Seite nennt kein Publikationsdatum')
  if (quelle === 'kalender')
    hinweise.push('Datum aus Kalender ohne Jahresangabe abgeleitet')
  if (quelle === 'detail') hinweise.push('Datum von der Detailseite übernommen')
  if (!istTermin && quelle === 'keins') hinweise.push('Kein Datum gefunden')

  if (pdf !== null) hinweise.push('Direkt verlinktes PDF – Text aus dem PDF')
  if (detail?.verfahren === 'generisch')
    hinweise.push('Inhalt generisch extrahiert – Seitenaufbau unbekannt')
  if (eingabe.transport === 'crawler') hinweise.push('Über den Crawler gelesen')

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
    veranstaltung_am: eintrag.veranstaltungAm,
    kategorie: eintrag.kategorie,
    inhalt_typ: pdf !== null ? 'pdf' : 'html',
    text: gekappt.text === '' ? null : gekappt.text,
    text_abgeschnitten: gekappt.abgeschnitten,
    anhaenge,
    hinweise: hinweise.length === 0 ? null : hinweise,
    gelesen_am: eingabe.gelesenAm
  }
}
