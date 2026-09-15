// The rule store, opened to every desk.
//
// `redaktionswissen` used to be the statistics feed's private memory: rules
// distilled from the editor's chat, read only by the drain. Every other desk
// learned from examples alone. Now one loader serves them all, keyed by the
// desk (`bereich`) and by what the rule governs (`stufe`: what gets proposed,
// or how a Meldung is written), and one writer turns an editor's words —
// a chat instruction, a comment on a decision — into a rule.
//
// Directus-facing through injected services, so every rule here is tested
// without a database. The pure halves live in `wissen.ts` (chat → rule) and
// `lernen.ts` (decisions → rule, rules → prompt).

import { completeJson, type MessageSender } from '../shared/claude'
import type {
  Geltungsbereich,
  WissenBereich,
  WissenStufe,
  WissenWirkung
} from '../types/schema'
import {
  buildWissenPrompt,
  parseWissen,
  wissenFelder,
  WISSEN_SCHEMA,
  WISSEN_SYSTEM_PROMPT
} from './wissen'
import {
  belegErgaenzung,
  buildLernPrompt,
  LERN_SCHEMA,
  LERN_SYSTEM_PROMPT,
  lohntLernen,
  parseLernUrteil,
  regelFelder,
  regelnBlock,
  SICHTUNGSREGELN_UEBERSCHRIFT,
  automatikPausieren,
  type LernEntscheid,
  type LernFall,
  type LernTisch
} from './lernen'

export interface RegelZeile {
  id: string
  regel: string
  bereich: WissenBereich
  stufe: WissenStufe
  wirkung: WissenWirkung
}

export interface RegelFrage {
  bereich: WissenBereich
  stufe: WissenStufe
  /** Statistics only: the dataset and portal a rule may be scoped to. */
  scope?: { datensatz?: string | null; quelle?: string | null }
}

export interface WissenDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown>
}

/**
 * Bounded so a prompt cannot grow without limit as memory builds. NEWEST
 * first, and one more than the cap: sorted ascending, a full memory meant
 * every rule learned after the thirtieth was silently ignored for ever — the
 * opposite of learning. Now the latest lesson always applies, and a full cap
 * is said out loud so an editor can retire old rules in "Gelerntes".
 */
export const REGEL_DECKEL = 30

export async function ladeRegeln(
  dienst: WissenDienst,
  frage: RegelFrage,
  logger: { warn: (m: string) => void },
  deckel = REGEL_DECKEL
): Promise<RegelZeile[]> {
  const filter: Record<string, unknown> = {
    aktiv: { _eq: true },
    bereich: { _eq: frage.bereich },
    stufe: { _eq: frage.stufe }
  }
  // Desk rules are global within their desk — the examples carry the local
  // memory. Only the statistics feed scopes rules to a dataset or a portal.
  if (frage.bereich === 'statistik') {
    const passend: Record<string, unknown>[] = [
      { geltungsbereich: { _eq: 'global' } }
    ]
    const datensatz = frage.scope?.datensatz ?? null
    const quelle = frage.scope?.quelle ?? null
    if (datensatz !== null) passend.push({ datensatz: { _eq: datensatz } })
    if (quelle !== null) passend.push({ quelle: { _eq: quelle } })
    filter['_or'] = passend
  }

  const regeln = (await dienst.readByQuery({
    filter,
    fields: ['id', 'regel', 'bereich', 'stufe', 'wirkung'],
    sort: ['-date_created'],
    limit: deckel + 1
  })) as RegelZeile[]

  if (regeln.length > deckel) {
    logger.warn(
      `gedaechtnis: mehr als ${deckel} aktive Regeln fuer ${frage.bereich}/${frage.stufe} — die aeltesten werden nicht mehr angewendet. Im Reiter "Gelerntes" ausmisten.`
    )
  }
  return regeln.slice(0, deckel)
}

