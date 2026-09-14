// Rules on their way into a prompt, and decisions on their way into rules.
//
// Pure: prompt building and answer validation only — no Directus, no network.
// The Directus-facing half is `gedaechtnis.ts`.
//
// The second half is the newsroom's answer to "when I reject one, understand
// WHY and propose fewer like it". A rejection is a click; a click carries no
// class. So a rule is learned from WORDS first — a comment, a reason that
// names a kind of piece — and from a bare click only when it repeats: two
// earlier decisions of the same kind, and a model that can name what they
// share. Doublette, veraltet and falsche Gemeinde never teach a rule: they
// are about timing and assignment, not about a class of stories.

import type { WissenWirkung } from '../types/schema'

/** The heading every Sichtung's rule block carries — one wording, three desks. */
export const SICHTUNGSREGELN_UEBERSCHRIFT =
  'Regeln der Redaktion fuer diesen Tisch (aus frueheren Entscheiden und Anweisungen — halte dich daran):'

/** A rule as a Sichtung prompt names it — numbered, so an answer can cite it. */
export interface NummerierteRegel {
  nummer: string
  id: string
  regel: string
}

/**
 * The desk's Sichtung rules as a numbered block.
 *
 * Numbered rather than listed because the answer may refer back: a Sichtung
 * that hands a proposal to the Chefredaktion has to say WHICH rule told it
 * to, and a number is something code can check against the loaded rules — a
 * quoted rule text or a made-up uuid is not.
 */
export function regelnBlock(
  regeln: readonly { id: string; regel: string }[],
  ueberschrift: string
): { text: string; nummern: Map<string, NummerierteRegel> } {
  const nummern = new Map<string, NummerierteRegel>()
  if (regeln.length === 0) return { text: '', nummern }

  const zeilen = [ueberschrift]
  regeln.forEach((r, i) => {
    const nummer = `R${i + 1}`
    nummern.set(nummer, { nummer, id: r.id, regel: r.regel })
    zeilen.push(`${nummer}: ${r.regel}`)
  })
  return { text: zeilen.join('\n'), nummern }
}

/**
 * The desk's text rules for an article prompt — the same block the
 * statistics prompt has carried since the first rule was learned.
 */
export function vorgabenZeilen(regeln: readonly string[]): string[] {
  if (regeln.length === 0) return []
  return ['', 'Redaktionelle Vorgaben:', ...regeln.map((r) => `- ${r}`)]
}

// ---------------------------------------------------------------------------
// Learning from decisions
// ---------------------------------------------------------------------------

export type LernTisch = 'presseschau' | 'amtsblatt' | 'sendung'

export type LernEntscheid =
  | 'abgelehnt'
  | 'weitergereicht'
  | 'perle_ja'
  | 'perle_nein'
  | 'brauchbar'
  | 'kein_hinweis'
  | 'verworfen'

/** One decision with everything the classifier needs to reason about it. */
export interface LernFall {
  tisch: LernTisch
  /** The paper, municipality or show the row belongs to — context, never scope. */
  quelleName: string
  titel: string
  /** Type of piece, gazette rubric, municipality — the class hint the row carries. */
  merkmal: string | null
  zusammenfassung: string | null
  /** The model's own reasoning when it proposed the row. */
  modellBegruendung: string | null
  entscheid: LernEntscheid
  grund: string | null
  kommentar: string | null
}

const TISCH_NAME: Record<LernTisch, string> = {
  presseschau: 'Wochenblaetter (Presseschau)',
  amtsblatt: 'Amtsblatt',
  sendung: 'Sendungen (Regionaljournal, punkt6)'
}

export const ENTSCHEID_TEXT: Record<LernEntscheid, string> = {
  abgelehnt: 'abgelehnt',
  weitergereicht: 'an die Chefredaktion weitergereicht',
  perle_ja: 'als Perle bestaetigt',
  perle_nein: 'keine Perle',
  brauchbar: 'als brauchbare Recherche-Faehrte bestaetigt',
  kein_hinweis: 'als Faehrte abgelegt (kein Hinweis)',
  verworfen: 'uebernommen, die Meldung danach aber verworfen'
}

