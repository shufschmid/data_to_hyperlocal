// Reading an Opendatasoft catalogue response.
//
// Everything here is defensive: the payload comes from a portal we do not
// control, and a missing key must produce a skipped dataset, not a crash in a
// scheduled job.

export interface OdsField {
  name: string
  type: string
  label: string | null
  description: string | null
}

export interface OdsDataset {
  datasetId: string
  titel: string
  beschreibung: string | null
  /** Moves on data *and* metadata changes — not a reliable change signal. */
  modified: string | null
  /** Moves only when the data itself changed. This is the useful one. */
  dataProcessed: string | null
  recordsCount: number | null
  /**
   * How often the office refreshes it: `annual`, `daily`, `irregular`, …
   *
   * The portal says so itself, in the DCAT block, and it settles a question no
   * amount of reading the title can: a register refreshed every fifteen minutes
   * has no reporting period at all. 43 of 181 datasets are of that kind.
   */
  rhythmus: string | null
  fields: OdsField[]
}

export interface OdsCatalogPage {
  totalCount: number
  datasets: OdsDataset[]
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseField(raw: unknown): OdsField | null {
  const field = asRecord(raw)
  if (field === null) return null

  const name = asString(field['name'])
  const type = asString(field['type'])
  if (name === null || type === null) return null

  return {
    name,
    type,
    label: asString(field['label']),
    description: asString(field['description'])
  }
}

function parseDataset(raw: unknown): OdsDataset | null {
  const entry = asRecord(raw)
  if (entry === null) return null

  const datasetId = asString(entry['dataset_id'])
  if (datasetId === null) return null

  const metas = asRecord(entry['metas'])
  const meta = metas === null ? null : asRecord(metas['default'])

  // A dataset without a title is unusable downstream — the generator would have
  // nothing to tell the editor. Fall back to the id rather than dropping it.
  const titel = (meta === null ? null : asString(meta['title'])) ?? datasetId

  const recordsCountRaw = meta === null ? undefined : meta['records_count']
  const dcat = metas === null ? null : asRecord(metas['dcat'])

  return {
    datasetId,
    titel,
    beschreibung: meta === null ? null : asString(meta['description']),
    modified: meta === null ? null : asString(meta['modified']),
    dataProcessed: meta === null ? null : asString(meta['data_processed']),
    recordsCount: typeof recordsCountRaw === 'number' ? recordsCountRaw : null,
    rhythmus:
      (dcat === null ? null : asString(dcat['accrualperiodicity'])) ??
      (meta === null ? null : asString(meta['accrualperiodicity'])),
    fields: Array.isArray(entry['fields'])
      ? entry['fields']
          .map(parseField)
          .filter((field): field is OdsField => field !== null)
      : []
  }
}

export function parseCatalogPage(payload: unknown): OdsCatalogPage {
  const root = asRecord(payload)
  if (root === null) {
    throw new Error('Opendatasoft catalogue response is not an object')
  }

  const results = root['results']
  if (!Array.isArray(results)) {
    throw new Error('Opendatasoft catalogue response has no results array')
  }

  const totalCountRaw = root['total_count']

  return {
    totalCount:
      typeof totalCountRaw === 'number' ? totalCountRaw : results.length,
    datasets: results
      .map(parseDataset)
      .filter((dataset): dataset is OdsDataset => dataset !== null)
  }
}

/**
 * The concept URI every Basel-Landschaft dataset tags its municipality
 * identifier with, in the field's `description`.
 *
 * This is what makes detection robust. The field *names* are not consistent:
 * the statistics datasets call it `bfs_gemeindenummer`, the referendum results
 * call it `entity_id`. Both carry this annotation, so matching on the concept
 * finds them and matching on the name would silently miss half the portal.
 */
const GEMEINDE_KONZEPT = 'DV_KT_BEZ_GDE_SNAP'

/** Fallback for datasets that name the field conventionally but do not annotate it. */
const BFS_NAMEN = [
  'bfs_gemeindenummer',
  'gemeindenummer',
  'bfs_nr',
  'bfs_nummer'
]

/** Fields that usually carry the readable municipality name, best first. */
const NAME_FELDER = ['gemeinde', 'gemeindename', 'name', 'gdename']

export interface MunicipalityFields {
  /** Field holding the BFS number — the identity we match on. */
  bfsField: string
  /** Field holding the label. Display only; never used for matching. */
  nameField: string | null
}

/**
 * Finds the municipality columns, or null when the dataset is not broken down
 * by municipality at all.
 *
 * `override` is the editor's answer when this function gets it wrong. It wins
 * over both heuristics but is still checked against the real field list: a
 * column name that no longer exists in the portal must not silently become the
 * identity every row is matched on. Detection has to stay honest even when a
 * person is overruling it.
 */
export function detectMunicipalityFields(
  fields: OdsField[],
  override?: string | null
): MunicipalityFields | null {
  const gewaehlt =
    override === undefined || override === null || override.trim() === ''
      ? undefined
      : fields.find((field) => field.name === override.trim())

  if (gewaehlt !== undefined) {
    return {
      bfsField: gewaehlt.name,
      nameField:
        NAME_FELDER.map((candidate) =>
          fields.find((field) => field.name.toLowerCase() === candidate)
        ).find((field) => field !== undefined && field.name !== gewaehlt.name)
          ?.name ?? null
    }
  }

  // `?.` und nicht `!== null`: die Feldliste kommt nicht nur aus dem Katalog.
  // `tabellenFelder` (statbl) liefert Felder ohne `description` — dort war
  // `field.description !== null` wahr und der Zugriff darauf ein TypeError
  // mitten im Worker. Heute unerreichbar, weil jene Datensaetze eine Spalte von
  // Hand gesetzt haben; eine einzige ohne waere der Absturz gewesen.
  const annotated = fields.find(
    (field) => field.description?.includes(GEMEINDE_KONZEPT) === true
  )

  const byName = fields.find((field) =>
    BFS_NAMEN.includes(field.name.toLowerCase())
  )

  const bfsField = annotated ?? byName
  if (bfsField === undefined) return null

  const nameField =
    NAME_FELDER.map((candidate) =>
      fields.find((field) => field.name.toLowerCase() === candidate)
    ).find((field) => field !== undefined && field.name !== bfsField.name) ??
    null

  return {
    bfsField: bfsField.name,
    nameField: nameField === null ? null : nameField.name
  }
}

/**
 * The time axis of a dataset.
 *
 * The first version was "exactly one column typed as a date, otherwise give up",
 * and it was wrong in both directions at once — measured against the real
 * catalogue:
 *
 *   13180 Friedensrichterwahl   only date column is `jahrgang`, the candidates'
 *                               year of birth. Taken blindly → period 1997.
 *   11610 Landratswahlen        same shape → period 2004.
 *   12780 Wahlen (Resultate)    `election_date` *and* `candidate_year_of_birth`,
 *                               both typed date → gave up, dataset written off.
 *   11970 Arealstatistik        `erhebungsjahr_e` is typed `text`, so the time
 *                               axis was invisible → written off, although the
 *                               data runs back to 1982 per municipality.
 *
 * So it now decides by name as well as by type, in that order. A birth date is
 * never a reporting period — not even when it is the only date column, which is
 * the case that produced articles about the year 1997.
 *
 * Still null when nothing distinguishes the candidates: a run for the wrong
 * period is worse than no run, and that rule is unchanged.
 */

/** Names that describe a person, not a reporting period. */
const GEBURTSDATUM = /(^|_)(jahrgang|geburt|birth|year_of_birth)/i

/**
 * Names that describe when something was measured or decided, strongest first.
 *
 * A ranking rather than a set, because a dataset can name the same period twice:
 * 11970 has `erhebungsperiode` ("2014/2015") *and* `erhebungsjahr_e` ("2014/15"),
 * and treating that as a tie left the Arealstatistik nach Gemeinde — data back
 * to 1982 — permanently unusable. Two columns of equal rank are still a genuine
 * tie and still give up.
 */
const PERIODENNAMEN: RegExp[] = [
  /^(jahr|year|datum|date|periode|period|quartal|quarter|monat|month)$/i,
  // Ohne Wortgrenze: Deutsch schreibt zusammen. `erhebungsjahr_e`,
  // `meldejahr`, `berichtsjahr` — mit einer Verankerung auf `_jahr` traefe
  // keines davon, und genau daran scheiterte die Arealstatistik.
  /(jahr|year)/i,
  /(datum|date|stichtag)/i,
  /(periode|period|quartal|quarter|monat|month|erhebung)/i
]

const PERIODENNAME = new RegExp(
  PERIODENNAMEN.map((muster) => muster.source).join('|'),
  'i'
)

/** Position in `PERIODENNAMEN`, or `Infinity` when nothing matches. */
function rang(name: string): number {
  const treffer = PERIODENNAMEN.findIndex((muster) => muster.test(name))
  return treffer === -1 ? Number.POSITIVE_INFINITY : treffer
}

/** The single best-named candidate, or null when two share the top rank. */
function besterName(felder: OdsField[]): string | null {
  if (felder.length === 0) return null
  if (felder.length === 1) return felder[0]?.name ?? null

  const bewertet = felder
    .map((feld) => ({ name: feld.name, rang: rang(feld.name) }))
    .sort((a, b) => a.rang - b.rang)

  const bester = bewertet[0]
  if (bester === undefined || !Number.isFinite(bester.rang)) return null

  return bewertet[1]?.rang === bester.rang ? null : bester.name
}

export function detectPeriodField(fields: OdsField[]): string | null {
  const brauchbar = fields.filter((field) => !GEBURTSDATUM.test(field.name))

  const datumsfelder = brauchbar.filter(
    (field) => field.type === 'date' || field.type === 'datetime'
  )

  if (datumsfelder.length === 1) return datumsfelder[0]?.name ?? null

  if (datumsfelder.length > 1) {
    return besterName(
      datumsfelder.filter((field) => PERIODENNAME.test(field.name))
    )
  }

  // No date column at all: the portal types plenty of year columns as text.
  // `buildWhereClause` handles both — `jahr="2025"` against `jahr=date'2025'`,
  // see `odsLiteral` — so a text year is a usable axis, not a second-class one.
  const textfelder = brauchbar.filter(
    (field) => field.type === 'text' && PERIODENNAME.test(field.name)
  )

  return besterName(textfelder)
}

/**
 * A value that changes when the *content* changed, and stays put when only the
 * description was corrected.
 *
 * `modified` alone is not usable: the portal reports
 * `modified_updates_on_metadata_change: true`, so a fixed typo would look like
 * new data and produce a set of articles nobody asked for.
 */
export function contentFingerprint(dataset: OdsDataset): string {
  return `${dataset.dataProcessed ?? dataset.modified ?? 'unbekannt'}|${dataset.recordsCount ?? '?'}`
}

/**
 * Does this column really identify municipalities — or a coarser level?
 *
 * The metadata cannot tell them apart. The office annotates every level of its
 * hierarchy with the same concept, `DV_KT_BEZ_GDE_SNAP` — Kanton, BEZirk,
 * GEmeinde — so `bezirk_nummer` in "Baukosten nach ... Bezirk und Jahr" carried
 * exactly the marker that was supposed to prove municipality level. Both of the
 * portal's district datasets passed as municipality data, and only the coverage
 * check inside a run would have caught it, after a briefing had been paid for.
 *
 * The values settle it, because we know all 86 numbers. Districts are 1301–1305
 * and the canton is 13; there is no overlap to be clever about.
 *
 * One match is enough, deliberately. Several genuine municipality datasets
 * cover only part of the canton — the 2024 Gemeindekommissionswahlen were held
 * in 15 municipalities, private schools exist in 15 — and a threshold like
 * "at least twenty" would throw exactly those away.
 */
export function istGemeindeebene(
  werte: readonly (string | number | null | undefined)[],
  bekannteBfs: ReadonlySet<number>
): { treffer: number; gemeindeebene: boolean } {
  const treffer = new Set<number>()

  for (const wert of werte) {
    if (wert === null || wert === undefined) continue

    const zahl = Number.parseInt(String(wert).trim(), 10)
    if (Number.isNaN(zahl)) continue
    if (bekannteBfs.has(zahl)) treffer.add(zahl)
  }

  return { treffer: treffer.size, gemeindeebene: treffer.size > 0 }
}

/**
 * Rhythms that mean "a register", not "a statistic".
 *
 * A dataset the office refreshes daily — Zefix company records, vehicle
 * registrations, sensor readings — never has a reporting period to write about.
 * Whatever an article said about it would be out of date the next morning,
 * which is the one thing this newsroom cannot afford: its articles have to hold
 * in five years.
 */
const REGISTER_RHYTHMEN = new Set([
  'continuous',
  'daily',
  'hourly',
  'every fifteen minutes',
  'twice a day',
  'realtime',
  'real-time'
])

export function istRegister(rhythmus: string | null | undefined): boolean {
  if (rhythmus === null || rhythmus === undefined) return false
  return REGISTER_RHYTHMEN.has(rhythmus.trim().toLowerCase())
}