/** Which rule a piece of the editor's words is about, and where it may apply. */
export interface WissenBezug {
  bereich: WissenBereich
  /** What the model is told the instruction refers to — a dataset title, a desk. */
  titel: string
  /** The scopes the answer may choose from; desks allow `global` only. */
  erlaubt: readonly Geltungsbereich[]
  datensatzId?: string | null
  quelleId?: string | null
  herkunft?: 'chat' | 'kommentar'
  /** Stored as the rule's evidence; defaults to the instruction itself. */
  beleg?: string
}

/**
 * Asks whether the editor's words carry a durable rule and stores it if so.
 *
 * Fire-and-forget at every call site on purpose: the editor should not wait
 * on it, and a failure here costs a remembered preference, not the revision
 * or the decision itself. One Sonnet call, low effort, no thinking — the
 * question is small.
 */
export async function merkeWissenAus(
  dienste: {
    wissen: { createOne(payload: Record<string, unknown>): Promise<unknown> }
    logger: {
      info: (m: string) => void
      warn: (e: unknown, m?: string) => void
    }
  },
  anweisung: string,
  bezug: WissenBezug,
  sender?: MessageSender
): Promise<void> {
  try {
    const antwort = await completeJson<unknown>(
      {
        system: WISSEN_SYSTEM_PROMPT,
        prompt: buildWissenPrompt(anweisung, bezug.titel, bezug.erlaubt),
        maxTokens: 600,
        thinking: 'disabled',
        effort: 'low',
        schema: WISSEN_SCHEMA
      },
      ...(sender === undefined ? [] : ([sender] as const))
    )
    const urteil = parseWissen(antwort, bezug.erlaubt)
    const felder = wissenFelder(urteil, {
      bereich: bezug.bereich,
      datensatzId: bezug.datensatzId ?? null,
      quelleId: bezug.quelleId ?? null,
      herkunft: bezug.herkunft ?? 'chat',
      beleg: bezug.beleg ?? anweisung
    })
    if (felder === null) return

    await dienste.wissen.createOne(felder)
    dienste.logger.info(
      `gedaechtnis: neue Regel gemerkt (${bezug.bereich}) — ${String(felder['regel'])}`
    )
  } catch (fehler) {
    dienste.logger.warn(
      fehler,
      `gedaechtnis: Anweisung (${bezug.bereich}) konnte nicht bewertet werden`
    )
  }
}

// ---------------------------------------------------------------------------
// Learning from decisions
// ---------------------------------------------------------------------------

/** A decision the desk just made, as the endpoints report it. */
export interface EntscheidSignal {
  tisch: LernTisch
  art: 'entscheid' | 'perle' | 'faehrte' | 'verwerfen'
  entscheid: LernEntscheid
  grund: string | null
  kommentar: string | null
  /** The desk row — wochenblattkandidaten, amtsblattmeldungen or sendungskandidaten. */
  zeileId?: string | null
  /** A lead judged without an origin row: the inventory's own Faehrte. */
  hinweisId?: string | null
}

export interface LernDienste {
  zeilen: WissenDienst
  hinweise: WissenDienst
  wissen: WissenDienst & {
    createOne(payload: Record<string, unknown>): Promise<unknown>
    updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
  }
  logger: { info: (m: string) => void; warn: (e: unknown, m?: string) => void }
  send?: MessageSender
}

const GLEICHGERICHTET_FENSTER = 20

function text(wert: unknown): string | null {
  return typeof wert === 'string' && wert.trim() !== '' ? wert : null
}

/**
 * The decided row as the classifier needs it, plus the earlier decisions of
 * the same kind in the same scope — the repetition a bare click needs before
 * it may become a rule.
 */
