import { normalizeName } from '../../redaktion/gemeinden'
import type { Gemeinde } from '../../types/schema'
import {
  istEigeneSeite,
  parseTabelle,
  tabellenBesitzer,
  type StatblTabelle
} from './parse'

// Deciding what a portal page is, and whether we need to watch it.
//
// The rule this module serves comes from the newsroom and is sharper than a
// full scan: watch daily only what (1) is broken down by municipality, (2) is
// *not* available as open data, and (3) has no agenda entry. Everything else
// already reaches us — through the daily catalogue check or through the agenda
// — and may arrive a day later.
//
// The three questions are answered in the cheapest order. Whether a page is a
// municipality table is arithmetic against our own list of 86 names, so no
// model is asked. Only what survives that is worth a call.
//
// Prompt building and answer validation only. No Directus, no network.

export type SeitenArt = 'tabelle' | 'navigation'

export interface Einordnung {
  art: SeitenArt
  /** Null when the page carries no table at all. */
  tabelle: StatblTabelle | null
  gemeindeebene: boolean
  /** How many of the 86 municipalities the first column matched. */
  treffer: number
  titel: string
  /** Set when the table shown here belongs to another page. */
  zeigtTabelleVon: string | null
}

/**
 * How many known municipalities a table must name before we call it
 * municipality-level.
 *
 * Not all 86: a table may legitimately cover only one district, and a
 * three-name coincidence is not a table about municipalities. Twenty is well
 * above what any other kind of table hits by accident and well below the
 * smallest genuine breakdown.
 */
export const MIN_GEMEINDEN = 20

export function ordneSeiteEin(
  html: string,
  gemeinden: readonly Pick<Gemeinde, 'name'>[],
  pfad?: string
): Einordnung {
  const tabelle = parseTabelle(html)

  if (tabelle === null) {
    return {
      art: 'navigation',
      tabelle: null,
      gemeindeebene: false,
      treffer: 0,
      titel: '',
      zeigtTabelleVon: null
    }
  }

  // A preview of a child's table is not this page's data. Counted as such, one
  // statistic was registered under every path that previews it — and the
  // coverage question was paid for once per copy.
  if (pfad !== undefined && !istEigeneSeite(html, pfad)) {
    return {
      art: 'navigation',
      tabelle: null,
      gemeindeebene: false,
      treffer: 0,
      titel: tabelle.titel,
      zeigtTabelleVon: tabellenBesitzer(html, pfad)
    }
  }

  const bekannt = new Set(gemeinden.map((g) => normalizeName(g.name)))
  const genannt = new Set(
    tabelle.zeilen
      .map((zeile) => normalizeName(String(zeile['gemeinde'] ?? '')))
      .filter((name) => bekannt.has(name))
  )

  return {
    art: 'tabelle',
    tabelle,
    gemeindeebene: genannt.size >= MIN_GEMEINDEN,
    treffer: genannt.size,
    titel: tabelle.titel,
    zeigtTabelleVon: null
  }
}

// --- the one model question ---------------------------------------------------

export interface AbdeckungKatalog {
  datensaetze: readonly { externe_id: string; titel: string }[]
  ankuendigungen: readonly { id: string; titel: string }[]
}

export const ABDECKUNG_REGELN = [
  'Du pruefst, ob eine Tabelle eines statistischen Amts anderswo schon abgedeckt ist.',
  '',
  'Gegeben sind zwei Listen: die Datensaetze eines Open-Data-Portals und die',
  'Eintraege der Publikationsagenda desselben Amts. Beide beschreiben dieselben',
  'Statistiken in anderen Worten — die Tabelle heisst "Quadratmeterpreis", der',
  'Datensatz "Durchschnittlicher Quadratmeterpreis von Bauland nach Gemeinde und',
  'Jahr".',
  '',
  'Regeln:',
  '- Abgedeckt ist eine Tabelle nur, wenn dieselben Zahlen gemeint sind, nicht',
  '  bloss dasselbe Themengebiet. "Wohnbevoelkerung nach Alter" deckt',
  '  "Wohnbevoelkerung nach Konfession" nicht ab.',
  '- Nenne die ID des Datensatzes und den Titel des Agenda-Eintrags, sofern',
  '  vorhanden. Beides kann null sein, unabhaengig voneinander.',
  '- Erfinde nichts. Nur IDs und Titel aus den Listen sind zulaessig.',
  '- Im Zweifel null. Ein falsches "ist abgedeckt" fuehrt dazu, dass diese',
  '  Statistik nie wieder geprueft wird und eine Publikation unbemerkt bleibt.',
  '  Ein falsches "nicht abgedeckt" kostet eine Seite pro Tag.'
].join('\n')

/**
 * The cached prefix: the rules plus both lists.
 *
 * Byte-identical across the whole inventory, so the catalogue is paid for once
 * and read back on every following page. Sorted for exactly that reason.
 */
