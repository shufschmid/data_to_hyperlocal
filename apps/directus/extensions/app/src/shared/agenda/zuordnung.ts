import type { Datensatz } from '../../types/schema'

// Which portal dataset does an agenda entry refer to?
//
// The agenda says "Abfallstatistik 2025". The portal calls the same thing
// "Abfallmengen nach Kategorie, Gemeinde und Jahr (seit 2017)". No string
// comparison bridges that, and the near misses are worse than the misses:
// "Leerstandserhebung" against "Leerwohnungsbestand" shares four letters,
// "Bevoelkerungsstatistik" matches six different population datasets equally
// well. A shortlist built from token overlap would drop the right answer as
// often as it found it.
//
// So the whole catalogue goes to the model and it picks one entry or none. That
// is affordable precisely because the catalogue is the *same* block on every
// call: it sits in the cached system prefix, the announcement title is the only
// thing in the user turn. Same trick as the article stage, same rule — nothing
// entry-specific may leak into the system text.
//
// Prompt building and answer validation only. No Directus, no network.

export type KatalogEintrag = Pick<
  Datensatz,
  'id' | 'externe_id' | 'titel' | 'hat_gemeinde'
>

export const ZUORDNUNG_REGELN = [
  'Du ordnest Eintraege einer amtlichen Publikationsagenda den Datensaetzen eines Open-Data-Portals zu.',
  '',
  'Beide beschreiben dieselbe Statistik in unterschiedlichen Worten. Die Agenda nennt',
  'das Thema kurz und mit Jahr ("Abfallstatistik 2025"), das Portal beschreibt den',
  'Inhalt ("Abfallmengen nach Kategorie, Gemeinde und Jahr (seit 2017)"). Das Jahr in',
  'der Agenda ist die Berichtsperiode, nicht Teil des Titels — ein Datensatz, der',
  'mehrere Jahre enthaelt, ist trotzdem der richtige.',
  '',
  'Regeln:',
  '- Antworte mit der ID genau eines Datensatzes aus der Liste, oder mit null.',
  '- Erfinde keine ID. Nur IDs, die unten stehen, sind zulaessig.',
  '- Im Zweifel null. Ein falsch zugeordneter Datensatz fuehrt zu Meldungen ueber',
  '  die falschen Zahlen; ein fehlender Treffer kostet nur einen Klick.',
  '- Passen mehrere Datensaetze gleich gut, ist das ein Zweifelsfall: null.',
  '- Ein Datensatz zu einem anderen Thema ist kein Treffer, auch wenn kein anderer',
  '  passt.',
  '',
  'Die Begruendung ist ein kurzer Satz und nennt den sachlichen Grund.'
].join('\n')

/**
 * The cached prefix: rules plus the whole catalogue.
 *
 * Sorted by `externe_id` so the block is byte-identical between calls — the
 * cache is a prefix match, and an unstable order would quietly turn every call
 * into a full-price one.
 */
export function buildKatalogSystem(katalog: readonly KatalogEintrag[]): string {
  const zeilen = [...katalog]
    .sort((a, b) => a.externe_id.localeCompare(b.externe_id))
    .map(
      (eintrag) =>
        `${eintrag.externe_id} | ${eintrag.titel}${eintrag.hat_gemeinde ? '' : ' [ohne Gemeindegliederung]'}`
    )

  return [
    ZUORDNUNG_REGELN,
    '',
    'Datensaetze im Portal (ID | Titel):',
    ...zeilen
  ].join('\n')
}

export interface ZuordnungFrage {
  titel: string
  datum: string | null
  quartal: string | null
}

export function buildZuordnungPrompt(frage: ZuordnungFrage): string {
  return [
    `Agenda-Eintrag: ${frage.titel}`,
    `Publiziert am: ${frage.datum ?? '(noch nicht publiziert)'}`,
    `Quartal: ${frage.quartal ?? '(keines)'}`,
    '',
    'Welcher Datensatz ist das?'
  ].join('\n')
}

export const ZUORDNUNG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    externe_id: {
      type: ['string', 'null'],
      description: 'ID des passenden Datensatzes, oder null.'
    },
    begruendung: { type: 'string' }
  },
  required: ['externe_id', 'begruendung'],
  additionalProperties: false
}

export interface Zuordnung {
  /** The matching dataset, or null when the model found none. */
  datensatz: KatalogEintrag | null
  begruendung: string
}

const MAX_BEGRUENDUNG = 300

/**
 * Validates the answer against the catalogue that was actually offered.
 *
 * An id the model invented must never become a link in the workspace: it would
 * point at whatever dataset happens to carry that number, and an editor would
 * see a plausible title next to the wrong statistic. Unknown id means no match,
 * and the note says so.
 */
export function parseZuordnung(
  value: unknown,
  katalog: readonly KatalogEintrag[]
): Zuordnung {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Claude-Antwort zur Zuordnung ist kein Objekt.')
  }

  const kandidat = value as { externe_id?: unknown; begruendung?: unknown }

  const begruendung =
    typeof kandidat.begruendung === 'string' &&
    kandidat.begruendung.trim() !== ''
      ? kandidat.begruendung.trim().slice(0, MAX_BEGRUENDUNG)
      : 'Ohne Begruendung.'

  if (
    typeof kandidat.externe_id !== 'string' ||
    kandidat.externe_id.trim() === ''
  ) {
    return { datensatz: null, begruendung }
  }

  const gesucht = kandidat.externe_id.trim()
  const treffer = katalog.find((eintrag) => eintrag.externe_id === gesucht)

  if (treffer === undefined) {
    return {
      datensatz: null,
      begruendung: `Kein Treffer: die genannte ID ${gesucht} steht nicht im Katalog.`
    }
  }

  return { datensatz: treffer, begruendung }
}

