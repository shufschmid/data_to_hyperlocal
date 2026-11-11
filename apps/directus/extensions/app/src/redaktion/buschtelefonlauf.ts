// The Directus-bound half of the Buschtelefon desk: the daily fetch, shared
// by the 12:00 Flow and the «Jetzt abholen» button.
//
// Everything outside is injected — the services as the small interfaces
// below, the door's `fetch`, the model's sender, the clock — so the whole run
// is tested against stubs. The door does not exist yet in the form of the
// contract; this is built against `shared/buschtelefon/` and its fixtures.
//
// The order of a run, and why:
//  1. access from the environment — missing means the feed is OFF and says
//     which variable it lacks, never an error;
//  2. the sources, so a find can carry its group's address (the find itself
//     has none) — a failure here is named and the run goes on;
//  3. the finds from the bookmark on, page by page; every page is stored and
//     the bookmark written before the next one is asked for;
//  4. per find its own try/catch: a row that cannot be written is NAMED and
//     SKIPPED, the bookmark passes it. One unstorable find blocked the whole
//     feed of the first attempt for as long as the door held it;
//  5. retention — rows stay, material goes;
//  6. the Sichtung, in packets, per municipality;
//  7. the drafts for the proposals;
//  8. the bookmark row with the run's result.
// Steps 5 to 7 work on what is STORED, so they run even when the door was
// unreachable today. Retention (5) runs even when the door is not set up at
// all — a feed switched off must not keep private persons' words for ever —
// while the Sichtung and the drafts (6, 7) do not: a switched-off feed buys
// no model calls.
//
// One run at a time, process-wide (`holeAbEinzeln`): the Flow's three slots
// and the desk's button share it, because two runs on the same bookmark pay
// every Sichtung twice and the second can discard the draft the first wrote.
//
// Nothing a model or a provider said reaches the run's result, the stored
// bookmark row or the log: failures are sentences keyed on their class
// (`fehlerSatz`), the log gets the class and the code (`fehlerKennung`).

import {
  cacheableSystem,
  completeJson,
  type MessageSender
} from '../shared/claude'
import {
  BuschtelefonFehler,
  holeFunde,
  holeQuellen,
  liesZugang,
  type FetchLike,
  type Tuerzugang
} from '../shared/buschtelefon/client'
import { hoechsteFolge, tagInZuerich } from '../shared/buschtelefon/parse'
import {
  istEntfernt,
  type EntfernterFund,
  type Freigabe,
  type Fund,
  type FundeAntwort,
  type Quelle
} from '../shared/buschtelefon/typen'
import type { BuschtelefonFund, BuschtelefonStand } from '../types/schema'
import { datumDeutsch, lernDigest, type LernEintrag } from './amtsblatt'
import {
  abgleich,
  alsZahl,
  aufraeumAktion,
  buildBuschtelefonSichtungPrompt,
  BUSCHTELEFON_SICHTUNG_SYSTEM,
  endgueltigerGrund,
  entferneKommentare,
  fundFelder,
  gemeindeFuer,
  hatMaterial,
  HINWEIS_KOMMENTARE_ENTFERNT,
  HINWEIS_NICHT_AUFFINDBAR,
  HINWEIS_NICHT_ERREICHBAR,
  leereKommentare,
  leereMaterial,
  neueKommentare,
  parseStufenSichtung,
  quelleNeuSetzen,
  quelleVeraltet,
  STUFEN_SCHEMA,
  type AufraeumZeile,
  type BespielteGemeinde,
  type QuellenFelder,
  type SichtungsZeile
} from './buschtelefon'
import {
  BUSCHTELEFON_MELDUNGEN_JE_LAUF,
  fehlerKennung,
  fehlerSatz,
  FUND_FELDER,
  schreibeFundMeldungen,
  type FundRohzeile
} from './buschtelefonmeldungen'
import type { RegelZeile } from './gedaechtnis'
import { automatischeWeitergabe, type NummerierteRegel } from './lernen'
import { LERN_FENSTER, type Beispielrahmen } from './lernsignale'
import { pakete, SICHTUNG_AUFRUF, sichtungsFehlerText } from './sichtungspakete'
import { istVorschlag } from './tischeinstellungen'

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export interface LeseDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown>
}

export interface ZeilenDienst extends LeseDienst {
  createOne(payload: Record<string, unknown>): Promise<unknown>
  updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
}

/** `buschtelefon_stand` is a singleton: one row, read and written whole. */
export interface StandDienst {
  lies(): Promise<Partial<BuschtelefonStand> | null>
  schreibe(payload: Record<string, unknown>): Promise<unknown>
}

export interface Logger {
  info: (m: string) => void
  warn: (e: unknown, m?: string) => void
}

/** What the desk's memory hands a Sichtung — the shape of `AmtsblattSignale` in `lernsignale.ts`. */
export interface FundSignale {
  entscheide: LernEintrag[]
  rahmen: Partial<Beispielrahmen>
}

export interface AbholDienste {
  funde: ZeilenDienst
  quellen: ZeilenDienst
  stand: StandDienst
  meldungen: ZeilenDienst
  /** `recherchehinweise` — read for a handed-up find's verdict, written only to empty a lead's `quelltext`. */
  hinweise: LeseDienst & {
    updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
  }
  /** `gemeinden` — the active ones are the covered ones. */
  gemeinden: LeseDienst
  /** From this grade up a find is a proposal — `tischeinstellungen`, desk `buschtelefon`. */
  schwelle: number
  /** The desk's Sichtung rules as loaded (`ladeRegeln`), and rendered (`regelnBlock`). */
  regelzeilen: readonly RegelZeile[]
  sichtungsregeln: {
    text: string
    nummern: ReadonlyMap<string, NummerierteRegel>
  }
  /** The desk's text rules for the drafts — `ladeRegeln(…, stufe: 'text')` brings `allgemein` along. */
  textregeln: readonly string[]
  /**
   * The decisions of ONE municipality as examples for its Sichtung
   * (`ladeBuschtelefonSignale`, bound to its services). Left out: the
   * Sichtung runs on the rules alone. Never asked for the group without a
   * municipality.
   */
  ladeSignale?: (gemeindeId: string, heute: string) => Promise<FundSignale>
  /**
   * Hands a find to the Chefredaktion because an armed rule said so
   * (`reicheWeiter` with `buschtelefonFundAlsHinweis`, `automatisch: true`).
   * Left out: the recommendation is ignored and the find stays a proposal.
   */
  reicheAutomatischWeiter?: (
    fundId: string,
    regel: NummerierteRegel
  ) => Promise<void>
  logger: Logger
  env?: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  send?: MessageSender
  /** The clock — tests replay a day. */
  jetzt?: () => Date
}

export interface AbholOptionenLauf {
  /** Finds per page of the door (default 200, the Flow's option). */
  limit?: number
  /** How many drafts this run writes at most. */
  entwuerfe?: number
  /** A model for the Sichtung other than the default. */
  model?: string | null
}

export interface AbholErgebnis {
  /**
   * `nicht_eingerichtet`: the access variables are missing, nothing was
   * asked (retention still ran). `fehlgeschlagen`: the door could not be
   * read today (the stored rows were still tended). `laeuft`: another run
   * was under way, this call did nothing. `ok`: read, even if single rows
   * failed.
   */
  status: 'ok' | 'nicht_eingerichtet' | 'fehlgeschlagen' | 'laeuft'
  fehlend: string[]
  /** Entries the door delivered: finds, tombstones, omitted and refused ones. */
  gelesen: number
  neu: number
  ersetzt: number
  unveraendert: number
  /** Deliveries for rows the newsroom had already decided — left as they were. */
  entschieden: number
  /** Re-deliveries of rows whose material was emptied, and tombstones for unknown rows. */
  ignoriert: number
  entfernt: number
  /** Finds the parser refused, each with its reason — the bookmark passed them. */
  ungueltig: string[]
  /**
   * Finds the door holds but could not hand over — distinct kennungen of
   * this run's delivery that did not arrive as a find later in it.
   */
  ausgelassen: number
  /** New finds whose source fits no single covered municipality. */
  ohneGemeinde: number
  gesichtet: number
  vorschlaege: number
  entwuerfe: number
  /** Proposals the draft cap left for tomorrow, named without their wording. */
  wartend: string[]
  aufgeraeumt: { verfallen: number; geleert: number }
  fehler: string[]
  hinweise: string[]
  /** Where the bookmark stands after this run. */
  folge: number | null
}

