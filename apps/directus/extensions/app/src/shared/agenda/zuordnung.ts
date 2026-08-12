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
