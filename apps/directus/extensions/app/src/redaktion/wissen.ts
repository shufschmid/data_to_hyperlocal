import type {
  Geltungsbereich,
  WissenBereich,
  WissenStufe,
  WissenWirkung
} from '../types/schema'

// Deciding which editorial instructions are worth remembering.
//
// This is what makes the second year better than the first. When Sämi writes
// "kürzer, und nenne immer den Bezirk", two different things are being said:
// one is a fix for these articles, the other is how he wants this dataset
// handled from now on. Storing everything would fill the cached prompt prefix
// with one-offs; storing nothing means re-explaining the same preference every
// year.
//
// Since the desks learn too, a rule carries the desk it belongs to
// (`bereich`) and what it governs (`stufe`). Desk rules are always global
// within their desk — the decision rows are the local memory there.
//
// Prompt building and answer validation only — no Directus, no network.

export const WISSEN_SYSTEM_PROMPT = [
  'Du hilfst einer Redaktion, aus Anweisungen an ein Schreibwerkzeug dauerhafte',
  'Regeln herauszuloesen.',
  '',
  'Eine Anweisung ist DAUERHAFT, wenn sie beim naechsten Mal wieder gelten',
  'soll: eine Stilvorgabe, eine inhaltliche Anforderung, eine Formatregel.',
  '',
  'Eine Anweisung ist EINMALIG, wenn sie sich auf diesen konkreten Text bezieht:',
  'ein Tippfehler, eine falsche Zahl, "kuerze den dritten Absatz", "das stimmt',
  'so nicht".',
  '',
  'Im Zweifel einmalig. Eine faelschlich gespeicherte Regel steht in jeder',
  'kuenftigen Meldung und muss von Hand wieder entfernt werden.',
  '',
  'Antworte ausschliesslich mit JSON in dieser Form:',
  '{"dauerhaft": boolean, "regel": string oder null, "geltungsbereich": "datensatz" | "quelle" | "global"}',
  '',
  '"regel" ist die Anweisung als knappe Vorgabe umformuliert, so wie sie im',
  'Prompt stehen soll — nicht als Zitat, sondern als Anweisung. Null, wenn',
  'einmalig.',
  '"geltungsbereich" ist "datensatz", wenn die Regel nur zu dieser Statistik',
  'passt, "quelle" bei allem von diesem Portal, "global" bei einer allgemeinen',
  'Stilregel. Im Zweifel "datensatz".'
].join('\n')

export const WISSEN_SCHEMA = {
  type: 'object',
  properties: {
    dauerhaft: { type: 'boolean' },
    regel: { type: ['string', 'null'] },
    geltungsbereich: { type: 'string', enum: ['datensatz', 'quelle', 'global'] }
  },
  required: ['dauerhaft', 'regel', 'geltungsbereich'],
  additionalProperties: false
} as const satisfies Record<string, unknown>

export interface WissenUrteil {
  dauerhaft: boolean
  regel: string | null
  geltungsbereich: Geltungsbereich
}

const BEREICHE: readonly Geltungsbereich[] = ['datensatz', 'quelle', 'global']

export function buildWissenPrompt(
  anweisung: string,
  kontextTitel: string,
  erlaubt: readonly Geltungsbereich[] = BEREICHE
): string {
  const nurGlobal = erlaubt.length === 1 && erlaubt[0] === 'global'
  return [
    nurGlobal ? `Kontext: ${kontextTitel}` : `Datensatz: ${kontextTitel}`,
    ...(nurGlobal
      ? [
          'Hier gibt es keinen Datensatz und keine Quelle: eine dauerhafte Regel',
          'gilt fuer alle Meldungen dieses Tischs — "geltungsbereich" ist immer "global".'
        ]
      : []),
    '',
    'Anweisung der Redaktion:',
    anweisung
  ].join('\n')
}

const MAX_REGEL = 300

