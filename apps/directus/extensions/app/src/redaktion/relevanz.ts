import type { MunicipalityFields, OdsDataset } from '../shared/ods'

// Deciding whether a dataset is worth an editorial run.
//
// Prompt building and answer validation only — no Directus, no network — so the
// judgement can be tested without either.
//
// Note what is *not* asked of the model: whether the dataset has municipality
// data. That is read from the portal's own field metadata and is a fact, not a
// judgement. The model is only asked the part that genuinely needs judgement:
// is this interesting to people living in these municipalities.

export const RELEVANZ_SYSTEM_PROMPT = [
  'Du bist Redaktionsleiterin eines Lokalmediums im Kanton Basel-Landschaft.',
  'Du beurteilst, ob aus einem Datensatz eine Meldung fuer die einzelnen Gemeinden lohnt.',
  '',
  'Relevant ist ein Datensatz, wenn Einwohnerinnen und Einwohner einer Gemeinde',
  'daran ein konkretes Interesse haben: Geld, Sicherheit, Umwelt, Schule, Verkehr,',
  'Gesundheit, Politik, Bauen, Freizeit. Ein Vergleich zwischen Gemeinden oder eine',
  'Entwicklung ueber die Zeit macht einen Datensatz staerker.',
  '',
  'Nicht relevant sind reine Verwaltungsregister ohne Aussage, technische',
  'Geodaten-Hilfstabellen und Datensaetze, deren Zahlen fuer eine einzelne Gemeinde',
  'nichts bedeuten.',
  '',
  'Antworte ausschliesslich mit JSON in dieser Form:',
  '{"relevant": boolean, "begruendung": string, "periodenfeld": string oder null, "themen": string[]}',
  '',
  '"begruendung" ist ein Satz und nennt den konkreten Grund, nicht eine Floskel.',
  '"periodenfeld" ist der Feldname der Zeitachse, exakt wie in der Feldliste geschrieben.',
  '"themen" sind ein bis drei kleingeschriebene Schlagworte.'
].join('\n')

export interface RelevanzUrteil {
  relevant: boolean
  begruendung: string
  /** Name of the time-axis field, validated against the dataset's own fields. */
  periodenfeld: string | null
  themen: string[]
}

export function buildRelevanzPrompt(
  dataset: OdsDataset,
  municipality: MunicipalityFields
): string {
  const felder = dataset.fields
    .map(
      (field) =>
        `- ${field.name} (${field.type})${field.label === null ? '' : ` — ${field.label}`}`
    )
    .join('\n')

  return [
    `Titel: ${dataset.titel}`,
    '',
    `Beschreibung: ${dataset.beschreibung ?? '(keine)'}`,
    '',
    `Zeilen insgesamt: ${dataset.recordsCount ?? 'unbekannt'}`,
    `Gemeindespalte: ${municipality.bfsField}`,
    '',
    'Felder:',
    felder === '' ? '(keine Feldangaben)' : felder
  ].join('\n')
}

const MAX_BEGRUENDUNG = 400
const MAX_THEMEN = 3

/**
 * Validates the answer before anything is written to a collection.
 *
 * `periodenfeld` is checked against the dataset's real field list: a made-up
 * column name would be carried into the run and produce a query that silently
 * matches nothing.
 */
export function parseRelevanz(
  value: unknown,
  dataset: OdsDataset
): RelevanzUrteil {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Claude-Antwort zur Relevanz ist kein Objekt.')
  }

  const candidate = value as {
    relevant?: unknown
    begruendung?: unknown
    periodenfeld?: unknown
    themen?: unknown
  }

  if (typeof candidate.relevant !== 'boolean') {
    throw new Error('Claude-Antwort enthaelt kein boolesches Feld "relevant".')
  }
  if (
    typeof candidate.begruendung !== 'string' ||
    candidate.begruendung.trim() === ''
  ) {
    throw new Error('Claude-Antwort enthaelt keine Begruendung.')
  }

  const fieldNames = new Set(dataset.fields.map((field) => field.name))
  const periodenfeld =
    typeof candidate.periodenfeld === 'string' &&
    fieldNames.has(candidate.periodenfeld)
      ? candidate.periodenfeld
      : null

  const themen = Array.isArray(candidate.themen)
    ? candidate.themen
        .filter((thema): thema is string => typeof thema === 'string')
        .map((thema) => thema.trim().toLowerCase())
        .filter((thema) => thema !== '')
        .slice(0, MAX_THEMEN)
    : []

  return {
    relevant: candidate.relevant,
    begruendung: candidate.begruendung.trim().slice(0, MAX_BEGRUENDUNG),
    periodenfeld,
    themen
  }
}

/**
 * The note stored on the dataset, in one place so the operation and any future
 * caller cannot phrase it differently.
 */
export function bewertungText(urteil: RelevanzUrteil): string {
  const themen =
    urteil.themen.length === 0 ? '' : ` [${urteil.themen.join(', ')}]`
  return `${urteil.relevant ? 'Relevant' : 'Nicht relevant'}: ${urteil.begruendung}${themen}`
}

/**
 * Why a dataset was dismissed without ever reaching the model.
 *
 * Kept next to the model-based judgement so both reasons read the same way in
 * the admin UI, and so it is obvious at a glance which datasets cost nothing.
 */
export function keineGemeindedatenText(): string {
  return 'Nicht relevant: Der Datensatz enthaelt keine Gliederung nach Gemeinde.'
}
