import { decodeEntities } from '../agenda/parse'

// Reading a table from the statistics office's web portal.
//
// Not everything the office publishes reaches the open-data portal. Agriculture
// is the example that forced this module into existence: data.bl.ch has no
// agriculture dataset at all, while statistik.bl.ch has
// "Landwirtschaftsbetriebe nach Gemeinde" per municipality, back to 2013, at a
// stable URL with a `?year=` parameter.
//
// There is no machine-readable form — `.csv`, `.xlsx`, `.json` and
// `?format=csv` all give a 404 or the same HTML. What there is instead is a
// gift: the pages are Excel's "publish as web page" output, so the markup is
// regular in a way hand-written HTML never is.
//
// The output of this module is deliberately shaped like an Opendatasoft record,
// `{ jahr, gemeinde, <column>: number }`, so the rest of the pipeline — period
// detection, municipality matching, the figure checks — works on it unchanged
// instead of growing a second code path.

/** One municipality's row, in the shape the rest of the pipeline expects. */
export type StatblZeile = Record<string, string | number | null>

/**
 * How a table lays its years out — and the portal uses both.
 *
 * `lang`   one year per page, chosen with `?year=`, measures as columns.
 *          Excel's "publish as web page" output. Example 7_1_1_3.
 * `breit`  every year on one page, years as columns, one measure.
 *          A native page with no year selector. Example 5_1_5_3.
 *
 * Reading a wide table with the long parser is not a near miss: the year
 * headings become measure names, and "2016" turns into a column of numbers
 * whose meaning nobody states.
 */
export type TabellenForm = 'lang' | 'breit'

export interface StatblTabelle {
  /** e.g. "Landwirtschaftsbetriebe nach Gemeinde 2025". */
  titel: string
  /**
   * Wann das Amt diesen Zweig zuletzt geaendert hat, ISO — aus „Letzte
   * Änderung" der Seite.
   *
   * Nicht wann *wir* gelesen haben. Der Unterschied ist kein Detail: die
   * Zeitleiste sortiert danach, und mit unserem Lesezeitpunkt stand eine
   * Tabelle vom November 2025 zuoberst, als waere sie heute erschienen.
   */
  stand: string | null
  form: TabellenForm
  /** The period, read from the year selector. */
  jahr: string
  /** Every year the portal offers for this table, newest first. */
  jahre: string[]
  /** Column labels in order, first one is the municipality column. */
  spalten: string[]
  /** Rows of `jahr` alone. */
  zeilen: StatblZeile[]
  /**
   * Every year this page carries.
   *
   * For a wide table that is the whole series in one fetch; for a long one it
   * equals `zeilen`, and the earlier years come from `ladeReihe`.
   */
  alleZeilen: StatblZeile[]
  /**
   * Canton and district totals, kept apart on purpose.
   *
   * They are rows in the same table and look exactly like municipalities. Left
   * in, "Ganzer Kanton" would enter the cantonal average as an 87th
   * municipality and the districts five more times on top — the same class of
   * error as averaging tonnes with kilograms, and just as invisible in the
   * finished article.
   */
  aggregate: StatblZeile[]
}

/**
 * The two column names the adapter always produces.
 *
 * Exported because the pipeline has to know them without guessing:
 * `detectPeriodField` only recognises columns the portal types as `date`, and a
 * table's year is text. Left to the automatic detection, the time axis came
 * back null and the history was silently never stored — the articles then said,
 * correctly but uselessly, that no comparison values were available.
 */
export const GEMEINDE_SPALTE = 'gemeinde'
export const JAHR_SPALTE = 'jahr'

const NAME_SPALTE = GEMEINDE_SPALTE

/** Rows that summarise other rows rather than describing a municipality. */
function istAggregat(label: string): boolean {
  return /^(ganzer\s+kanton|kanton\b|bez\.|bezirk\b|total\b)/i.test(
    label.trim()
  )
}