async function ladeFall(
  dienste: LernDienste,
  signal: EntscheidSignal
): Promise<{ fall: LernFall; gleichgerichtete: string[] } | null> {
  const zeileId = signal.zeileId ?? null
  const hinweisId = signal.hinweisId ?? null

  // The inventory's own lead: no origin row, the lead is the whole case.
  if (zeileId === null) {
    if (hinweisId === null) return null
    const [lead] = (await dienste.hinweise.readByQuery({
      filter: { id: { _eq: hinweisId } },
      fields: ['titel', 'begruendung', 'quelltext', 'ausgabe.wochenblatt.name'],
      limit: 1
    })) as Array<Record<string, unknown>>
    if (lead === undefined) return null
    const ausgabe = lead['ausgabe'] as {
      wochenblatt: { name: string } | null
    } | null
    const andere = (await dienste.hinweise.readByQuery({
      filter: {
        id: { _neq: hinweisId },
        status: { _eq: signal.entscheid },
        kandidat: { _null: true }
      },
      fields: ['titel'],
      sort: ['-date_updated'],
      limit: GLEICHGERICHTET_FENSTER
    })) as Array<{ titel: string }>
    return {
      fall: {
        tisch: 'presseschau',
        quelleName: ausgabe?.wochenblatt?.name ?? 'Wochenblatt',
        titel: String(lead['titel'] ?? ''),
        merkmal: 'Recherche-Faehrte des Inventars',
        zusammenfassung: text(lead['quelltext']),
        modellBegruendung: text(lead['begruendung']),
        entscheid: signal.entscheid,
        grund: signal.grund,
        kommentar: signal.kommentar
      },
      gleichgerichtete: andere.map((a) => a.titel)
    }
  }

  const felder: Record<LernTisch, string[]> = {
    presseschau: [
      'id',
      'titel',
      'typ',
      'zusammenfassung',
      'warum_exklusiv',
      'ausgabe.wochenblatt.id',
      'ausgabe.wochenblatt.name'
    ],
    amtsblatt: [
      'id',
      'titel',
      'rubrik_name',
      'angaben',
      'vorschlag_begruendung',
      'gemeinde.id',
      'gemeinde.name'
    ],
    gemeinde: [
      'id',
      'titel',
      'kategorie',
      'teaser',
      'text',
      'vorschlag_begruendung',
      'gemeinde.id',
      'gemeinde.name'
    ],
    sendung: [
      'id',
      'titel',
      'zusammenfassung',
      'begruendung',
      'quelle',
      'gemeinde.name'
    ]
  }
  const [zeile] = (await dienste.zeilen.readByQuery({
    filter: { id: { _eq: zeileId } },
    fields: felder[signal.tisch],
    limit: 1
  })) as Array<Record<string, unknown>>
  if (zeile === undefined) return null

  let fall: LernFall
  let scope: Record<string, unknown>
  if (signal.tisch === 'presseschau') {
    const ausgabe = zeile['ausgabe'] as {
      wochenblatt: { id: string; name: string } | null
    } | null
    fall = {
      tisch: 'presseschau',
      quelleName: ausgabe?.wochenblatt?.name ?? 'Wochenblatt',
      titel: String(zeile['titel'] ?? ''),
      merkmal: text(zeile['typ']),
      zusammenfassung: text(zeile['zusammenfassung']),
      modellBegruendung: text(zeile['warum_exklusiv']),
      entscheid: signal.entscheid,
      grund: signal.grund,
      kommentar: signal.kommentar
    }
    scope =
      ausgabe?.wochenblatt?.id === undefined
        ? {}
        : { ausgabe: { wochenblatt: { _eq: ausgabe.wochenblatt.id } } }
  } else if (signal.tisch === 'amtsblatt') {
    const gemeinde = zeile['gemeinde'] as { id: string; name: string } | null
    const angaben = Array.isArray(zeile['angaben'])
      ? (zeile['angaben'] as Array<{ bezeichnung: string; wert: string }>)
          .map((a) => `${a.bezeichnung}: ${a.wert}`)
          .join('; ')
      : null
    fall = {
      tisch: 'amtsblatt',
      quelleName: gemeinde?.name ?? 'Gemeinde',
      titel: String(zeile['titel'] ?? ''),
      merkmal: text(zeile['rubrik_name']),
      zusammenfassung: angaben === '' ? null : angaben,
      modellBegruendung: text(zeile['vorschlag_begruendung']),
      entscheid: signal.entscheid,
      grund: signal.grund,
      kommentar: signal.kommentar
    }
    scope = gemeinde === null ? {} : { gemeinde: { _eq: gemeinde.id } }
  } else if (signal.tisch === 'gemeinde') {
    const gemeinde = zeile['gemeinde'] as { id: string; name: string } | null
    const teaser = text(zeile['teaser'])
    const inhalt = text(zeile['text'])
    fall = {
      tisch: 'gemeinde',
      quelleName: gemeinde?.name ?? 'Gemeinde',
      titel: String(zeile['titel'] ?? ''),
      merkmal: text(zeile['kategorie']),
      // `buildLernPrompt` caps the summary; the teaser is the item's own.
      zusammenfassung:
        teaser ?? (inhalt === null ? null : inhalt.slice(0, 600)),
      modellBegruendung: text(zeile['vorschlag_begruendung']),
      entscheid: signal.entscheid,
      grund: signal.grund,
      kommentar: signal.kommentar
    }
    scope = gemeinde === null ? {} : { gemeinde: { _eq: gemeinde.id } }
  } else {
    const gemeinde = zeile['gemeinde'] as { name: string } | null
    fall = {
      tisch: 'sendung',
      quelleName: String(zeile['quelle'] ?? 'Sendung'),
      titel: String(zeile['titel'] ?? ''),
      merkmal: gemeinde?.name ?? null,
      zusammenfassung: text(zeile['zusammenfassung']),
      modellBegruendung: text(zeile['begruendung']),
      entscheid: signal.entscheid,
      grund: signal.grund,
      kommentar: signal.kommentar
    }
    scope = { quelle: { _eq: zeile['quelle'] } }
  }

  // Earlier decisions of the same kind. A Perle verdict is taste and taste is
  // global, so it is not narrowed to the paper; everything else is.
  if (signal.art === 'faehrte') {
    const fk =
      signal.tisch === 'presseschau'
        ? 'kandidat'
        : signal.tisch === 'amtsblatt'
          ? 'amtsblattmeldung'
          : signal.tisch === 'gemeinde'
            ? 'gemeindemitteilung'
            : 'sendungskandidat'
    const andere = (await dienste.hinweise.readByQuery({
      filter: {
        [fk]: { _nnull: true, _neq: zeileId },
        status: { _eq: signal.entscheid }
      },
      fields: ['titel'],
      sort: ['-date_updated'],
      limit: GLEICHGERICHTET_FENSTER
    })) as Array<{ titel: string }>
    return { fall, gleichgerichtete: andere.map((a) => a.titel) }
  }
  if (signal.art === 'verwerfen') {
    // Only ever reached with the editor's words — no repetition to count.
    return { fall, gleichgerichtete: [] }
  }
  const filter: Record<string, unknown> =
    signal.art === 'perle'
      ? {
          id: { _neq: zeileId },
          perle: { _eq: signal.entscheid === 'perle_ja' }
        }
      : {
          ...scope,
          id: { _neq: zeileId },
          entscheid: { _eq: signal.entscheid },
          ...(signal.grund === null
            ? {}
            : { ablehnungsgrund: { _eq: signal.grund } })
        }
  const andere = (await dienste.zeilen.readByQuery({
    filter,
    fields: ['titel'],
    sort: ['-date_updated'],
    limit: GLEICHGERICHTET_FENSTER
  })) as Array<{ titel: string }>
  return { fall, gleichgerichtete: andere.map((a) => a.titel) }
}

