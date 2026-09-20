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
/**
 * Detail pages per host per run — a burst is worked off over mornings and
 * declared. ONE budget for the host, not one per page: a municipality's news
 * page and its events page sit on the same server, and the reader promises it
 * a spacing that a budget per page would quietly halve.
 */
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
 * with a flag. A SPAN is measured by its last day: an exhibition that opened
 * months ago is still in the window while it runs, so its end can be seen.
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
    if (e.veranstaltungAm === null) {
      undatiert.push(e)
      continue
    }
    // A span counts until its LAST day: a running exhibition stays in the
    // window until it ends, which is what makes its end a "last chance".
    const ende = e.veranstaltungBis ?? e.veranstaltungAm
    if (ende >= heute && e.veranstaltungAm <= bis) drin.push(e)
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

/** One page of a host and the entries of it nobody has read yet. */
export interface SeitenEingang {
  art: Seitenart
  neue: readonly ListenEintrag[]
}

/** What that page gets out of the host's budget, and what was left lying. */
export interface SeitenAuswahl {
  art: Seitenart
  zuLesen: ListenEintrag[]
  nichtGelesen: number
}

function tageZwischen(von: string, bis: string): number {
  const ms =
    Date.parse(`${bis.slice(0, 10)}T00:00:00Z`) -
    Date.parse(`${von.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(ms)
    ? Number.MAX_SAFE_INTEGER
    : Math.round(ms / 86_400_000)
}

/**
 * How urgent one entry is: its distance from today, in days.
 *
 * A news item is past and an event lies ahead, so the two lie on opposite
 * sides of today — and that is exactly why the distance is their common
 * measure. It is the desk's own rule (`dringlichkeit` in the frontend), and
 * using it here means the budget buys what the desk would show at the top.
 */
function abstandZuHeute(
  eintrag: ListenEintrag,
  art: Seitenart,
  heute: string
): number {
  const tag = art === 'termin' ? eintrag.veranstaltungAm : eintrag.datum
  if (tag === null) return Number.MAX_SAFE_INTEGER
  return art === 'termin' ? tageZwischen(heute, tag) : tageZwischen(tag, heute)
}

/**
 * ONE budget for one host and one run, shared by the two pages of a
 * municipality — its news page and its events page sit on the same server, so
 * fifteen detail fetches per page would be thirty requests at that server and
 * twice the politeness the reader promises.
 *
 * Who gets it is decided ACROSS the pages, by distance from today, not by a
 * fixed order of the pages. A fixed order was the other answer and it breaks
 * on its own examples: news first loses tomorrow's event to a notice from the
 * day before yesterday, events first loses today's news to a Christmas market
 * in November. Both kinds are perishable, only in opposite directions, and the
 * distance to today is what says which one perishes first.
 *
 * At an equal distance the event goes first: it is gone the day after it takes
 * place, while a news item still has the rest of the look-back window to be
 * read in. Undated entries sort last, though `kandidaten` never hands one over.
 * Whatever the budget did not reach is counted per page, not forgotten — the
 * run declares it, and tomorrow reads it.
 */
export function verteileDetailbudget(
  seiten: readonly SeitenEingang[],
  heute: string,
  deckel = DETAILS_JE_HOST
): SeitenAuswahl[] {
  const alle = seiten.flatMap((seite, seitenNr) =>
    seite.neue.map((eintrag) => ({
      eintrag,
      seitenNr,
      abstand: abstandZuHeute(eintrag, seite.art, heute),
      termin: seite.art === 'termin' ? 0 : 1
    }))
  )
  alle.sort((a, b) => a.abstand - b.abstand || a.termin - b.termin)

  const auswahl: SeitenAuswahl[] = seiten.map((seite) => ({
    art: seite.art,
    zuLesen: [],
    nichtGelesen: seite.neue.length
  }))
  for (const kandidat of alle.slice(0, Math.max(0, deckel))) {
    const seite = auswahl[kandidat.seitenNr]
    if (seite === undefined) continue
    seite.zuLesen.push(kandidat.eintrag)
    seite.nichtGelesen -= 1
  }
  return auswahl
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