/**
 * The region of the page that holds the data — or null, when there is none.
 *
 * The portal marks its data tables: the native ones with `class="cell_table"`,
 * the Excel exports with `x:publishsource`. There is deliberately no fallback
 * to "the first `<table>`". Every portal page is built out of tables, so that
 * fallback made a navigation page parse as data — a branch page came back as a
 * table of menu entries, which is worse than not reading it, because the
 * inventory would fill up with rows that have no numbers behind them.
 *
 * A layout we do not know is therefore counted as navigation. The inventory
 * keeps score of that instead of swallowing it.
 */
function datenBlock(html: string): string | null {
  const zelle =
    /<table[^>]*class\s*=\s*"[^"]*cell_table[^"]*"[\s\S]*?<\/table>/i.exec(html)
  if (zelle !== null) return zelle[0]

  const start = html.search(/<div[^>]*x:publishsource\s*=\s*"Excel"/i)
  return start === -1 ? null : html.slice(start)
}

/**
 * Ein Tagesdatum als ausdruecklicher Zeitpunkt in UTC.
 *
 * `daten_stand` ist eine `timestamptz`-Spalte. Ein blosses "2025-11-04" liest
 * Directus als Mitternacht Ortszeit, und weil der Prozess auf Europe/Zurich
 * laeuft, landete in der Datenbank `2025-11-03 23:00+00` — die Tabelle war in
 * der Zeitleiste einen Tag zu frueh datiert. Das Amt nennt einen Tag, also
 * sagen wir auch einen, statt eine Zeitzone raten zu lassen.
 */
export function alsZeitpunkt(datum: string | null): string | null {
  return datum === null ? null : `${datum}T00:00:00.000Z`
}

/** "Letzte Änderung: 19.05.2026" → "2026-05-19". */
export function parseLetzteAenderung(html: string): string | null {
  const treffer = /id\s*=\s*"?last_change"?[^>]*>([\s\S]*?)</i.exec(html)
  if (treffer === null) return null

  const datum = /(\d{2})\.(\d{2})\.(\d{4})/.exec(treffer[1] ?? '')
  return datum === null ? null : `${datum[3]}-${datum[2]}-${datum[1]}`
}

/**
 * The menu entries the page marks as current, deepest last.
 *
 * A wide table names its measure nowhere in the table itself — "Quadratmeterpreis"
 * is only in the navigation, as the selected entry. Without it the column would
 * be called `wert` and an article would report a bare number.
 */
export function parseAuswahl(html: string): { pfad: string; titel: string }[] {
  return [
    ...html.matchAll(
      /class\s*=\s*"selected"[^>]*href\s*=\s*"\/web_portal\/([\d_]+)"[^>]*>([\s\S]*?)<\/a>/gi
    )
  ]
    .map((treffer) => ({
      pfad: treffer[1] ?? '',
      titel: text(treffer[2] ?? '')
    }))
    .filter((eintrag) => eintrag.pfad !== '' && eintrag.titel !== '')
    .sort((a, b) => a.pfad.split('_').length - b.pfad.split('_').length)
}

/**
 * Does this page show its *own* table, or a child's?
 *
 * The portal previews: `1_4` renders the table of `1_4_5_1`, and `5_1` the one
 * of `5_1_1_1`. Read as data, the same table was registered under three or four
 * paths — and the coverage question was then asked three or four times about
 * one statistic. The navigation says who the table belongs to: the deepest
 * entry it marks as selected.
 *
 * A page without navigation at all counts as its own — the honest answer when
 * there is nothing to go by, and it keeps a saved fragment readable in tests.
 */
export function istEigeneSeite(html: string, pfad: string): boolean {
  const auswahl = parseAuswahl(html)
  if (auswahl.length === 0) return true

  return auswahl[auswahl.length - 1]?.pfad === pfad
}

/** Which page the table shown here really belongs to. */
export function tabellenBesitzer(html: string, pfad: string): string {
  const auswahl = parseAuswahl(html)
  return auswahl[auswahl.length - 1]?.pfad ?? pfad
}

/**
 * Die Zweige eines Kapitels, mit ihren Namen.
 *
 * Die Namen stehen in der oberen Navigation — `3_5` heisst dort
 * „Wohn-/Arbeitsort" — und `parseKinder` warf sie weg, weil es nur Pfade
 * zurueckgibt. In der Arbeitsflaeche stand dann „Zweig 3_5", was niemandem
 * etwas sagt.
 */