/** One learner at a time per desk, so two quick decisions cannot create twin rules. */
const ketten = new Map<string, Promise<void>>()

/**
 * Turns a decision into a rule where one is warranted — see `lernen.ts` for
 * the rules of that. Fire-and-forget at every call site; a failure costs a
 * lesson, never the decision.
 */
export function lerneAusEntscheid(
  dienste: LernDienste,
  signal: EntscheidSignal
): Promise<void> {
  const arbeit = async (): Promise<void> => {
    try {
      const geladen = await ladeFall(dienste, signal)
      if (geladen === null) return
      const { fall, gleichgerichtete } = geladen
      if (!lohntLernen(fall, gleichgerichtete.length)) return

      const regeln = await ladeRegeln(
        dienste.wissen,
        { bereich: fall.tisch, stufe: 'sichtung' },
        { warn: (m: string) => dienste.logger.warn(m) }
      )
      const block = regelnBlock(regeln, SICHTUNGSREGELN_UEBERSCHRIFT)

      const antwort = await completeJson<unknown>(
        {
          system: LERN_SYSTEM_PROMPT,
          prompt: buildLernPrompt(fall, block.text, gleichgerichtete),
          maxTokens: 700,
          thinking: 'disabled',
          effort: 'low',
          schema: LERN_SCHEMA
        },
        ...(dienste.send === undefined ? [] : ([dienste.send] as const))
      )
      const urteil = parseLernUrteil(antwort, {
        nummern: block.nummern,
        entscheid: fall.entscheid,
        kommentar: fall.kommentar,
        gleichgerichtet: gleichgerichtete.length
      })

      if (urteil.urteil === 'neu') {
        const felder = regelFelder(urteil, fall, gleichgerichtete)
        if (felder === null) return
        await dienste.wissen.createOne(felder)
        dienste.logger.info(
          `gedaechtnis: neue Sichtungsregel (${fall.tisch}) — ${String(felder['regel'])}`
        )
      } else if (urteil.urteil === 'abgedeckt' && urteil.regelId !== null) {
        const [regel] = (await dienste.wissen.readByQuery({
          filter: { id: { _eq: urteil.regelId } },
          fields: ['id', 'beleg'],
          limit: 1
        })) as Array<{ id: string; beleg: string | null }>
        if (regel === undefined) return
        await dienste.wissen.updateOne(regel.id, {
          beleg: belegErgaenzung(regel.beleg, fall)
        })
      }
    } catch (fehler) {
      dienste.logger.warn(
        fehler,
        `gedaechtnis: Entscheid (${signal.tisch}, ${signal.entscheid}) nicht gelernt`
      )
    }
  }

  const naechste = (ketten.get(signal.tisch) ?? Promise.resolve()).then(arbeit)
  ketten.set(signal.tisch, naechste)
  return naechste
}