/** Reasons that carry no class — timing and assignment, never a kind of story. */
const OHNE_KLASSE: ReadonlySet<string> = new Set([
  'doublette',
  'veraltet',
  'falsche_gemeinde'
])

/**
 * Whether a decision is worth a classification call at all.
 *
 * Words always are: a comment is the editor explaining herself, and that is
 * exactly what the rule store is for. A bare click only when it repeats —
 * `gleichgerichtet` counts earlier decisions of the same kind in the same
 * scope — because one rejected Vereinsjubilaeum is an example, three are a
 * pattern. Taking a proposal over is never learned from: a positive rule
 * ("propose more X") is how a desk overflows.
 */
export function lohntLernen(
  fall: Pick<LernFall, 'entscheid' | 'grund' | 'kommentar'>,
  gleichgerichtet: number
): boolean {
  if (fall.grund !== null && OHNE_KLASSE.has(fall.grund)) return false
  if (fall.kommentar !== null) return true
  return gleichgerichtet >= 2
}

export const LERN_SYSTEM_PROMPT = [
  'Du hilfst einer Lokalredaktion, aus ihren Entscheiden am Redaktionstisch',
  'dauerhafte Regeln fuer die SICHTUNG herauszuloesen — also dafuer, was ihr',
  'kuenftig vorgeschlagen wird und was nicht.',
  '',
  'Du bekommst EINEN Entscheid (mit Grund und, falls vorhanden, dem Kommentar',
  'der Redaktion), die bereits geltenden Regeln dieses Tischs (nummeriert)',
  'und fruehere gleichgerichtete Entscheide.',
  '',
  'Antworte mit genau einem Urteil:',
  '- "abgedeckt": eine bestehende Regel erklaert diesen Entscheid schon — nenne',
  '  ihre Nummer in "regel_nr".',
  '- "neu": aus dem Entscheid laesst sich eine Regel ableiten, die eine KLASSE',
  '  von Beitraegen beschreibt (Thema, Gattung, Absender, Form) — nie den',
  '  Einzelfall. Formuliere sie in "regel" als knappe Anweisung an die Sichtung,',
  '  zum Beispiel "Vereinsjubilaeen ohne besondere Zutaten nicht vorschlagen".',
  '- "einmalig": der Entscheid sagt nichts ueber kuenftige Beitraege.',
  '',
  'Im Zweifel einmalig. Ohne Worte der Redaktion nur dann "neu", wenn die',
  'aufgefuehrten frueheren Entscheide erkennbar dieselbe Klasse zeigen. Eine',
  'falsch gelernte Regel wirkt auf jede kuenftige Sichtung und muss von Hand',
  'wieder entfernt werden.',
  '',
  '"wirkung" ist "weiterreichen" nur, wenn der Entscheid ein Weiterreichen an',
  'die Chefredaktion war und die Regel sagt, dass solche Beitraege dorthin',
  'gehoeren; sonst "hinweis".',
  '',
  'Antworte ausschliesslich mit JSON:',
  '{"urteil": "abgedeckt" | "neu" | "einmalig", "regel_nr": string oder null, "regel": string oder null, "wirkung": "hinweis" | "weiterreichen"}'
].join('\n')

export const LERN_SCHEMA = {
  type: 'object',
  properties: {
    urteil: { type: 'string', enum: ['abgedeckt', 'neu', 'einmalig'] },
    regel_nr: { type: ['string', 'null'] },
    regel: { type: ['string', 'null'] },
    wirkung: { type: 'string', enum: ['hinweis', 'weiterreichen'] }
  },
  required: ['urteil', 'regel_nr', 'regel', 'wirkung'],
  additionalProperties: false
} as const satisfies Record<string, unknown>

const MAX_ZUSAMMENFASSUNG = 600
const MAX_REGEL = 300