/**
 * Jeder Portallink samt seiner Beschriftung.
 *
 * Ein festes Muster statt eines aus dem Kapitel zusammengesetzten: in einem
 * Template-Literal wird `\s` zu `s`, und die so gebaute RegExp fand nichts —
 * ohne zu scheitern, sie lieferte einfach eine leere Liste.
 */
const PORTAL_LINK =
  /href\s*=\s*"\/web_portal\/([\d_]+)"[^>]*>([\s\S]{0,80}?)<\/a>/gi

function linkBeschriftungen(html: string): { pfad: string; titel: string }[] {
  return [...html.matchAll(PORTAL_LINK)].map((treffer) => ({
    pfad: treffer[1] ?? '',
    // Die Eintraege sind mit " | " aneinandergereiht; der Trenner gehoert nicht
    // zum Namen.
    titel: text(treffer[2] ?? '')
      .replace(/\s*\|\s*$/, '')
      .trim()
  }))
}

export function parseZweige(
  html: string,
  kapitel: string
): { pfad: string; titel: string }[] {
  const gefunden = new Map<string, string>()

  for (const link of linkBeschriftungen(html)) {
    const teile = link.pfad.split('_')
    if (teile.length !== 2 || teile[0] !== kapitel) continue
    if (link.titel === '' || gefunden.has(link.pfad)) continue

    gefunden.set(link.pfad, link.titel)
  }

  return [...gefunden.entries()].map(([pfad, titel]) => ({ pfad, titel }))
}

/** Der Name eines Kapitels, ohne seine Nummer: "3 Arbeit und Erwerb" → "Arbeit und Erwerb". */
export function parseKapitelName(html: string, kapitel: string): string | null {
  const treffer = linkBeschriftungen(html).find(
    (link) => link.pfad === kapitel && link.titel !== ''
  )
  if (treffer === undefined) return null

  const name = treffer.titel.replace(/^\d+\s*/, '').trim()
  return name === '' ? null : name
}

/** Every portal page this one links to below itself. */
export function parseKinder(html: string, pfad: string): string[] {
  return [
    ...new Set(
      [...html.matchAll(/href\s*=\s*"\/web_portal\/([\d_]+)"/g)].map(
        (treffer) => treffer[1] ?? ''
      )
    )
  ].filter((id) => id.startsWith(`${pfad}_`))
}

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The office's own way of writing "no value here".
 *
 * "-" means nothing was counted; "()" means the figure exists but is withheld,
 * usually because too few cases would identify someone. Both are statements,
 * and neither is the number zero.
 *
 * Getting this list wrong does not produce a wrong number — it drops the whole
 * row, because a row is only recognised as data when every cell is a number or
 * a known placeholder. `()` cost 78 of 86 municipalities in the price table
 * before it was in here.
 */
const OHNE_WERT = /^(\(\s*\)|[-–—.]|x|\.\.\.)$/i

/**
 * A number as the office writes it.
 *
 * "2 777" uses a plain space as the thousands separator, "1'132" an apostrophe.
 */