export function leeresErgebnis(): AbholErgebnis {
  return {
    status: 'ok',
    fehlend: [],
    gelesen: 0,
    neu: 0,
    ersetzt: 0,
    unveraendert: 0,
    entschieden: 0,
    ignoriert: 0,
    entfernt: 0,
    ungueltig: [],
    ausgelassen: 0,
    ohneGemeinde: 0,
    gesichtet: 0,
    vorschlaege: 0,
    entwuerfe: 0,
    wartend: [],
    aufgeraeumt: { verfallen: 0, geleert: 0 },
    fehler: [],
    hinweise: [],
    folge: null
  }
}

/** A failure as the run may say it — see `fehlerSatz`. */
function fehlerText(fehler: unknown): string {
  return fehlerSatz(fehler)
}

// ---------------------------------------------------------------------------
// 2. Sources
// ---------------------------------------------------------------------------

/** The row of one source of `/quellen`. `n_ausgelassen` is not the door's and is written separately. */
export function quelleFelder(quelle: Quelle): Record<string, unknown> {
  const hinweise = [...quelle.hinweise, ...quelle.kuerzungen]
  return {
    kennung: quelle.kennung,
    kanal: quelle.kanal,
    art: quelle.art,
    name: quelle.name,
    url: quelle.url,
    sichtbarkeit: quelle.sichtbarkeit,
    zugang: quelle.zugang,
    gemeinden_bfs: quelle.gemeinden_bfs,
    aktiv: quelle.aktiv,
    stand: quelle.stand,
    zuletzt_vollstaendig_gelesen_am: quelle.zuletzt_vollstaendig_gelesen_am,
    gelesen_zurueck_bis: quelle.gelesen_zurueck_bis,
    n_beitraege_gesehen: quelle.n_beitraege_gesehen,
    n_aussortiert: quelle.n_aussortiert,
    n_zu_alt: quelle.n_zu_alt,
    fehler_seit: quelle.fehler_seit,
    letzter_fehler: quelle.letzter_fehler,
    hinweise: hinweise.length === 0 ? null : hinweise
  }
}

interface QuellenStand {
  /** kennung → the group's address, for the finds of this run. */
  urls: Map<string, string | null>
  /** kennung → row id. */
  ids: Map<string, string>
  /** kennung → what the door currently omits from it (`ausgelassen_offen`). */
  offen: Map<string, AusgelassenEintrag[]>
}

async function ladeQuellenStand(quellen: LeseDienst): Promise<QuellenStand> {
  const zeilen = (await quellen.readByQuery({
    fields: ['id', 'kennung', 'url', 'ausgelassen_offen'],
    limit: -1
  })) as Array<{
    id: string
    kennung: string
    url: string | null
    ausgelassen_offen: unknown
  }>
  return {
    urls: new Map(zeilen.map((z) => [z.kennung, z.url])),
    ids: new Map(zeilen.map((z) => [z.kennung, z.id])),
    offen: new Map(
      zeilen.map((z) => [z.kennung, liesAusgelassene(z.ausgelassen_offen)])
    )
  }
}

/**
 * Upserts every source by `kennung`. A source is never removed — the door
 * only ever switches one off. One source that cannot be written is named and
 * the others go on.
 */