export function buildLernPrompt(
  fall: LernFall,
  regelnText: string,
  gleichgerichtete: readonly string[]
): string {
  const zeilen = [
    `Tisch: ${TISCH_NAME[fall.tisch]}`,
    `Quelle: ${fall.quelleName}`,
    `Beitrag: "${fall.titel}"${fall.merkmal === null ? '' : ` (${fall.merkmal})`}`
  ]
  if (fall.zusammenfassung !== null && fall.zusammenfassung.trim() !== '') {
    zeilen.push(
      `Zusammenfassung: ${fall.zusammenfassung.trim().slice(0, MAX_ZUSAMMENFASSUNG)}`
    )
  }
  if (fall.modellBegruendung !== null) {
    zeilen.push(
      `Einschaetzung des Modells beim Vorschlag: ${fall.modellBegruendung}`
    )
  }
  zeilen.push('', `Entscheid der Redaktion: ${ENTSCHEID_TEXT[fall.entscheid]}`)
  if (fall.grund !== null) zeilen.push(`Grund: ${fall.grund}`)
  if (fall.kommentar !== null)
    zeilen.push(`Kommentar der Redaktion: ${fall.kommentar}`)

  zeilen.push(
    '',
    regelnText === ''
      ? 'Bisher gibt es keine Regeln fuer diesen Tisch.'
      : regelnText,
    '',
    gleichgerichtete.length === 0
      ? 'Fruehere gleichgerichtete Entscheide: keine.'
      : `Fruehere gleichgerichtete Entscheide (${gleichgerichtete.length}):`,
    ...gleichgerichtete.map((t) => `- "${t}"`)
  )
  return zeilen.join('\n')
}

export interface LernUrteil {
  urteil: 'abgedeckt' | 'neu' | 'einmalig'
  /** The cited rule's id — resolved from its number, never trusted as given. */
  regelId: string | null
  regel: string | null
  wirkung: WissenWirkung
}

/**
 * The model's answer is a promise, not a proof — the guards here are the
 * newsroom's rules, not the model's:
 *
 * - "neu" without the editor's words and without two earlier decisions of the
 *   same kind is downgraded to "einmalig": one click is not a class.
 * - "weiterreichen" only survives on a hand-up. A rejection can never arm the
 *   automation, whatever the model says.
 * - A cited number that names no loaded rule is "einmalig", not a guess.
 */
export function parseLernUrteil(
  value: unknown,
  kontext: {
    nummern: ReadonlyMap<string, NummerierteRegel>
    entscheid: LernEntscheid
    kommentar: string | null
    gleichgerichtet: number
  }
): LernUrteil {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Claude-Antwort zum Lernen ist kein Objekt.')
  }
  const roh = value as Record<string, unknown>
  const einmalig: LernUrteil = {
    urteil: 'einmalig',
    regelId: null,
    regel: null,
    wirkung: 'hinweis'
  }

  const wirkung: WissenWirkung =
    roh['wirkung'] === 'weiterreichen' && kontext.entscheid === 'weitergereicht'
      ? 'weiterreichen'
      : 'hinweis'

  if (roh['urteil'] === 'abgedeckt') {
    const nummer =
      typeof roh['regel_nr'] === 'string' ? roh['regel_nr'].trim() : ''
    const regel = kontext.nummern.get(nummer)
    return regel === undefined
      ? einmalig
      : { urteil: 'abgedeckt', regelId: regel.id, regel: regel.regel, wirkung }
  }

  if (roh['urteil'] === 'neu') {
    const regel =
      typeof roh['regel'] === 'string' && roh['regel'].trim() !== ''
        ? roh['regel'].trim().slice(0, MAX_REGEL)
        : null
    if (regel === null) return einmalig
    if (kontext.kommentar === null && kontext.gleichgerichtet < 2)
      return einmalig
    return { urteil: 'neu', regelId: null, regel, wirkung }
  }

  return einmalig
}