export function parseWissen(
  value: unknown,
  erlaubt: readonly Geltungsbereich[] = BEREICHE
): WissenUrteil {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Claude-Antwort zum Redaktionswissen ist kein Objekt.')
  }

  const kandidat = value as {
    dauerhaft?: unknown
    regel?: unknown
    geltungsbereich?: unknown
  }

  if (typeof kandidat.dauerhaft !== 'boolean') {
    throw new Error('Claude-Antwort enthaelt kein boolesches Feld "dauerhaft".')
  }

  const regel =
    typeof kandidat.regel === 'string' && kandidat.regel.trim() !== ''
      ? kandidat.regel.trim().slice(0, MAX_REGEL)
      : null

  // A verdict of "durable" with no rule to store is not a verdict. Treating it
  // as one-off is the safe reading — nothing is lost that a human cannot add.
  const dauerhaft = kandidat.dauerhaft && regel !== null

  // An answer outside the allowed scopes falls back to the narrowest one the
  // caller permits — "datensatz" for statistics, "global" for a desk.
  const geltungsbereich = erlaubt.includes(
    kandidat.geltungsbereich as Geltungsbereich
  )
    ? (kandidat.geltungsbereich as Geltungsbereich)
    : (erlaubt[0] ?? 'datensatz')

  return { dauerhaft, regel: dauerhaft ? regel : null, geltungsbereich }
}

/**
 * The columns a durable rule is stored in.
 *
 * `datensatz` and `quelle` are set according to the scope, so a rule meant for
 * one statistic never leaks into every article the application writes. A
 * desk rule (`bereich` other than statistik) is global within its desk and
 * binds to neither. Rules from words are text rules: an instruction to the
 * writing tool says how to write, not what to propose.
 */
export function wissenFelder(
  urteil: WissenUrteil,
  bezug: {
    datensatzId: string | null
    quelleId: string | null
    bereich?: WissenBereich
    herkunft?: 'chat' | 'kommentar'
    beleg?: string | null
  }
): Record<string, unknown> | null {
  if (!urteil.dauerhaft || urteil.regel === null) return null

  const bereich = bezug.bereich ?? 'statistik'
  const geltungsbereich =
    bereich === 'statistik' ? urteil.geltungsbereich : 'global'
  return {
    regel: urteil.regel,
    geltungsbereich,
    herkunft: bezug.herkunft ?? 'chat',
    aktiv: true,
    bereich,
    stufe: 'text',
    wirkung: 'hinweis',
    beleg: bezug.beleg ?? null,
    datensatz: geltungsbereich === 'datensatz' ? bezug.datensatzId : null,
    quelle: geltungsbereich === 'quelle' ? bezug.quelleId : null
  }
}

const WISSEN_BEREICHE: readonly WissenBereich[] = [
  'statistik',
  'sport',
  'entsorgung',
  'presseschau',
  'amtsblatt',
  'gemeinde',
  'sendung',
  'veranstaltung'
]
const WISSEN_STUFEN: readonly WissenStufe[] = ['sichtung', 'text']
const WISSEN_WIRKUNGEN: readonly WissenWirkung[] = ['hinweis', 'weiterreichen']

/**
 * A rule the editor typed into "Gelerntes" herself — the cheapest learning
 * of all, and the only path for "ich will das nie wieder sehen" said once.
 *
 * Validates the request body; the caller turns an Error into a 400. Manual
 * rules are global within their desk; `weiterreichen` is only meaningful on a
 * Sichtung rule and is dropped otherwise, so a text rule can never arm the
 * automation by accident.
 */
export function wissenFelderManuell(eingabe: {
  bereich?: unknown
  stufe?: unknown
  regel?: unknown
  wirkung?: unknown
}): Record<string, unknown> {
  const regel = typeof eingabe.regel === 'string' ? eingabe.regel.trim() : ''
  if (regel === '') throw new Error('Die Regel darf nicht leer sein.')
  if (!WISSEN_BEREICHE.includes(eingabe.bereich as WissenBereich)) {
    throw new Error('Unbekannter Bereich.')
  }
  if (!WISSEN_STUFEN.includes(eingabe.stufe as WissenStufe)) {
    throw new Error('Unbekannte Stufe.')
  }
  const stufe = eingabe.stufe as WissenStufe
  const wirkung =
    stufe === 'sichtung' &&
    WISSEN_WIRKUNGEN.includes(eingabe.wirkung as WissenWirkung)
      ? (eingabe.wirkung as WissenWirkung)
      : 'hinweis'

  return {
    regel: regel.slice(0, MAX_REGEL),
    geltungsbereich: 'global',
    herkunft: 'manuell',
    aktiv: true,
    bereich: eingabe.bereich as WissenBereich,
    stufe,
    wirkung,
    beleg: 'Von Hand erfasst.',
    datensatz: null,
    quelle: null
  }
}