// ---------------------------------------------------------------------------
// The automation's trip-wire
// ---------------------------------------------------------------------------

function datumKurz(iso: string): string {
  const [jahr, monat, tag] = iso.slice(0, 10).split('-')
  return `${tag ?? ''}.${monat ?? ''}.${jahr ?? ''}`
}

/**
 * Two rejections in a row from the Chefredaktion pause a rule's automation.
 *
 * The rule stays — active, visible, still a hint to the Sichtung — only its
 * `wirkung` drops back to `hinweis`, and the beleg says when and why. Arming
 * it again is the editor's switch in "Gelerntes". Called after every verdict
 * on a lead a rule handed up; returns whether it paused anything.
 */
export async function pausiereAutomatikWennNoetig(
  dienste: {
    hinweise: WissenDienst
    wissen: WissenDienst & {
      updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
    }
    logger: { info: (m: string) => void }
  },
  regelId: string,
  heute: string
): Promise<boolean> {
  const urteile = (await dienste.hinweise.readByQuery({
    filter: { regel: { _eq: regelId }, status: { _neq: 'offen' } },
    fields: ['status'],
    sort: ['-date_updated'],
    limit: 2
  })) as Array<{ status: string }>
  if (!automatikPausieren(urteile.map((u) => u.status))) return false

  const [regel] = (await dienste.wissen.readByQuery({
    filter: { id: { _eq: regelId } },
    fields: ['id', 'regel', 'wirkung', 'beleg'],
    limit: 1
  })) as Array<{
    id: string
    regel: string
    wirkung: string
    beleg: string | null
  }>
  if (regel === undefined || regel.wirkung !== 'weiterreichen') return false

  await dienste.wissen.updateOne(regelId, {
    wirkung: 'hinweis',
    beleg: [
      regel.beleg ?? '',
      `Automatik pausiert am ${datumKurz(heute)} nach zwei Rueckweisungen der Chefredaktion.`
    ]
      .filter((z) => z !== '')
      .join('\n')
  })
  dienste.logger.info(`gedaechtnis: Automatik pausiert — ${regel.regel}`)
  return true
}