/** The note stored on the announcement, phrased in one place. */
export function zuordnungHinweis(zuordnung: Zuordnung): string {
  return zuordnung.datensatz === null
    ? `Kein passender Datensatz: ${zuordnung.begruendung}`
    : `${zuordnung.datensatz.titel}: ${zuordnung.begruendung}`
}

// --- with the office's own article ------------------------------------------
//
// An agenda entry whose link is a web article can be asked far better: the
// article says what was counted and over which period, and a topic routinely
// spans SEVERAL datasets — "Bau- und Wohnbaustatistik 2025" is at once the
// newly built flats and the housing stock. Both then belong to the one entry,
// and the timeline shows the topic instead of three rows saying the same thing.
//
// The catalogue prefix is shared with the single-answer call above, byte for
// byte, so the cache carries both.

export interface ArtikelFrage extends ZuordnungFrage {
  /** Readable text of the article, already capped by the caller. */
  text: string
  /** Portal tables the article links — a hint at the subject. */
  tabellen: readonly string[]
  /** Search terms from its open-data links. */
  suchbegriffe: readonly string[]
}

export function buildArtikelZuordnungPrompt(frage: ArtikelFrage): string {
  const zeilen = [
    `Agenda-Eintrag: ${frage.titel}`,
    `Publiziert am: ${frage.datum ?? '(noch nicht publiziert)'}`,
    `Quartal: ${frage.quartal ?? '(keines)'}`
  ]

  if (frage.tabellen.length > 0) {
    zeilen.push(
      `Im Artikel verlinkte Portaltabellen: ${frage.tabellen.join(', ')}`
    )
  }
  if (frage.suchbegriffe.length > 0) {
    zeilen.push(
      `Im Artikel verlinkte Portalsuche nach: ${frage.suchbegriffe.join(', ')}`
    )
  }

  zeilen.push(
    '',
    'Webartikel des Amts zu diesem Eintrag:',
    frage.text,
    '',
    'Welche Datensaetze gehoeren zu dieser Publikation? Nenne den wichtigsten',
    'zuerst — den, der die Zahlen je Gemeinde traegt.',
    '',
    'Eine Publikation besteht in der Regel aus MEHREREN Datensaetzen, die',
    'dieselbe Erhebung verschieden schneiden: Bestand und die daraus',
    'abgeleitete Quote, Zugang und Bestand, nach Zimmerzahl und nach',
    'Kategorie. Die gehoeren alle dazu — sie sind Sichten auf dieselbe',
    'Erhebung, nicht eigene Themen.',
    '',
    'Der Zweifel gilt einem ANDEREN Thema: ein Datensatz, der etwas anderes',
    'zaehlt, gehoert nicht dazu, auch wenn er benachbart wirkt.'
  )

  return zeilen.join('\n')
}

export const ZUORDNUNG_MEHRFACH_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    externe_ids: {
      type: 'array',
      items: { type: 'string' },
      description:
        'IDs der passenden Datensaetze, wichtigster zuerst. Leer, wenn keiner passt.'
    },
    begruendung: { type: 'string' }
  },
  required: ['externe_ids', 'begruendung'],
  additionalProperties: false
}

export interface MehrfachZuordnung {
  /** The matching datasets, most important first. Empty when none matched. */
  datensaetze: KatalogEintrag[]
  begruendung: string
}

/** How many datasets one agenda topic may claim. A topic is not a category. */
const MAX_ZUORDNUNGEN = 4

/**
 * Validates the answer against the catalogue that was actually offered.
 *
 * Same guarantee as the single-answer version: an invented id never becomes a
 * link. Unknown ids are dropped silently and the rest still counts — the model
 * naming three real datasets and one imagined should not cost the three.
 */
export function parseMehrfachZuordnung(
  value: unknown,
  katalog: readonly KatalogEintrag[]
): MehrfachZuordnung {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Claude-Antwort zur Zuordnung ist kein Objekt.')
  }

  const kandidat = value as { externe_ids?: unknown; begruendung?: unknown }

  const begruendung =
    typeof kandidat.begruendung === 'string' &&
    kandidat.begruendung.trim() !== ''
      ? kandidat.begruendung.trim().slice(0, MAX_BEGRUENDUNG)
      : 'Ohne Begruendung.'

  if (!Array.isArray(kandidat.externe_ids)) {
    return { datensaetze: [], begruendung }
  }

  const gefunden: KatalogEintrag[] = []
  for (const roh of kandidat.externe_ids) {
    if (typeof roh !== 'string' || roh.trim() === '') continue
    const treffer = katalog.find((eintrag) => eintrag.externe_id === roh.trim())
    if (treffer === undefined) continue
    if (gefunden.some((e) => e.id === treffer.id)) continue
    gefunden.push(treffer)
    if (gefunden.length === MAX_ZUORDNUNGEN) break
  }

  return { datensaetze: gefunden, begruendung }
}

/** The note stored on the announcement when several datasets belong to it. */
export function mehrfachHinweis(zuordnung: MehrfachZuordnung): string {
  if (zuordnung.datensaetze.length === 0) {
    return `Kein passender Datensatz: ${zuordnung.begruendung}`
  }
  return `${zuordnung.datensaetze.map((d) => d.titel).join(' · ')}: ${zuordnung.begruendung}`
}