export async function schreibeQuellen(
  quellen: ZeilenDienst,
  gelieferte: readonly Quelle[],
  stand: QuellenStand,
  ergebnis: Pick<AbholErgebnis, 'fehler'>
): Promise<void> {
  for (const quelle of gelieferte) {
    try {
      const id = stand.ids.get(quelle.kennung)
      if (id === undefined) {
        const neu = (await quellen.createOne({
          ...quelleFelder(quelle),
          n_ausgelassen: 0,
          ausgelassen_offen: []
        })) as string
        stand.ids.set(quelle.kennung, neu)
        stand.offen.set(quelle.kennung, [])
      } else await quellen.updateOne(id, quelleFelder(quelle))
      stand.urls.set(quelle.kennung, quelle.url)
    } catch (fehler) {
      ergebnis.fehler.push(
        `Quelle ${quelle.kennung} nicht gespeichert: ${fehlerText(fehler)}`
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 4. One find
// ---------------------------------------------------------------------------

type Bestand = Pick<
  BuschtelefonFund,
  | 'id'
  | 'kennung'
  | 'folge'
  | 'entscheid'
  | 'status'
  | 'material_geloescht_am'
  | 'kommentare'
  | 'hinweise'
  | 'gesichtet_folge'
  | 'entfernt_grund'
  | 'entschieden_am'
> & { gemeinde: string | null }

const BESTAND_FELDER = [
  'id',
  'kennung',
  'folge',
  'entscheid',
  'status',
  'material_geloescht_am',
  'kommentare',
  'hinweise',
  'gesichtet_folge',
  'entfernt_grund',
  'entschieden_am',
  'gemeinde'
]

const SICHTUNG_ZURUECK = {
  vorschlag: null,
  vorschlag_wert: null,
  vorschlag_begruendung: null,
  gesichtet_folge: null,
  entwurf_bedenken: null
}

export const ENTWURF_VERALTET =
  'Der Fund kam vom Buschtelefon mit neuem Stand — der Entwurf galt dem alten und wurde verworfen.'
export const HINWEIS_ENTWURF_AELTER =
  'Der Entwurf wurde vor der letzten Änderung des Funds geschrieben und von der Redaktion bearbeitet — er blieb stehen'
export const HINWEIS_QUELLE_NEU =
  'Die Sichtbarkeit der Quelle hat sich geändert — Quellenzeile und Quellenadresse des Entwurfs wurden nachgeführt'
export const HINWEIS_WIEDER_DA =
  'Wieder erreichbar, nachdem das Buschtelefon den Beitrag als an der Quelle gelöscht gemeldet hatte'

/** A draft the editor touched, as `verwirfUnberuehrtenEntwurf` hands it back. */
export interface BehaltenerEntwurf {
  id: string
  text: string | null
  datengrundlage: unknown
}

/**
 * Discards the machine draft of a find — only one nobody touched. A draft
 * the editor revised in the chat carries a `date_updated`; it stays, and is
 * handed back so the caller can say on the row that it is older than the
 * find, and bring its source line up to date.
 */
export async function verwirfUnberuehrtenEntwurf(
  meldungen: ZeilenDienst,
  fundId: string,
  grund: string
): Promise<{ verworfen: number; behalten: BehaltenerEntwurf[] }> {
  const entwuerfe = (await meldungen.readByQuery({
    filter: {
      buschtelefon_fund: { _eq: fundId },
      status: { _eq: 'entwurf' }
    },
    fields: ['id', 'date_updated', 'text', 'datengrundlage'],
    limit: -1
  })) as Array<{
    id: string
    date_updated: string | null
    text?: string | null
    datengrundlage?: unknown
  }>
  let verworfen = 0
  const behalten: BehaltenerEntwurf[] = []
  for (const entwurf of entwuerfe) {
    if (entwurf.date_updated !== null) {
      behalten.push({
        id: entwurf.id,
        text: entwurf.text ?? null,
        datengrundlage: entwurf.datengrundlage ?? null
      })
      continue
    }
    await meldungen.updateOne(entwurf.id, {
      status: 'verworfen',
      fehler: grund
    })
    verworfen += 1
  }
  return { verworfen, behalten }
}

/**
 * Brings a kept draft's source line and `datengrundlage` up to date with the
 * row it now stands on (decision 6): when a group turned out closed, a draft
 * the editor already touched must not go on linking the post — in its text
 * or in the `quelle_url` the Dorfkoenig reads. Returns how many it rewrote.
 */
export async function fuehreQuelleNach(
  meldungen: ZeilenDienst,
  entwuerfe: readonly BehaltenerEntwurf[],
  zeile: QuellenFelder
): Promise<number> {
  let nachgefuehrt = 0
  for (const entwurf of entwuerfe) {
    if (!quelleVeraltet(entwurf, zeile)) continue
    await meldungen.updateOne(entwurf.id, quelleNeuSetzen(entwurf, zeile))
    nachgefuehrt += 1
  }
  return nachgefuehrt
}

const ENTFERNT_GRUND: Record<string, string> = {
  an_der_quelle_geloescht: 'an der Quelle gelöscht',
  loeschbegehren: 'Löschbegehren',
  quelle_abgemeldet: 'Quelle abgemeldet'
}

function grundText(grund: string | null | undefined): string {
  return grund === null || grund === undefined
    ? ''
    : ` (${ENTFERNT_GRUND[grund] ?? grund})`
}

/**
 * The title a legacy lead gets when the wording goes. Since 11 November 2026
 * a lead carries no wording at all (its title is source and day, the
 * Chefredaktion reads the material live through `buschtelefon_fund`); a lead
 * written before still holds the post in `quelltext` and its first line in
 * `titel`, and that is what is neutralised.
 */
export const LEAD_OHNE_WORTLAUT =
  'Beitrag aus dem Buschtelefon — Original nicht mehr auffindbar'

/**
 * What a removal (decision 9) does beyond the find's own row, idempotent so
 * a later run can finish what a failure left half done: an UNPUBLISHED
 * article of the find is discarded with the reason; a lead that still
 * carries wording (`quelltext` — only leads from before the lead stopped
 * copying material) is neutralised. A PUBLISHED article is left exactly as
 * it is — the newsroom's decision: a removal counts only while the article
 * is unpublished. Every write has its own try/catch; a failure is named and
 * the others go on.
 */
export async function raeumeEntferntenFund(
  dienste: Pick<AbholDienste, 'meldungen' | 'hinweise'>,
  fundId: string,
  grund: string | null | undefined,
  name: string,
  fehler: string[]
): Promise<number> {
  let erledigt = 0
  const artikel = (await dienste.meldungen.readByQuery({
    filter: {
      buschtelefon_fund: { _eq: fundId },
      status: { _nin: ['publiziert', 'verworfen'] }
    },
    fields: ['id'],
    limit: -1
  })) as Array<{ id: string }>
  for (const a of artikel) {
    try {
      await dienste.meldungen.updateOne(a.id, {
        status: 'verworfen',
        fehler: `Der Beitrag ist an der Quelle nicht mehr auffindbar${grundText(grund)} — die unpublizierte Meldung wurde verworfen.`
      })
      erledigt += 1
    } catch (f) {
      fehler.push(`${name}: Meldung ${a.id} nicht verworfen: ${fehlerText(f)}`)
    }
  }
  erledigt += await neutralisiereLeads(dienste, [fundId], name, fehler)
  return erledigt
}

/** Empties `quelltext` and the wording title of the legacy leads of these finds. */
async function neutralisiereLeads(
  dienste: Pick<AbholDienste, 'hinweise'>,
  fundIds: readonly string[],
  name: string,
  fehler: string[]
): Promise<number> {
  if (fundIds.length === 0) return 0
  const leads = (await dienste.hinweise.readByQuery({
    filter: {
      buschtelefon_fund: { _in: [...fundIds] },
      quelltext: { _nnull: true }
    },
    fields: ['id'],
    limit: -1
  })) as Array<{ id: string }>
  let erledigt = 0
  for (const lead of leads) {
    try {
      await dienste.hinweise.updateOne(lead.id, {
        quelltext: null,
        titel: LEAD_OHNE_WORTLAUT
      })
      erledigt += 1
    } catch (f) {
      fehler.push(
        `${name}: Recherche-Hinweis ${lead.id} nicht geleert: ${fehlerText(f)}`
      )
    }
  }
  return erledigt
}

/**
 * The tombstone (decision 9): the material goes at once and the row says
 * why; then the dependents (`raeumeEntferntenFund`). The row is written
 * FIRST and the dependents can fail — the bookmark passes the tombstone
 * either way, so `vollendeEntfernungen` finishes them on every later run.
 */
async function entferne(
  dienste: AbholDienste,
  bestehend: Bestand,
  fund: EntfernterFund,
  jetzt: string,
  ergebnis: AbholErgebnis
): Promise<void> {
  await dienste.funde.updateOne(bestehend.id, {
    ...leereMaterial(jetzt),
    ...SICHTUNG_ZURUECK,
    status: 'entfernt',
    // A final reason (deletion request, deregistered source) is never
    // softened by a later tombstone.
    entfernt_grund: endgueltigerGrund(bestehend.entfernt_grund)
      ? bestehend.entfernt_grund
      : fund.entfernt_grund,
    folge: fund.folge,
    geaendert_am: fund.geaendert_am,
    aenderung: fund.aenderung,
    hinweise: [`${HINWEIS_NICHT_AUFFINDBAR}${grundText(fund.entfernt_grund)}`],
    // An undecided find is over; a decided one keeps its decision as memory.
    // A find nobody ever decided is lapsed with the SAME instant as the
    // emptying — what `wiederbelebbar` reads as «ended by the tombstone,
    // never decided». One the Chefredaktion handed back (open, but with its
    // hand-back stamp) keeps that stamp: persons decided on it, and it must
    // not come back by itself.
    ...(bestehend.entscheid === 'offen'
      ? {
          entscheid: 'verfallen',
          entschieden_am: bestehend.entschieden_am ?? jetzt
        }
      : {})
  })
  await raeumeEntferntenFund(
    dienste,
    bestehend.id,
    fund.entfernt_grund,
    `Fund ${fund.kennung}`,
    ergebnis.fehler
  )
}

/**
 * Finishes what a removal or retention left undone, without waiting for a
 * re-delivery that never comes (the bookmark passed the tombstone): every
 * unfinished article of a removed find is discarded, and every legacy lead
 * that still carries wording of a find whose material is gone is
 * neutralised. Both queries start from the small side — articles in work
 * and leads with `quelltext` — so the cost does not grow with the rows that
 * are never deleted.
 */
export async function vollendeEntfernungen(
  dienste: Pick<AbholDienste, 'funde' | 'meldungen' | 'hinweise'>
): Promise<{ erledigt: number; fehler: string[] }> {
  const fehler: string[] = []
  let erledigt = 0

  const inArbeit = (await dienste.meldungen.readByQuery({
    filter: {
      buschtelefon_fund: { _nnull: true },
      status: { _nin: ['publiziert', 'verworfen'] }
    },
    fields: ['buschtelefon_fund'],
    limit: -1
  })) as Array<{ buschtelefon_fund: string | null }>
  const legacy = (await dienste.hinweise.readByQuery({
    filter: {
      buschtelefon_fund: { _nnull: true },
      quelltext: { _nnull: true }
    },
    fields: ['buschtelefon_fund'],
    limit: -1
  })) as Array<{ buschtelefon_fund: string | null }>
  const ids = [
    ...new Set(
      [...inArbeit, ...legacy]
        .map((z) => z.buschtelefon_fund)
        .filter((id): id is string => id !== null)
    )
  ]
  if (ids.length === 0) return { erledigt, fehler }

  const funde = (await dienste.funde.readByQuery({
    filter: { id: { _in: ids } },
    fields: ['id', 'status', 'entfernt_grund', 'material_geloescht_am'],
    limit: -1
  })) as Array<{
    id: string
    status: string
    entfernt_grund: string | null
    material_geloescht_am: string | null
  }>
  const mitArtikel = new Set(inArbeit.map((z) => z.buschtelefon_fund))
  const mitLead = new Set(legacy.map((z) => z.buschtelefon_fund))
  const geleert: string[] = []
  for (const fund of funde) {
    try {
      if (fund.status === 'entfernt' && mitArtikel.has(fund.id))
        erledigt += await raeumeEntferntenFund(
          dienste,
          fund.id,
          fund.entfernt_grund,
          'Entfernter Fund',
          fehler
        )
      else if (fund.material_geloescht_am !== null && mitLead.has(fund.id))
        geleert.push(fund.id)
    } catch (f) {
      fehler.push(`Entfernter Fund: ${fehlerText(f)}`)
    }
  }
  erledigt += await neutralisiereLeads(
    dienste,
    geleert,
    'Geleerter Fund',
    fehler
  )
  return { erledigt, fehler }
}

export interface Auslassung {
  folge: number
  quelle: string | null
  ausgelassen: boolean
}

interface Laufzustand {
  dienste: AbholDienste
  gemeinden: readonly BespielteGemeinde[]
  quellen: QuellenStand
  jetzt: string
  ergebnis: AbholErgebnis
  /**
   * Every kennung this read delivered — finds, tombstones, omitted and
   * refused entries alike: what a full read compares the open rows with.
   */
  gesehen: Set<string>
  /** Refused entries whose kennung could not be read — any open row might be one of them. */
  unbenannt: number
  /** Per kennung its latest state in this run: omitted or delivered. */
  auslassungen: Map<string, Auslassung>
  /** Omitted entries without a kennung, per source, by their `folge` — they cannot be matched to anything. */
  ohneKennung: Map<string | null, number[]>
  /** Rows this run brought back after a tombstone the door withdrew. */
  wiederbelebt: number
}

/**
 * Notes an entry's latest state by its kennung. The pages come in ascending
 * `folge`, and the higher `folge` is the door's newer word: a find omitted
 * on page 1 and delivered on page 2 is no longer omitted.
 */
function merkeAuslassung(
  z: Laufzustand,
  kennung: string,
  folge: number,
  quelle: string | null,
  ausgelassen: boolean
): void {
  const bisher = z.auslassungen.get(kennung)
  if (bisher !== undefined && bisher.folge > folge) return
  z.auslassungen.set(kennung, { folge, quelle, ausgelassen })
}

/**
 * The comment removals of a delivery (4.7), applied to a row whose material
 * is otherwise left as it is. Returns the payload part, or null when no
 * stored comment lost its words.
 */
function kommentarEntfernung(
  bestehend: Bestand,
  fund: Fund
): { kommentare: unknown; hinweise: string[] } | null {
  const { kommentare, entfernt } = entferneKommentare(
    bestehend.kommentare,
    fund.kommentare
  )
  if (entfernt === 0) return null
  return {
    kommentare,
    hinweise: [
      ...new Set([...(bestehend.hinweise ?? []), HINWEIS_KOMMENTARE_ENTFERNT])
    ]
  }
}

/** A graded open row keeps its grade when only the status moved — no new Sichtung for a login wall. */
function gesichtetMit(bestehend: Bestand, fund: Fund): Record<string, unknown> {
  return bestehend.entscheid === 'offen' &&
    alsZahl(bestehend.gesichtet_folge) !== null
    ? { gesichtet_folge: fund.folge }
    : {}
}

async function verarbeiteFund(
  z: Laufzustand,
  fund: Fund | EntfernterFund,
  bestehend: Bestand | null
): Promise<void> {
  const { dienste, ergebnis } = z
  const was = abgleich(bestehend, fund)

  if (was === 'unveraendert') {
    ergebnis.unveraendert += 1
    return
  }
  if (was === 'unbekannt' || was === 'material_geloescht') {
    ergebnis.ignoriert += 1
    return
  }
  if (istEntfernt(fund)) {
    if (bestehend !== null) {
      await entferne(dienste, bestehend, fund, z.jetzt, ergebnis)
      ergebnis.entfernt += 1
    }
    return
  }

  if (was === 'entschieden' && bestehend !== null) {
    // The decision stays as it was — but not the words of a comment removed
    // at the source (decision D6 of 11 November 2026), and not the status
    // of an original that can be opened again.
    const entfernung = kommentarEntfernung(bestehend, fund)
    const wieder =
      bestehend.status === 'nicht_erreichbar' && fund.status === 'aktiv'
    if (entfernung !== null || wieder) {
      const hinweise = (
        entfernung?.hinweise ??
        bestehend.hinweise ??
        []
      ).filter((h) => !wieder || h !== HINWEIS_NICHT_ERREICHBAR)
      await dienste.funde.updateOne(bestehend.id, {
        ...(entfernung === null ? {} : { kommentare: entfernung.kommentare }),
        ...(wieder ? { status: 'aktiv' } : {}),
        hinweise: hinweise.length === 0 ? null : hinweise,
        folge: fund.folge
      })
    }
    ergebnis.entschieden += 1
    return
  }

  if (
    (was === 'nicht_erreichbar' || was === 'wieder_erreichbar') &&
    bestehend !== null
  ) {
    // Only the status moved: nothing is replaced and nothing deleted, the
    // row says so (contract 4.9). An undecided row keeps its grade and its
    // draft — a login wall is no reason to throw a proposal off the desk.
    const entfernung = kommentarEntfernung(bestehend, fund)
    const basis = entfernung?.hinweise ?? bestehend.hinweise ?? []
    const hinweise =
      was === 'nicht_erreichbar'
        ? [...new Set([...basis, HINWEIS_NICHT_ERREICHBAR])]
        : basis.filter((h) => h !== HINWEIS_NICHT_ERREICHBAR)
    await dienste.funde.updateOne(bestehend.id, {
      status: fund.status,
      folge: fund.folge,
      hinweise: hinweise.length === 0 ? null : hinweise,
      ...(entfernung === null ? {} : { kommentare: entfernung.kommentare }),
      ...gesichtetMit(bestehend, fund)
    })
    if (bestehend.entscheid === 'offen') ergebnis.unveraendert += 1
    else ergebnis.entschieden += 1
    return
  }

  const quellenUrl = z.quellen.urls.get(fund.quelle) ?? null
  if (was === 'neu' || bestehend === null) {
    const gemeinde = gemeindeFuer(fund, z.gemeinden)
    await dienste.funde.createOne({
      ...fundFelder(fund, quellenUrl, gemeinde?.id ?? null),
      entscheid: 'offen',
      neue_kommentare: 0
    })
    ergebnis.neu += 1
    if (gemeinde === null) ergebnis.ohneGemeinde += 1
    return
  }

  // An undecided row is REPLACED: the door delivers the whole find, and the
  // grade, the reservations and an untouched draft all belonged to the old one.
  // A municipality set by hand stays. A row a withdrawn tombstone had ended
  // (`wiederbeleben`) is the same find again: open, with its material back.
  const gemeindeId =
    bestehend.gemeinde ?? gemeindeFuer(fund, z.gemeinden)?.id ?? null
  const felder = fundFelder(fund, quellenUrl, gemeindeId)
  const { behalten } = await verwirfUnberuehrtenEntwurf(
    dienste.meldungen,
    bestehend.id,
    ENTWURF_VERALTET
  )
  const nachgefuehrt = await fuehreQuelleNach(
    dienste.meldungen,
    behalten,
    felder as unknown as QuellenFelder
  )
  const wiederbelebt = was === 'wiederbeleben'
  const hinweise = [
    ...((felder['hinweise'] as string[] | null) ?? []),
    ...(wiederbelebt ? [HINWEIS_WIEDER_DA] : []),
    ...(behalten.length > 0 ? [HINWEIS_ENTWURF_AELTER] : []),
    ...(nachgefuehrt > 0 ? [HINWEIS_QUELLE_NEU] : [])
  ]
  await dienste.funde.updateOne(bestehend.id, {
    ...felder,
    ...SICHTUNG_ZURUECK,
    hinweise: hinweise.length === 0 ? null : hinweise,
    aktualisiert_am: z.jetzt,
    neue_kommentare: wiederbelebt
      ? 0
      : neueKommentare(bestehend.kommentare, fund.kommentare),
    ...(wiederbelebt
      ? {
          entscheid: 'offen',
          entschieden_am: null,
          material_geloescht_am: null,
          entfernt_grund: null
        }
      : {})
  })
  ergebnis.ersetzt += 1
  if (wiederbelebt) z.wiederbelebt += 1
}

/** Stores one page. Never throws for a single find — it names it and goes on. */
async function verarbeiteSeite(
  z: Laufzustand,
  seite: FundeAntwort
): Promise<void> {
  const { dienste, ergebnis } = z
  ergebnis.gelesen +=
    seite.funde.length + seite.ausgelassen.length + seite.ungueltig.length
  for (const u of seite.ungueltig) {
    ergebnis.ungueltig.push(
      `${u.kennung ?? 'ohne Kennung'}${u.folge === null ? '' : ` (Folge ${u.folge})`}: ${u.grund}`
    )
    // Refused is still SEEN: the door holds it, only this side could not
    // read it. One without a readable kennung could be any open row.
    if (u.kennung === null) z.unbenannt += 1
    else z.gesehen.add(u.kennung)
  }
  for (const a of seite.ausgelassen) {
    if (a.kennung === null) {
      z.ohneKennung.set(a.quelle, [
        ...(z.ohneKennung.get(a.quelle) ?? []),
        a.folge
      ])
      continue
    }
    z.gesehen.add(a.kennung)
    merkeAuslassung(z, a.kennung, a.folge, a.quelle, true)
  }

  const kennungen = seite.funde.map((f) => f.kennung)
  for (const f of seite.funde) {
    z.gesehen.add(f.kennung)
    merkeAuslassung(z, f.kennung, f.folge, f.quelle, false)
  }
  const bestand = new Map<string, Bestand>()
  if (kennungen.length > 0) {
    const zeilen = (await dienste.funde.readByQuery({
      filter: { kennung: { _in: kennungen } },
      fields: BESTAND_FELDER,
      limit: -1
    })) as Bestand[]
    for (const zeile of zeilen) bestand.set(zeile.kennung, zeile)
  }

  for (const fund of seite.funde) {
    try {
      await verarbeiteFund(z, fund, bestand.get(fund.kennung) ?? null)
    } catch (fehler) {
      // A storage failure carries no model text: the log gets it whole.
      dienste.logger.warn(
        fehler,
        `buschtelefon: Fund ${fund.kennung} nicht gespeichert.`
      )
      ergebnis.fehler.push(
        `Fund ${fund.kennung} (Folge ${fund.folge}) nicht gespeichert und übersprungen: ${fehlerText(fehler)}`
      )
    }
  }
}

/**
 * How many finds THIS run's delivery omitted, over all sources — DISTINCT
 * kennungen whose latest state in the run is «omitted», plus the entries
 * without one. The run's result; the desk's per-source number is
 * `fuehreAusgelasseneNach`.
 */
export function ausgelasseneImLauf(
  auslassungen: ReadonlyMap<string, Auslassung>,
  ohneKennung: ReadonlyMap<string | null, readonly number[]>
): number {
  let zahl = 0
  for (const a of auslassungen.values()) if (a.ausgelassen) zahl += 1
  for (const folgen of ohneKennung.values()) zahl += new Set(folgen).size
  return zahl
}

/** One find the door currently omits from a source. `seit` = when it was last named as omitted. */
export interface AusgelassenEintrag {
  kennung: string | null
  folge: number
  seit: string
}

/**
 * How long an omission is carried without the door naming it again: the
 * door holds a find 30 days after its last change (contract 3.4), and an
 * omitted find is re-delivered only when it changes — one never named
 * again after that has left the door's window.
 */
export const AUSGELASSEN_HALTEN_TAGE = 30

/** The stored list, read defensively — a malformed entry is dropped, never a reason to fail the run. */
export function liesAusgelassene(roh: unknown): AusgelassenEintrag[] {
  if (!Array.isArray(roh)) return []
  const aus: AusgelassenEintrag[] = []
  for (const e of roh) {
    if (typeof e !== 'object' || e === null) continue
    const { kennung, folge, seit } = e as Record<string, unknown>
    const f = alsZahl(folge as number | string | null)
    if (f === null || typeof seit !== 'string') continue
    if (kennung !== null && typeof kennung !== 'string') continue
    aus.push({ kennung, folge: f, seit })
  }
  return aus
}

/**
 * What a source's door currently omits, carried across deliveries — the
 * door re-delivers an omitted find only when it changes, so one delivery
 * cannot say it; the list has to be kept.
 *
 * - A named entry leaves the list the moment its kennung arrives in any
 *   form (a find, a tombstone, omitted again under another source) and
 *   comes back if this run's LATEST word on it is «omitted» for THIS source.
 * - An entry without a kennung cannot be matched to what it later becomes;
 *   it stays (deduplicated by `folge`) until it ages out.
 * - Everything ages out after `AUSGELASSEN_HALTEN_TAGE` without being named.
 * - A full read (`stand_zu_alt`) saw everything the door holds: the list is
 *   exactly what that read omitted.
 */
export function fuehreAusgelasseneNach(
  bisher: readonly AusgelassenEintrag[],
  quelle: string,
  auslassungen: ReadonlyMap<string, Auslassung>,
  ohneKennung: ReadonlyMap<string | null, readonly number[]>,
  vollstaendig: boolean,
  jetzt: string
): AusgelassenEintrag[] {
  const grenze = Date.parse(jetzt) - AUSGELASSEN_HALTEN_TAGE * 86_400_000
  const bleibt = vollstaendig
    ? []
    : bisher.filter(
        (e) =>
          Date.parse(e.seit) >= grenze &&
          (e.kennung === null || !auslassungen.has(e.kennung))
      )
  const neu: AusgelassenEintrag[] = [...bleibt]
  for (const [kennung, a] of auslassungen)
    if (a.ausgelassen && a.quelle === quelle)
      neu.push({ kennung, folge: a.folge, seit: jetzt })
  const namenlos = new Set(
    neu.filter((e) => e.kennung === null).map((e) => e.folge)
  )
  for (const folge of ohneKennung.get(quelle) ?? []) {
    if (namenlos.has(folge)) continue
    namenlos.add(folge)
    neu.push({ kennung: null, folge, seit: jetzt })
  }
  return neu.sort((a, b) => a.folge - b.folge)
}

// ---------------------------------------------------------------------------
// 5. Retention
// ---------------------------------------------------------------------------

type AufraeumBestand = AufraeumZeile & { id: string }

const FERTIG = new Set(['publiziert', 'verworfen'])

/** The article state retention asks about: one still in work beats a finished one. */
export function meldungStand(
  meldungen: ReadonlyArray<{
    status: string
    publiziert_am: string | null
    date_updated: string | null
    date_created: string | null
  }>
): { status: string | null; abgeschlossenAm: string | null } {
  const inArbeit = meldungen.find((m) => !FERTIG.has(m.status))
  if (inArbeit !== undefined)
    return { status: inArbeit.status, abgeschlossenAm: null }
  const publiziert = meldungen
    .filter((m) => m.status === 'publiziert')
    .map((m) => m.publiziert_am ?? m.date_updated ?? m.date_created)
    .filter((t): t is string => t !== null)
    .sort()
  if (publiziert.length > 0 || meldungen.some((m) => m.status === 'publiziert'))
    return {
      status: 'publiziert',
      abgeschlossenAm: publiziert[publiziert.length - 1] ?? null
    }
  const verworfen = meldungen
    .map((m) => m.date_updated ?? m.date_created)
    .filter((t): t is string => t !== null)
    .sort()
  return meldungen.length === 0
    ? { status: null, abgeschlossenAm: null }
    : {
        status: 'verworfen',
        abgeschlossenAm: verworfen[verworfen.length - 1] ?? null
      }
}

/**
 * Empties what retention says is due (decision 8). No row is ever deleted:
 * its `kennung` is what keeps an old post from coming in again as new.
 */
export async function raeumeAuf(
  dienste: Pick<AbholDienste, 'funde' | 'meldungen' | 'hinweise' | 'logger'>,
  heute: string,
  jetzt: string
): Promise<{ verfallen: number; geleert: number; fehler: string[] }> {
  const zeilen = (await dienste.funde.readByQuery({
    filter: { material_geloescht_am: { _null: true } },
    fields: [
      'id',
      'entscheid',
      'erstmals_freigegeben_am',
      'entschieden_am',
      'material_geloescht_am',
      'kommentare',
      'bilder',
      'geteilt'
    ],
    limit: -1
  })) as AufraeumBestand[]
  const ergebnis = { verfallen: 0, geleert: 0, fehler: [] as string[] }
  if (zeilen.length === 0) return ergebnis

  const uebernommen = zeilen
    .filter((z) => z.entscheid === 'uebernommen')
    .map((z) => z.id)
  const artikel =
    uebernommen.length === 0
      ? []
      : ((await dienste.meldungen.readByQuery({
          filter: { buschtelefon_fund: { _in: uebernommen } },
          fields: [
            'buschtelefon_fund',
            'status',
            'publiziert_am',
            'date_updated',
            'date_created'
          ],
          limit: -1
        })) as Array<{
          buschtelefon_fund: string | null
          status: string
          publiziert_am: string | null
          date_updated: string | null
          date_created: string | null
        }>)
  const weitergereicht = zeilen
    .filter((z) => z.entscheid === 'weitergereicht')
    .map((z) => z.id)
  const leads =
    weitergereicht.length === 0
      ? []
      : ((await dienste.hinweise.readByQuery({
          filter: { buschtelefon_fund: { _in: weitergereicht } },
          fields: ['buschtelefon_fund', 'status'],
          limit: -1
        })) as Array<{ buschtelefon_fund: string | null; status: string }>)

  for (const zeile of zeilen) {
    try {
      const stand = meldungStand(
        artikel.filter((a) => a.buschtelefon_fund === zeile.id)
      )
      const eigene = leads.filter((l) => l.buschtelefon_fund === zeile.id)
      const hinweisStatus = eigene.some((l) => l.status === 'offen')
        ? 'offen'
        : (eigene[0]?.status ?? null)
      const aktion = aufraeumAktion(
        zeile,
        stand.status,
        hinweisStatus,
        heute,
        stand.abgeschlossenAm
      )
      if (aktion === null) continue
      if (aktion === 'verfallen') {
        await verwirfUnberuehrtenEntwurf(
          dienste.meldungen,
          zeile.id,
          'Der Fund ist nach 14 Tagen ohne Entscheid verfallen — der Entwurf wurde verworfen.'
        )
        await dienste.funde.updateOne(zeile.id, {
          ...leereMaterial(jetzt),
          entwurf_bedenken: null,
          entscheid: 'verfallen',
          entschieden_am: jetzt
        })
        ergebnis.verfallen += 1
      } else if (aktion === 'kommentare_leeren') {
        await dienste.funde.updateOne(zeile.id, leereKommentare(zeile))
        ergebnis.geleert += 1
      } else {
        await dienste.funde.updateOne(zeile.id, {
          ...leereMaterial(jetzt),
          entwurf_bedenken: null
        })
        ergebnis.geleert += 1
      }
    } catch (fehler) {
      dienste.logger.warn(
        fehler,
        `buschtelefon: Aufraeumen von ${zeile.id} fehlgeschlagen.`
      )
      ergebnis.fehler.push(`Aufräumen eines Funds: ${fehlerText(fehler)}`)
    }
  }
  return ergebnis
}

// ---------------------------------------------------------------------------
// 6. Sichtung
// ---------------------------------------------------------------------------

type SichtungsBestand = SichtungsZeile &
  Pick<
    BuschtelefonFund,
    | 'folge'
    | 'gesichtet_folge'
    | 'vorschlag'
    | 'vorschlag_wert'
    | 'material_geloescht_am'
  > & { gemeinde: { id: string; name: string } | null }

const SICHTUNG_FELDER = [
  'id',
  'kanal',
  'quelle_art',
  'quelle_name',
  'quelle_sichtbarkeit',
  'veroeffentlicht_tag',
  'datum_genauigkeit',
  'autor_art',
  'autor_rolle',
  'autor_name',
  'text',
  'text_abgeschnitten',
  'bilder',
  'verlinkt',
  'geteilt',
  'kommentare',
  'kommentare_stand',
  'n_kommentare',
  'doublette_von',
  'status',
  'folge',
  'gesichtet_folge',
  'vorschlag',
  'vorschlag_wert',
  'material_geloescht_am',
  'gemeinde.id',
  'gemeinde.name'
]

/** A row is (re-)sighted when it was never graded or its `folge` moved past the graded one. */
export function brauchtSichtung(
  zeile: Pick<
    SichtungsBestand,
    | 'folge'
    | 'gesichtet_folge'
    | 'material_geloescht_am'
    | 'text'
    | 'bilder'
    | 'verlinkt'
    | 'geteilt'
    | 'kommentare'
  >
): boolean {
  if (!hatMaterial(zeile)) return false
  const gesichtet = alsZahl(zeile.gesichtet_folge)
  const folge = alsZahl(zeile.folge)
  return gesichtet === null || (folge !== null && gesichtet < folge)
}

/**
 * Grades the open finds, per municipality (those without one are a group of
 * their own), in packets. Sorts and never filters: a failed packet leaves
 * its rows ungraded — «not judged», which the desk shows as such — and the
 * run names it.
 */
export async function sichte(
  dienste: Pick<
    AbholDienste,
    | 'funde'
    | 'schwelle'
    | 'regelzeilen'
    | 'sichtungsregeln'
    | 'ladeSignale'
    | 'reicheAutomatischWeiter'
    | 'logger'
    | 'send'
  >,
  heute: string,
  model: string | null = null
): Promise<{
  gesichtet: number
  vorschlaege: number
  weitergereicht: number
  fehler: string[]
}> {
  const ergebnis = {
    gesichtet: 0,
    vorschlaege: 0,
    weitergereicht: 0,
    fehler: [] as string[]
  }
  // `nicht_erreichbar` is graded too: the door delivered its last known
  // state whole (4.9), and a find first seen behind a login wall would
  // otherwise never be judged. Only a removed find is not.
  const offene = (await dienste.funde.readByQuery({
    filter: {
      entscheid: { _eq: 'offen' },
      status: { _in: ['aktiv', 'nicht_erreichbar'] },
      material_geloescht_am: { _null: true }
    },
    fields: SICHTUNG_FELDER,
    sort: ['erstmals_freigegeben_am'],
    limit: -1
  })) as SichtungsBestand[]

  const gruppen = new Map<string, SichtungsBestand[]>()
  for (const zeile of offene.filter(brauchtSichtung)) {
    const schluessel = zeile.gemeinde?.id ?? ''
    const gruppe = gruppen.get(schluessel) ?? []
    gruppe.push(zeile)
    gruppen.set(schluessel, gruppe)
  }

  for (const [gemeindeId, zeilen] of gruppen) {
    const name = zeilen[0]?.gemeinde?.name ?? null
    let digest = ''
    if (gemeindeId !== '' && dienste.ladeSignale !== undefined) {
      try {
        const signale = await dienste.ladeSignale(gemeindeId, heute)
        digest = lernDigest(signale.entscheide, LERN_FENSTER, signale.rahmen)
      } catch (fehler) {
        // The examples are a help, not a condition: the Sichtung goes on.
        dienste.logger.warn(
          fehler,
          `buschtelefon: Lernsignale fuer ${name ?? gemeindeId} nicht geladen.`
        )
      }
    }

    const alle = pakete(zeilen)
    const fehlerPakete: string[] = []
    const weiterzureichen = new Map<string, NummerierteRegel>()
    for (const paket of alle) {
      try {
        const antwort = await completeJson<unknown>(
          {
            zweck: 'buschtelefon:sichtung',
            system: cacheableSystem(BUSCHTELEFON_SICHTUNG_SYSTEM),
            prompt: buildBuschtelefonSichtungPrompt(
              name,
              paket,
              digest,
              dienste.sichtungsregeln.text
            ),
            ...SICHTUNG_AUFRUF,
            ...(model === null ? {} : { model }),
            schema: STUFEN_SCHEMA
          },
          dienste.send
        )
        for (const urteil of parseStufenSichtung(antwort, paket)) {
          const zeile = paket.find((z) => z.id === urteil.id)
          const vorschlag = istVorschlag(urteil.stufe, dienste.schwelle)
          await dienste.funde.updateOne(urteil.id, {
            vorschlag_wert: urteil.stufe,
            vorschlag,
            vorschlag_begruendung: urteil.begruendung,
            gesichtet_folge: alsZahl(zeile?.folge ?? null)
          })
          ergebnis.gesichtet += 1
          if (vorschlag) ergebnis.vorschlaege += 1
          const regel = automatischeWeitergabe(
            urteil,
            dienste.sichtungsregeln.nummern,
            dienste.regelzeilen
          )
          if (regel !== null) weiterzureichen.set(urteil.id, regel)
        }
      } catch (fehler) {
        // A `ClaudeFormatError` carries the model's raw answer — a grading
        // of private persons' posts. Class and code to the log, a neutral
        // sentence to the result.
        dienste.logger.warn(
          fehlerKennung(fehler),
          `buschtelefon: Sichtung fuer ${name ?? 'Funde ohne Gemeinde'} fehlgeschlagen.`
        )
        fehlerPakete.push(fehlerText(fehler))
      }
    }
    const grund = sichtungsFehlerText(fehlerPakete, alle.length)
    if (grund !== null)
      ergebnis.fehler.push(
        `${name ?? 'Funde ohne Gemeinde'}: Sichtung fehlgeschlagen: ${grund}`
      )

    if (dienste.reicheAutomatischWeiter !== undefined) {
      for (const [fundId, regel] of weiterzureichen) {
        try {
          await dienste.reicheAutomatischWeiter(fundId, regel)
          ergebnis.weitergereicht += 1
        } catch (fehler) {
          dienste.logger.warn(
            fehlerKennung(fehler),
            `buschtelefon: Automatisches Weiterreichen von ${fundId} fehlgeschlagen.`
          )
        }
      }
    }
  }
  return ergebnis
}

/**
 * Re-applies the desk's threshold to every graded open row — the grade is
 * the model's, the appetite the newsroom's, and a dial moved yesterday must
 * show today without a model call. Returns how many rows moved.
 */
export async function gleicheSchwelleAb(
  funde: ZeilenDienst,
  schwelle: number
): Promise<number> {
  const zeilen = (await funde.readByQuery({
    filter: {
      entscheid: { _eq: 'offen' },
      vorschlag_wert: { _nnull: true }
    },
    fields: ['id', 'vorschlag', 'vorschlag_wert'],
    limit: -1
  })) as Array<{
    id: string
    vorschlag: boolean | null
    vorschlag_wert: number | null
  }>
  let bewegt = 0
  for (const zeile of zeilen) {
    const soll = istVorschlag(zeile.vorschlag_wert, schwelle)
    if (zeile.vorschlag === soll) continue
    await funde.updateOne(zeile.id, { vorschlag: soll })
    bewegt += 1
  }
  return bewegt
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** What the desk reads when the door has not released today — the next free retry may bring it. */
export function freigabeHinweis(
  freigabe: Pick<Freigabe, 'tag'>,
  heute: string
): string | null {
  return freigabe.tag === heute
    ? null
    : `Heute noch keine Freigabe des Buschtelefons (letzte: ${datumDeutsch(freigabe.tag)}).`
}

async function hole(
  z: Laufzustand,
  zugang: Tuerzugang,
  nach: number | null,
  limit: number | undefined,
  merke: (seite: FundeAntwort) => Promise<void>
): Promise<Awaited<ReturnType<typeof holeFunde>>> {
  return holeFunde(
    zugang,
    { nach, ...(limit === undefined ? {} : { limit }) },
    z.dienste.fetchImpl,
    {
      jeSeite: async (seite) => {
        await verarbeiteSeite(z, seite)
        await merke(seite)
      }
    }
  )
}

/**
 * Retention and the unfinished removals — the part of a run that needs no
 * door and no model. Never throws; a failure is a sentence in `fehler`.
 */
async function pflegeBestand(
  dienste: AbholDienste,
  ergebnis: AbholErgebnis,
  heute: string,
  jetzt: string
): Promise<void> {
  try {
    const aufgeraeumt = await raeumeAuf(dienste, heute, jetzt)
    ergebnis.aufgeraeumt.verfallen += aufgeraeumt.verfallen
    ergebnis.aufgeraeumt.geleert += aufgeraeumt.geleert
    ergebnis.fehler.push(...aufgeraeumt.fehler)
  } catch (fehler) {
    dienste.logger.warn(fehler, 'buschtelefon: Aufraeumen fehlgeschlagen.')
    ergebnis.fehler.push(`Aufräumen: ${fehlerText(fehler)}`)
  }
  try {
    const vollendet = await vollendeEntfernungen(dienste)
    ergebnis.fehler.push(...vollendet.fehler)
  } catch (fehler) {
    dienste.logger.warn(
      fehler,
      'buschtelefon: Entfernungen nicht nachgefuehrt.'
    )
    ergebnis.fehler.push(`Entfernungen nachführen: ${fehlerText(fehler)}`)
  }
}

function standFehler(ergebnis: AbholErgebnis): string | null {
  return ergebnis.fehler.length === 0
    ? null
    : ergebnis.fehler.join(' · ').slice(0, 4000)
}

/**
 * The daily fetch. Never throws for what the door, a single row or the model
 * did — every such failure is a sentence in `fehler`; only a broken service
 * of this side (the bookmark row unreadable) propagates.
 *
 * Not guarded against a second run: the Flow and the button go through
 * `holeAbEinzeln`.
 */
export async function holeAb(
  dienste: AbholDienste,
  optionen: AbholOptionenLauf = {}
): Promise<AbholErgebnis> {
  const ergebnis = leeresErgebnis()
  const jetztDate = (dienste.jetzt ?? (() => new Date()))()
  const jetzt = jetztDate.toISOString()
  const heute = tagInZuerich(jetztDate) ?? jetzt.slice(0, 10)

  // ---- 1. Access ---------------------------------------------------------
  const zugang = liesZugang(dienste.env)
  if (!zugang.ok) {
    ergebnis.status = 'nicht_eingerichtet'
    ergebnis.fehlend = zugang.fehlend
    ergebnis.hinweise.push(
      `Das Buschtelefon ist nicht eingerichtet — es fehlt: ${zugang.fehlend.join(', ')}.`
    )
    // The door is off, the duty to forget is not: what is stored still ages
    // out on schedule (decision 8). No Sichtung, no drafts — a switched-off
    // feed buys no model calls. The bookmark row is written WITHOUT `folge`,
    // `freigabe` and `letzter_abruf`: nothing was fetched, and the bookmark
    // must survive until the door is back.
    await pflegeBestand(dienste, ergebnis, heute, jetzt)
    await dienste.stand.schreibe({
      letzter_fehler: standFehler(ergebnis),
      // The desk already says «nicht eingerichtet» from `fehlend`; repeating
      // the sentence as the release hint showed it twice.
      letzter_hinweis: null,
      ergebnis
    })
    return ergebnis
  }

  const stand = await dienste.stand.lies()
  let lesezeichen = alsZahl(stand?.folge ?? null)
  ergebnis.folge = lesezeichen
  let hinweis: string | null = null
  let freigabe: Freigabe | null = null

  const gemeinden = (await dienste.gemeinden.readByQuery({
    filter: { aktiv: { _eq: true } },
    fields: ['id', 'name', 'bfs_nummer'],
    limit: -1
  })) as BespielteGemeinde[]

  // ---- 2. Sources --------------------------------------------------------
  const quellen = await ladeQuellenStand(dienste.quellen)
  try {
    const antwort = await holeQuellen(zugang.zugang, dienste.fetchImpl)
    await schreibeQuellen(dienste.quellen, antwort.quellen, quellen, ergebnis)
    for (const u of antwort.ungueltig)
      ergebnis.fehler.push(
        `Quelle ${u.kennung ?? 'ohne Kennung'} nicht lesbar: ${u.grund}`
      )
  } catch (fehler) {
    dienste.logger.warn(fehler, 'buschtelefon: Quellen nicht gelesen.')
    ergebnis.fehler.push(`Quellenliste nicht gelesen: ${fehlerText(fehler)}`)
  }

  // ---- 3./4. Finds, page by page -----------------------------------------
  const z: Laufzustand = {
    dienste,
    gemeinden,
    quellen,
    jetzt,
    ergebnis,
    gesehen: new Set(),
    unbenannt: 0,
    auslassungen: new Map(),
    ohneKennung: new Map(),
    wiederbelebt: 0
  }
  const merke = async (seite: FundeAntwort): Promise<void> => {
    freigabe = seite.freigabe
    const hoechste = hoechsteFolge(seite)
    if (hoechste === null) return
    if (lesezeichen !== null && hoechste <= lesezeichen) return
    lesezeichen = hoechste
    ergebnis.folge = hoechste
    await dienste.stand.schreibe({ folge: hoechste })
  }
  let vollstaendig = false
  try {
    let abholung: Awaited<ReturnType<typeof holeFunde>>
    try {
      abholung = await hole(
        z,
        zugang.zugang,
        lesezeichen,
        optionen.limit,
        merke
      )
    } catch (fehler) {
      if (
        !(fehler instanceof BuschtelefonFehler) ||
        fehler.art !== 'stand_zu_alt'
      )
        throw fehler
      // The bookmark fell out of the door's window: ONE read from the
      // start, merged on `kennung` — what is unchanged costs nothing.
      ergebnis.hinweise.push(
        'Das Lesezeichen war älter als das Vorhaltefenster des Buschtelefons — alles wurde neu gelesen und zusammengeführt.'
      )
      lesezeichen = null
      abholung = await hole(z, zugang.zugang, null, optionen.limit, merke)
      vollstaendig = abholung.abbruch === null
    }
    freigabe = abholung.freigabe
    if (abholung.abbruch !== null)
      ergebnis.fehler.push(
        `Abholung nach ${abholung.seiten} Seiten abgebrochen: ${abholung.abbruch.message}`
      )
    hinweis = freigabeHinweis(abholung.freigabe, heute)
    for (const offen of abholung.freigabe.quellen_offen)
      ergebnis.hinweise.push(
        `Quelle ${offen.quelle} fehlt in der Freigabe (${offen.grund === 'lauf_nicht_fertig' ? 'Sammellauf nicht fertig' : offen.grund === 'fehler' ? 'Fehler beim Sammeln' : 'Grund unbekannt'}).`
      )
  } catch (fehler) {
    if (
      fehler instanceof BuschtelefonFehler &&
      (fehler.art === 'freigabe_laeuft' || fehler.art === 'nicht_bereit')
    ) {
      // Not a fault of anyone: the next free retry reads it.
      hinweis = fehler.message
    } else {
      dienste.logger.warn(fehler, 'buschtelefon: Abholung fehlgeschlagen.')
      ergebnis.status = 'fehlgeschlagen'
      ergebnis.fehler.push(`Abholung fehlgeschlagen: ${fehlerText(fehler)}`)
    }
  }
  if (hinweis !== null) ergebnis.hinweise.push(hinweis)
  if (z.wiederbelebt > 0)
    ergebnis.hinweise.push(
      `${z.wiederbelebt} ${z.wiederbelebt === 1 ? 'Fund kam' : 'Funde kamen'} nach einer Entfernung an der Quelle wieder und ${z.wiederbelebt === 1 ? 'liegt' : 'liegen'} wieder offen.`
    )

  // What the door currently omits, per source — carried across deliveries,
  // because an omitted find is re-delivered only when it changes.
  ergebnis.ausgelassen = ausgelasseneImLauf(z.auslassungen, z.ohneKennung)
  for (const [kennung, id] of quellen.ids) {
    const bisher = quellen.offen.get(kennung) ?? []
    const offen = fuehreAusgelasseneNach(
      bisher,
      kennung,
      z.auslassungen,
      z.ohneKennung,
      vollstaendig,
      jetzt
    )
    if (JSON.stringify(offen) === JSON.stringify(bisher)) continue
    try {
      await dienste.quellen.updateOne(id, {
        ausgelassen_offen: offen,
        n_ausgelassen: offen.length
      })
      quellen.offen.set(kennung, offen)
    } catch (fehler) {
      ergebnis.fehler.push(
        `Quelle ${kennung}: Zahl der Ausgelassenen nicht gespeichert: ${fehlerText(fehler)}`
      )
    }
  }

  // After a full read, an open find the door no longer holds is over
  // (contract 3.4) — lapsed and emptied, never deleted. «Holds» counts what
  // was omitted or refused too: the door still has it, only this side could
  // not take it today. And where a refused entry's kennung could not be read
  // at all, nothing lapses: it could be any open row, and retention ages
  // them out anyway.
  if (vollstaendig && z.unbenannt > 0)
    ergebnis.hinweise.push(
      `Der volle Abruf enthielt ${z.unbenannt} nicht lesbare ${z.unbenannt === 1 ? 'Eintrag' : 'Einträge'} ohne Kennung — offene Funde wurden darum nicht als verfallen markiert.`
    )
  else if (vollstaendig) {
    try {
      const offene = (await dienste.funde.readByQuery({
        filter: {
          entscheid: { _eq: 'offen' },
          material_geloescht_am: { _null: true }
        },
        fields: ['id', 'kennung'],
        limit: -1
      })) as Array<{ id: string; kennung: string }>
      for (const zeile of offene) {
        if (z.gesehen.has(zeile.kennung)) continue
        await verwirfUnberuehrtenEntwurf(
          dienste.meldungen,
          zeile.id,
          'Das Buschtelefon hält den Fund nicht mehr vor — der Entwurf wurde verworfen.'
        )
        await dienste.funde.updateOne(zeile.id, {
          ...leereMaterial(jetzt),
          entwurf_bedenken: null,
          entscheid: 'verfallen',
          entschieden_am: jetzt
        })
        ergebnis.aufgeraeumt.verfallen += 1
      }
    } catch (fehler) {
      ergebnis.fehler.push(
        `Abgleich nach dem vollen Abruf: ${fehlerText(fehler)}`
      )
    }
  }

  // ---- 5. Retention ------------------------------------------------------
  await pflegeBestand(dienste, ergebnis, heute, jetzt)

  // ---- 6. Sichtung -------------------------------------------------------
  try {
    const sichtung = await sichte(dienste, heute, optionen.model ?? null)
    ergebnis.gesichtet = sichtung.gesichtet
    ergebnis.fehler.push(...sichtung.fehler)
    if (sichtung.weitergereicht > 0)
      ergebnis.hinweise.push(
        `${sichtung.weitergereicht} ${sichtung.weitergereicht === 1 ? 'Fund' : 'Funde'} nach einer Regel der Redaktion an die Chefredaktion weitergereicht.`
      )
  } catch (fehler) {
    dienste.logger.warn(
      fehlerKennung(fehler),
      'buschtelefon: Sichtung fehlgeschlagen.'
    )
    ergebnis.fehler.push(`Sichtung: ${fehlerText(fehler)}`)
  }
  try {
    const bewegt = await gleicheSchwelleAb(dienste.funde, dienste.schwelle)
    if (bewegt > 0)
      ergebnis.hinweise.push(
        `Schwelle ${dienste.schwelle}: ${bewegt} ${bewegt === 1 ? 'Fund' : 'Funde'} neu eingeordnet.`
      )
  } catch (fehler) {
    ergebnis.fehler.push(`Schwelle: ${fehlerText(fehler)}`)
  }

  // ---- 7. Drafts ---------------------------------------------------------
  try {
    const vorschlaege = (await dienste.funde.readByQuery({
      filter: {
        vorschlag: { _eq: true },
        entscheid: { _eq: 'offen' },
        status: { _in: ['aktiv', 'nicht_erreichbar'] },
        material_geloescht_am: { _null: true }
      },
      fields: FUND_FELDER,
      sort: ['-vorschlag_wert', '-erstmals_freigegeben_am'],
      limit: -1
    })) as FundRohzeile[]
    ergebnis.vorschlaege = vorschlaege.length
    const geschrieben = await schreibeFundMeldungen(
      {
        funde: dienste.funde,
        meldungen: dienste.meldungen,
        regeln: dienste.textregeln,
        logger: dienste.logger,
        ...(dienste.send === undefined ? {} : { send: dienste.send })
      },
      vorschlaege,
      optionen.entwuerfe ?? BUSCHTELEFON_MELDUNGEN_JE_LAUF
    )
    ergebnis.entwuerfe = geschrieben.geschrieben
    ergebnis.wartend = geschrieben.wartend
    ergebnis.fehler.push(...geschrieben.fehler)
    if (geschrieben.ohneGemeinde > 0)
      ergebnis.hinweise.push(
        `${geschrieben.ohneGemeinde} ${geschrieben.ohneGemeinde === 1 ? 'Vorschlag' : 'Vorschläge'} ohne Gemeinde — kein Entwurf, bis eine zugeordnet ist.`
      )
    if (geschrieben.ohneMeldung > 0)
      ergebnis.hinweise.push(
        `${geschrieben.ohneMeldung} ${geschrieben.ohneMeldung === 1 ? 'Vorschlag' : 'Vorschläge'} ohne Entwurf: Das Material trug keine Meldung.`
      )
    if (geschrieben.wartend.length > 0)
      ergebnis.hinweise.push(
        `${geschrieben.wartend.length} ${geschrieben.wartend.length === 1 ? 'Entwurf wartet' : 'Entwürfe warten'} auf den nächsten Lauf (Deckel ${optionen.entwuerfe ?? BUSCHTELEFON_MELDUNGEN_JE_LAUF} je Lauf).`
      )
  } catch (fehler) {
    dienste.logger.warn(
      fehlerKennung(fehler),
      'buschtelefon: Entwuerfe fehlgeschlagen.'
    )
    ergebnis.fehler.push(`Entwürfe: ${fehlerText(fehler)}`)
  }

  // ---- 8. The bookmark row ----------------------------------------------
  await dienste.stand.schreibe({
    ...(lesezeichen === null ? {} : { folge: lesezeichen }),
    ...(freigabe === null ? {} : { freigabe }),
    letzter_abruf: jetzt,
    letzter_fehler: standFehler(ergebnis),
    letzter_hinweis: hinweis,
    ergebnis
  })
  dienste.logger.info(
    `buschtelefon: ${ergebnis.gelesen} gelesen, ${ergebnis.neu} neu, ${ergebnis.ersetzt} ersetzt, ${ergebnis.gesichtet} gesichtet, ${ergebnis.entwuerfe} Entwuerfe, ${ergebnis.fehler.length} Fehler.`
  )
  return ergebnis
}

// ---------------------------------------------------------------------------
// One run at a time
// ---------------------------------------------------------------------------

/**
 * Process-wide: the operation and the desk's endpoint are bundled into one
 * `dist/api.js`, so this module — and this flag — is shared by the Flow's
 * 12:00, 13:00 and 14:00 runs and the «Jetzt abholen» button.
 */
let laufend = false

/** Whether a run of this desk is under way in this process right now. */
export function abholungLaeuft(): boolean {
  return laufend
}

export const LAUF_LAEUFT_HINWEIS =
  'Ein Buschtelefon-Lauf ist bereits unterwegs — dieser Aufruf hat nichts getan.'

/** What a call answers that found another run under way: nothing asked, nothing written. */
export function laeuftSchonErgebnis(): AbholErgebnis {
  return {
    ...leeresErgebnis(),
    status: 'laeuft',
    hinweise: [LAUF_LAEUFT_HINWEIS]
  }
}

/**
 * `holeAb`, but never twice at once. Two runs on the same bookmark pay every
 * Sichtung packet and every draft twice, the second can discard the draft
 * the first just wrote, and a create of the same kennung fails for one of
 * them — so the second call returns at once with `status: 'laeuft'` and
 * asks neither the door nor the model.
 */
export async function holeAbEinzeln(
  dienste: AbholDienste,
  optionen: AbholOptionenLauf = {}
): Promise<AbholErgebnis> {
  if (laufend) return laeuftSchonErgebnis()
  laufend = true
  try {
    return await holeAb(dienste, optionen)
  } finally {
    laufend = false
  }
}
