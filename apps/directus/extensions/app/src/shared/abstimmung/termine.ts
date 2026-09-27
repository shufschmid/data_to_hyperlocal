import type { OdsFetch } from '../ods'

// The coming vote days of the Confederation — so the desk knows them before
// they arrive (the newsroom's wish of 27 September 2026: „die
// Abstimmungstermine bereits aufführen, wie bei der Agenda").
//
// The source is the Federal Chancellery's own table of Blanko-Termine
// (bk.admin.ch/de/blanko-abstimmungstermine). That page builds the table in
// the browser from a visualize.admin.ch chart, and the chart reads a LINDAS
// cube — the Bund's linked-data service — so the door is that cube's public
// SPARQL endpoint, asked once a day for the days ahead. Measured on the same
// day: one GET answers a CSV of 281 days back to the first federal vote, each
// with its `typ` — `genutzt` (held), `festgelegt` (the Federal Council has
// fixed the Vorlagen, with their number), `blanko` (reserved only; whether it
// is used is decided at least four months ahead) and `nationalratswahlen`.
//
// `lindas.admin.ch/robots.txt` is a blanket `Disallow: /`. Like the
// amtsblattportal's, it governs crawling pages; the documented SPARQL service
// is the door the Bund offers for exactly this, and it is used identified,
// once a day, for one small query.

/** Where the SPARQL service lives — a row setting (`konfiguration.abstimmungen_termine`), this is the measured value. */
export const TERMINE_BASIS = 'https://lindas.admin.ch/query'

/** The Bund's page of the same table — the link a desk entry carries. */
export const TERMINE_SEITE =
  'https://www.bk.admin.ch/de/blanko-abstimmungstermine'

export type Terminart =
  | 'genutzt'
  | 'festgelegt'
  | 'blanko'
  | 'nationalratswahlen'

export interface Abstimmungstermin {
  datum: string
  art: Terminart
  /** Number of federal Vorlagen where fixed or held; null for a Blanko-Termin. */
  vorlagen: number | null
}

const ARTEN: readonly Terminart[] = [
  'genutzt',
  'festgelegt',
  'blanko',
  'nationalratswahlen'
]

export function termineAbfrage(ab: string): string {
  return `PREFIX cube: <https://cube.link/>
PREFIX vd: <https://politics.ld.admin.ch/political-rights/popular-vote/voting_dates/>
SELECT ?date ?typ ?vorlagen WHERE {
  vd:1 cube:observationSet/cube:observation ?o .
  ?o vd:date ?date .
  OPTIONAL { ?o vd:typ ?typ }
  OPTIONAL { ?o vd:vorlagen ?vorlagen }
  FILTER (?date >= "${ab}"^^<http://www.w3.org/2001/XMLSchema#date>)
} ORDER BY ?date`
}

export function termineUrl(basis: string, ab: string): string {
  return `${basis}?query=${encodeURIComponent(termineAbfrage(ab))}`
}

/**
 * The CSV the endpoint answers: `date,typ,vorlagen`. A row of an unknown type
 * or without a real day is dropped and COUNTED — a new type at the source is
 * something to see, not to guess.
 */
export function parseTermine(csv: string): {
  termine: Abstimmungstermin[]
  unbekannt: number
} {
  const zeilen = csv.split(/\r?\n/).filter((z) => z.trim() !== '')
  const kopf = zeilen[0]?.split(',') ?? []
  const spalte = (name: string) => kopf.indexOf(name)
  const iDatum = spalte('date')
  const iTyp = spalte('typ')
  const iVorlagen = spalte('vorlagen')
  if (iDatum < 0 || iTyp < 0)
    throw new Error('LINDAS antwortete ohne die Spalten date und typ.')

  const termine: Abstimmungstermin[] = []
  let unbekannt = 0
  for (const zeile of zeilen.slice(1)) {
    const felder = zeile.split(',')
    const datum = felder[iDatum]?.trim() ?? ''
    const art = (felder[iTyp]?.trim() ?? '').split('/').pop() as Terminart
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !ARTEN.includes(art)) {
      unbekannt += 1
      continue
    }
    const roh = iVorlagen < 0 ? '' : (felder[iVorlagen]?.trim() ?? '')
    const vorlagen = /^\d+$/.test(roh) ? Number(roh) : null
    termine.push({ datum, art, vorlagen })
  }
  return { termine, unbekannt }
}

/** The vote days from `ab` on. Throws on any answer but 200 — a failed read must not look like „no dates". */
export async function liesTermine(
  basis: string,
  ab: string,
  doFetch: OdsFetch
): Promise<{ termine: Abstimmungstermin[]; unbekannt: number }> {
  const antwort = await doFetch(termineUrl(basis, ab))
  if (!antwort.ok)
    throw new Error(`lindas.admin.ch antwortete ${antwort.status}`)
  return parseTermine(await antwort.text())
}

/** How far ahead the desk looks — a year holds the four vote days the newsroom plans with. */
export const TERMINE_VORAUS_TAGE = 400

/**
 * What the stored rows must become: every day of the window from the source,
 * and the rows of the window the source no longer lists removed (a Blanko-
 * Termin can be moved). Days before `ab` are never touched.
 */
export function termineAbgleich(
  bestand: ReadonlyArray<{
    id: string
    datum: string
    art: string
    vorlagen: number | null
  }>,
  frisch: readonly Abstimmungstermin[],
  ab: string,
  bis: string
): {
  neu: Abstimmungstermin[]
  geaendert: Array<{ id: string } & Abstimmungstermin>
  weg: string[]
} {
  const imFenster = frisch.filter((t) => t.datum >= ab && t.datum <= bis)
  const nachDatum = new Map(bestand.map((b) => [b.datum, b]))
  const neu: Abstimmungstermin[] = []
  const geaendert: Array<{ id: string } & Abstimmungstermin> = []
  for (const t of imFenster) {
    const alt = nachDatum.get(t.datum)
    if (alt === undefined) neu.push(t)
    else if (alt.art !== t.art || alt.vorlagen !== t.vorlagen)
      geaendert.push({ id: alt.id, ...t })
  }
  const gelistet = new Set(imFenster.map((t) => t.datum))
  const weg = bestand
    .filter((b) => b.datum >= ab && b.datum <= bis && !gelistet.has(b.datum))
    .map((b) => b.id)
  return { neu, geaendert, weg }
}
