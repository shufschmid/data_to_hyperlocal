import type { Geltungsbereich } from '../types/schema'

// Deciding which editorial instructions are worth remembering.
//
// This is what makes the second year better than the first. When Sämi writes
// "kürzer, und nenne immer den Bezirk", two different things are being said:
// one is a fix for these articles, the other is how he wants this dataset
// handled from now on. Storing everything would fill the cached prompt prefix
// with one-offs; storing nothing means re-explaining the same preference every
// year.
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

export function buildWissenPrompt(
  anweisung: string,
  datensatzTitel: string
): string {
  return [
    `Datensatz: ${datensatzTitel}`,
    '',
    'Anweisung der Redaktion:',
    anweisung
  ].join('\n')
}

const MAX_REGEL = 300
const BEREICHE: readonly Geltungsbereich[] = ['datensatz', 'quelle', 'global']

export function parseWissen(value: unknown): WissenUrteil {
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

  const geltungsbereich = BEREICHE.includes(
    kandidat.geltungsbereich as Geltungsbereich
  )
    ? (kandidat.geltungsbereich as Geltungsbereich)
    : 'datensatz'

  return { dauerhaft, regel: dauerhaft ? regel : null, geltungsbereich }
}

/**
 * The columns a durable rule is stored in.
 *
 * `datensatz` and `quelle` are set according to the scope, so a rule meant for
 * one statistic never leaks into every article the application writes.
 */
export function wissenFelder(
  urteil: WissenUrteil,
  bezug: { datensatzId: string; quelleId: string | null }
): Record<string, unknown> | null {
  if (!urteil.dauerhaft || urteil.regel === null) return null

  return {
    regel: urteil.regel,
    geltungsbereich: urteil.geltungsbereich,
    herkunft: 'chat',
    aktiv: true,
    datensatz:
      urteil.geltungsbereich === 'datensatz' ? bezug.datensatzId : null,
    quelle: urteil.geltungsbereich === 'quelle' ? bezug.quelleId : null
  }
}