/** One decision as a line of evidence on a rule. */
function belegZeile(fall: LernFall): string {
  const grund = fall.grund === null ? '' : `, ${fall.grund}`
  const kommentar = fall.kommentar === null ? '' : `: „${fall.kommentar}"`
  return `"${fall.titel}" (${fall.quelleName} — ${ENTSCHEID_TEXT[fall.entscheid]}${grund})${kommentar}`
}

/**
 * The columns a newly learned Sichtung rule is stored in.
 *
 * Global within its desk (the decision rows carry the local memory), and
 * with its evidence in `beleg`: the editor's words where there were any,
 * otherwise the decisions it was distilled from — so "Gelerntes" can show
 * WHY a rule exists, and the editor can judge it.
 */
export function regelFelder(
  urteil: LernUrteil,
  fall: LernFall,
  gleichgerichtete: readonly string[]
): Record<string, unknown> | null {
  if (urteil.urteil !== 'neu' || urteil.regel === null) return null

  const beleg =
    fall.kommentar !== null
      ? belegZeile(fall)
      : `Abgeleitet aus ${gleichgerichtete.length + 1} gleichgerichteten Entscheiden: ${belegZeile(fall)}` +
        gleichgerichtete.map((t) => `; "${t}"`).join('')

  return {
    regel: urteil.regel,
    geltungsbereich: 'global',
    herkunft: fall.kommentar !== null ? 'kommentar' : 'entscheid',
    aktiv: true,
    bereich: fall.tisch,
    stufe: 'sichtung',
    wirkung: urteil.wirkung,
    beleg,
    datensatz: null,
    quelle: null
  }
}

export const MAX_BELEG = 1500
const BELEG_KAPPUNG = '(… weitere Belege nicht aufgefuehrt)'

/**
 * A decision an existing rule already covers strengthens its evidence.
 *
 * Appended as one line; a full record says so instead of growing without
 * limit — the newsroom's rule for every list.
 */
export function belegErgaenzung(bisher: string | null, fall: LernFall): string {
  const zeile = `+ ${belegZeile(fall)}`
  const alt = bisher ?? ''
  if (alt.endsWith(BELEG_KAPPUNG)) return alt
  const neu = alt === '' ? zeile : `${alt}\n${zeile}`
  if (neu.length <= MAX_BELEG) return neu
  return alt === '' ? zeile.slice(0, MAX_BELEG) : `${alt}\n${BELEG_KAPPUNG}`
}

// ---------------------------------------------------------------------------
// Acting on a rule
// ---------------------------------------------------------------------------

/**
 * Whether a Sichtung's hand-up recommendation may be acted on — and by which
 * rule. Fail-closed by construction: the recommendation must be there, it
 * must cite a number that names a loaded rule, and that rule must be an
 * ACTIVE Sichtung rule the editor armed (`wirkung: weiterreichen`). Anything
 * less is a proposal like any other; the model cannot arm the automation by
 * naming a rule that does not exist.
 */
export function automatischeWeitergabe(
  item: { empfehlung: string | null; empfehlung_regel: string | null },
  nummern: ReadonlyMap<string, NummerierteRegel>,
  regeln: readonly { id: string; stufe: string; wirkung: string }[]
): NummerierteRegel | null {
  if (item.empfehlung !== 'weiterreichen' || item.empfehlung_regel === null) {
    return null
  }
  const zitiert = nummern.get(item.empfehlung_regel.trim())
  if (zitiert === undefined) return null
  const regel = regeln.find((r) => r.id === zitiert.id)
  if (regel === undefined) return null
  return regel.stufe === 'sichtung' && regel.wirkung === 'weiterreichen'
    ? zitiert
    : null
}

/**
 * Whether the Chefredaktion has just said no twice in a row to what a rule
 * handed up — the newsroom's trip-wire for the automation. `letzte` is the
 * rule's judged leads, newest first; a hand-up she gave back to the desk
 * counts as a no.
 */
export function automatikPausieren(letzte: readonly string[]): boolean {
  if (letzte.length < 2) return false
  return letzte
    .slice(0, 2)
    .every((s) => s === 'kein_hinweis' || s === 'zurueckgegeben')
}