export function parseZahl(value: string): number | null {
  const roh = value.trim()
  if (roh === '' || OHNE_WERT.test(roh)) return null

  const bereinigt = roh.replace(/[\s'  ]/g, '').replace(/,(\d{1,2})$/, '.$1')

  if (!/^-?\d+(\.\d+)?$/.test(bereinigt)) return null

  const zahl = Number.parseFloat(bereinigt)
  return Number.isFinite(zahl) ? zahl : null
}

/** A column label turned into a record key: "Betriebe · total" → "betriebe_total". */
export function spaltenSchluessel(label: string): string {
  const ersetzt = label
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')

  return (
    ersetzt
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'wert'
  )
}

interface Zelle {
  inhalt: string
  colspan: number
}

function zellen(zeilenHtml: string): Zelle[] {
  return [...zeilenHtml.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map(
    (treffer) => {
      const attribute = treffer[1] ?? ''
      const colspan = /colspan\s*=\s*"?(\d+)"?/i.exec(attribute)
      return {
        inhalt: text(treffer[2] ?? ''),
        colspan: colspan === null ? 1 : Number.parseInt(colspan[1] ?? '1', 10)
      }
    }
  )
}

/** Expands colspans so a header row lines up with the data rows below it. */
function ausgebreitet(reihe: Zelle[]): string[] {
  const felder: string[] = []
  for (const zelle of reihe) {
    for (let i = 0; i < Math.max(zelle.colspan, 1); i += 1) {
      felder.push(zelle.inhalt)
    }
  }
  return felder
}

/**
 * The years the portal offers, from the `<select name="year">`.
 *
 * This is what makes the table watchable: next year's edition announces itself
 * here as a new option, and that is the whole trigger for fetching it again.
 */
export function parseJahre(html: string): {
  jahre: string[]
  aktuell: string | null
} {
  const auswahl =
    /<select[^>]*name\s*=\s*"?year"?[^>]*>([\s\S]*?)<\/select>/i.exec(html)
  if (auswahl === null) return { jahre: [], aktuell: null }

  const optionen = [
    ...(auswahl[1] ?? '').matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/gi)
  ]
  const jahre: string[] = []
  let aktuell: string | null = null

  for (const option of optionen) {
    const jahr = text(option[2] ?? '')
    if (!/^\d{4}$/.test(jahr)) continue
    jahre.push(jahr)
    if (/\bselected\b/i.test(option[1] ?? '')) aktuell = jahr
  }

  return { jahre, aktuell: aktuell ?? jahre[0] ?? null }
}

/**
 * Turns one portal page into records.
 *
 * The two header rows are combined — the office writes "Betriebe" over three
 * size classes and "Beschäftigte" over "total / Vollzeit / Teilzeit", and
 * "total" alone would be two different columns with the same name.
 */
export function parseTabelle(html: string): StatblTabelle | null {
  const block = datenBlock(html)
  if (block === null) return null

  const reihen = [...block.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((t) =>
    zellen(t[1] ?? '')
  )
  if (reihen.length === 0) return null

  const { jahre, aktuell } = parseJahre(html)

  // Where the data starts: the first row with a label and real numbers.
  const beginntDaten = (reihe: Zelle[]): boolean =>
    reihe.length >= 2 &&
    reihe[0] !== undefined &&
    reihe[0].inhalt.trim() !== '' &&
    reihe.slice(1).filter((z) => parseZahl(z.inhalt) !== null).length >= 1

  // Once it has started, a row of nothing but dashes is still a municipality.
  // Birsfelden and Diepflingen have no farms at all, and requiring one number
  // per row dropped both — 84 municipalities instead of 86, with nothing
  // anywhere to say two had gone missing. An empty row is a fact about the
  // municipality; a missing row is a fact about the parser.
  const istDatenzeile = (reihe: Zelle[]): boolean => {
    if (reihe.length < 2) return false
    const label = reihe[0]?.inhalt.trim() ?? ''
    if (label === '') return false

    const werte = reihe.slice(1).map((z) => z.inhalt.trim())
    return (
      werte.length >= 2 &&
      werte.every((w) => w === '' || OHNE_WERT.test(w) || parseZahl(w) !== null)
    )
  }

  // The wide form is decided before the data rows are located, and it has to
  // be: its header row is "Bezirk, Gemeinde | 2016 | 2017 | …", which passes
  // every test for a data row — a label followed by numbers. Searching for the
  // data first made the header the first data row, and the whole page parsed
  // as nothing.
  const jahresKopf = reihen.findIndex(
    (reihe) => ausgebreitet(reihe).filter(istJahr).length >= MIN_JAHRESSPALTEN
  )

  if (jahresKopf !== -1) {
    return leseBreiteForm(reihen, jahresKopf, istDatenzeile, html)
  }

  const ersteDaten = reihen.findIndex(beginntDaten)
  if (ersteDaten < 1) return null

  const kopfzeilen = reihen
    .slice(0, ersteDaten)
    .filter((reihe) => reihe.length >= 2)
    .slice(-2)
    .map(ausgebreitet)

  const breite = Math.max(
    ...reihen.slice(ersteDaten).map((r) => ausgebreitet(r).length),
    0
  )

  const spalten: string[] = []
  for (let i = 0; i < breite; i += 1) {
    const teile = kopfzeilen
      .map((kopf) => kopf[i] ?? '')
      // "Vollzeit1" carries a footnote marker; "0-9.9" and "10-19,9" end in a
      // digit that is part of the label. Only a digit right after a letter is a
      // footnote.
      .map((t) => t.replace(/([a-zäöüß])\s*\d$/i, '$1').trim())
      .filter((t) => t !== '')
    spalten.push(i === 0 ? NAME_SPALTE : teile.join(' ') || `spalte_${i}`)
  }

  // The Excel exports carry their title in the first row. When that row is
  // missing, the navigation holds the same information — without it the page
  // reached the coverage question as "Tabelle", and a model asked to place a
  // table called "Tabelle" can only shrug, which then counted as "covered
  // nowhere" and put it on the watch list.
  const titelZeile =
    reihen
      .slice(0, ersteDaten)
      .map((reihe) => reihe[0]?.inhalt ?? '')
      .find((t) => t.length > 8) ??
    parseAuswahl(html)
      .slice(-2)
      .map((eintrag) => eintrag.titel)
      .filter((t, i, alle) => alle.indexOf(t) === i)
      .join(' — ')

  const jahr = aktuell ?? /\b(19|20)\d{2}\b/.exec(titelZeile ?? '')?.[0] ?? ''

  const zeilen: StatblZeile[] = []
  const aggregate: StatblZeile[] = []

  for (const reihe of reihen.slice(ersteDaten)) {
    if (!istDatenzeile(reihe)) continue

    const felder = ausgebreitet(reihe)
    const label = (felder[0] ?? '').trim()
    if (label === '') continue

    const zeile: StatblZeile = { [JAHR_SPALTE]: jahr, [NAME_SPALTE]: label }

    for (let i = 1; i < spalten.length; i += 1) {
      const schluessel = spaltenSchluessel(spalten[i] ?? `spalte_${i}`)
      zeile[schluessel] = parseZahl(felder[i] ?? '')
    }

    if (istAggregat(label)) aggregate.push(zeile)
    else zeilen.push(zeile)
  }

  if (zeilen.length === 0) return null

  return {
    titel: titelZeile === '' ? 'Tabelle' : titelZeile,
    stand: alsZeitpunkt(parseLetzteAenderung(html)),
    form: 'lang',
    jahr,
    jahre: jahre.length > 0 ? jahre : jahr === '' ? [] : [jahr],
    spalten,
    zeilen,
    alleZeilen: zeilen,
    aggregate
  }
}

/** At least this many year headings before a table counts as wide. */
const MIN_JAHRESSPALTEN = 3

const istJahr = (wert: string): boolean => /^(19|20)\d{2}$/.test(wert.trim())

/**
 * The wide form: municipalities down, years across, one measure.
 *
 * Pivoted into the same long records as everything else, so nothing downstream
 * has to know which shape the page had. The measure's name comes from the
 * navigation — it appears nowhere in the table — and without it the column
 * would be called `wert`, which is how a price ends up in an article as a bare
 * number with no unit.
 */
function leseBreiteForm(
  reihen: Zelle[][],
  kopfIndex: number,
  istDatenzeile: (reihe: Zelle[]) => boolean,
  html: string
): StatblTabelle | null {
  const kopf = ausgebreitet(reihen[kopfIndex] ?? [])

  const jahresSpalten = kopf
    .map((wert, index) => ({ jahr: wert.trim(), index }))
    .filter((eintrag) => istJahr(eintrag.jahr))

  // The navigation is the only place a wide table names itself. The deepest
  // entry is the measure ("Quadratmeterpreis"), the one above it the subject
  // ("Bauland Gemeinden") — together they read like a table title, while a
  // fixed "nach Gemeinde" appended to the measure produced "Personenwagen nach
  // Gemeinde nach Gemeinde", which then went to the model as the table's name.
  const auswahl = parseAuswahl(html)
  const messgroesse = auswahl[auswahl.length - 1]?.titel ?? 'Wert'
  const schluessel = spaltenSchluessel(messgroesse)
  const titel = auswahl
    .slice(-2)
    .map((eintrag) => eintrag.titel)
    .filter((t, i, alle) => alle.indexOf(t) === i)
    .join(' — ')

  const alleZeilen: StatblZeile[] = []
  const aggregate: StatblZeile[] = []

  for (const reihe of reihen.slice(kopfIndex + 1)) {
    if (!istDatenzeile(reihe)) continue

    const felder = ausgebreitet(reihe)
    const label = (felder[0] ?? '').trim()
    if (label === '') continue

    const ziel = istAggregat(label) ? aggregate : alleZeilen

    for (const spalte of jahresSpalten) {
      ziel.push({
        [JAHR_SPALTE]: spalte.jahr,
        [NAME_SPALTE]: label,
        [schluessel]: parseZahl(felder[spalte.index] ?? '')
      })
    }
  }

  if (alleZeilen.length === 0) return null

  const jahre = [...new Set(jahresSpalten.map((s) => s.jahr))].sort().reverse()
  const jahr = jahre[0] ?? ''

  return {
    titel: titel === '' ? messgroesse : titel,
    stand: alsZeitpunkt(parseLetzteAenderung(html)),
    form: 'breit',
    jahr,
    jahre,
    spalten: [NAME_SPALTE, messgroesse],
    zeilen: alleZeilen.filter((zeile) => zeile[JAHR_SPALTE] === jahr),
    alleZeilen,
    aggregate
  }
}

/**
 * The field list, in the shape `datensaetze.felder` holds for a portal dataset.
 *
 * Written once when the table is registered, so `detectPeriodField` and the
 * rest of the pipeline can treat it exactly like an Opendatasoft dataset.
 */
export function tabellenFelder(
  tabelle: StatblTabelle
): { name: string; type: string; label: string | null; description: null }[] {
  // `description` gehoert dazu, auch wenn sie hier immer leer ist: die Liste
  // wird spaeter wie eine Katalog-Feldliste gelesen, und ein fehlender
  // Schluessel ist dort kein "kein Wert", sondern ein Zugriff auf undefined.
  const felder = [
    { name: JAHR_SPALTE, type: 'text', label: 'Jahr', description: null },
    { name: NAME_SPALTE, type: 'text', label: 'Gemeinde', description: null }
  ]

  for (const spalte of tabelle.spalten.slice(1)) {
    felder.push({
      name: spaltenSchluessel(spalte),
      type: 'double',
      label: spalte,
      description: null
    })
  }

  return felder
}

/**
 * Re-keys an older edition onto the current one's column names.
 *
 * The office renames its own headers between years: the 2013 page says
 * "Anz. Betriebe total" and "Betriebsgrösse in ha", the 2025 page says
 * "Betriebe total" and "in Hektaren". Keyed by label, the two years become two
 * disjoint series and a "compare with ten years ago" instruction quietly finds
 * nothing to compare — no error, no empty result, just an article that does not
 * mention the comparison.
 *
 * So the columns are aligned by position, which is only defensible because it
 * is checked: a table with a different number of columns is not the same table
 * and is refused rather than bent into shape.
 */
export function angleicheSpalten(
  basis: StatblTabelle,
  andere: StatblTabelle
): StatblZeile[] | null {
  if (andere.spalten.length !== basis.spalten.length) return null

  const schluessel = basis.spalten.map(spaltenSchluessel)
  const alt = andere.spalten.map(spaltenSchluessel)

  return andere.zeilen.map((zeile) => {
    const neu: StatblZeile = { jahr: zeile['jahr'] ?? andere.jahr }

    for (let i = 0; i < schluessel.length; i += 1) {
      const ziel = schluessel[i]
      const quelle = alt[i]
      if (ziel === undefined || quelle === undefined) continue
      neu[ziel] = zeile[quelle] ?? null
    }

    return neu
  })
}