export function buildAbdeckungSystem(katalog: AbdeckungKatalog): string {
  const datensaetze = [...katalog.datensaetze]
    .sort((a, b) => a.externe_id.localeCompare(b.externe_id))
    .map((d) => `${d.externe_id} | ${d.titel}`)

  const ankuendigungen = [...katalog.ankuendigungen]
    .map((a) => a.titel)
    .sort((a, b) => a.localeCompare(b))
    .map((titel) => `- ${titel}`)

  return [
    ABDECKUNG_REGELN,
    '',
    'Datensaetze im Open-Data-Portal (ID | Titel):',
    ...datensaetze,
    '',
    'Eintraege der Publikationsagenda:',
    ...(ankuendigungen.length === 0 ? ['(keine)'] : ankuendigungen)
  ].join('\n')
}

export interface AbdeckungFrage {
  pfad: string
  titel: string
  /**
   * Column labels and years, when they are at hand — they often say more than
   * the title does. Optional, because the question is asked long after the page
   * was read, from what was stored about it.
   */
  spalten?: readonly string[] | undefined
  jahre?: readonly string[] | undefined
}

export function buildAbdeckungPrompt(frage: AbdeckungFrage): string {
  const teile = [`Tabelle: ${frage.titel}`, `Pfad im Portal: ${frage.pfad}`]

  if (frage.spalten !== undefined && frage.spalten.length > 0) {
    teile.push(`Spalten: ${frage.spalten.join(', ')}`)
  }
  if (frage.jahre !== undefined && frage.jahre.length > 0) {
    teile.push(`Jahrgaenge: ${frage.jahre.slice(0, 20).join(', ')}`)
  }

  teile.push(
    '',
    'Ist diese Tabelle als Datensatz oder in der Agenda abgedeckt?'
  )

  return teile.join('\n')
}

export const ABDECKUNG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    externe_id: {
      type: ['string', 'null'],
      description: 'ID des abdeckenden Datensatzes, oder null.'
    },
    ankuendigung: {
      type: ['string', 'null'],
      description: 'Titel des passenden Agenda-Eintrags, oder null.'
    },
    begruendung: { type: 'string' }
  },
  required: ['externe_id', 'ankuendigung', 'begruendung'],
  additionalProperties: false
}

export interface Abdeckung {
  /** `externe_id` of the covering dataset, validated against the catalogue. */
  datensatz: string | null
  /** Title of the matching agenda entry, validated against the list. */
  ankuendigung: string | null
  begruendung: string
  /** The rule, in one place: this is what the daily watch is derived from. */
  beobachten: boolean
}

const MAX_BEGRUENDUNG = 300

/**
 * Validates the answer against the lists that were actually offered.
 *
 * An invented id would mark a table as covered for good — the watch would drop
 * it and nobody would ever hear about that statistic again. That is the one
 * failure mode here that is silent, so unknown values count as "not covered".
 */
export function parseAbdeckung(
  value: unknown,
  katalog: AbdeckungKatalog,
  gemeindeebene: boolean
): Abdeckung {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Claude-Antwort zur Abdeckung ist kein Objekt.')
  }

  const kandidat = value as {
    externe_id?: unknown
    ankuendigung?: unknown
    begruendung?: unknown
  }

  const begruendung =
    typeof kandidat.begruendung === 'string' &&
    kandidat.begruendung.trim() !== ''
      ? kandidat.begruendung.trim().slice(0, MAX_BEGRUENDUNG)
      : 'Ohne Begruendung.'

  const gesuchteId =
    typeof kandidat.externe_id === 'string' ? kandidat.externe_id.trim() : ''
  const datensatz =
    katalog.datensaetze.find((d) => d.externe_id === gesuchteId)?.externe_id ??
    null

  const gesuchterTitel =
    typeof kandidat.ankuendigung === 'string'
      ? kandidat.ankuendigung.trim()
      : ''
  const ankuendigung =
    katalog.ankuendigungen.find((a) => a.titel === gesuchterTitel)?.titel ??
    null

  return {
    datensatz,
    ankuendigung,
    begruendung,
    beobachten: gemeindeebene && datensatz === null && ankuendigung === null
  }
}

/** The note stored on the page, phrased in one place. */
export function abdeckungHinweis(
  einordnung: Pick<Einordnung, 'gemeindeebene' | 'treffer'> &
    Partial<Pick<Einordnung, 'zeigtTabelleVon'>>,
  abdeckung: Abdeckung | null
): string {
  if (
    einordnung.zeigtTabelleVon !== undefined &&
    einordnung.zeigtTabelleVon !== null
  ) {
    return `Zeigt die Tabelle von ${einordnung.zeigtTabelleVon}.`
  }
  if (!einordnung.gemeindeebene) {
    return `Keine Gemeindegliederung (${einordnung.treffer} von 86 Gemeinden genannt).`
  }
  if (abdeckung === null) return 'Noch nicht auf Abdeckung geprueft.'

  const teile: string[] = []
  if (abdeckung.datensatz !== null) {
    teile.push(`liegt als Datensatz ${abdeckung.datensatz} vor`)
  }
  if (abdeckung.ankuendigung !== null) {
    teile.push(`steht in der Agenda als "${abdeckung.ankuendigung}"`)
  }

  return teile.length === 0
    ? `Nur hier: ${abdeckung.begruendung}`
    : `${teile.join(', ')} — ${abdeckung.begruendung}`
}
