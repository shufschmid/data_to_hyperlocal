// The Buschtelefon desk's routes: what the village's social-network groups
// post, fetched once a day from the Buschtelefon's door and decided here.
//
// The Kanton desk's shape — a single-flight run the workspace polls, three
// decisions that teach, a draft the run wrote — with six things of its own,
// each a decision of the newsroom (11 November 2026):
//
// - **The three decisions stay OPEN beside the run's draft.** The writer
//   never sets `entscheid`; these routes do. «Übernehmen» on a row that
//   already carries a draft sets the decision and writes no second article.
// - **Every decision stamps `entschieden_am`.** Retention counts from it
//   (`aufraeumAktion` in `redaktion/buschtelefon.ts`); a decided row without
//   the stamp would be treated as old and emptied by the next run.
// - **A rejection empties the comments and the image texts at once** — the
//   words of private persons that no lesson needs. The post's own text stays
//   thirty days as the example the next Sichtung learns from.
// - **A find may have no municipality.** It then shows on the desk, can be
//   rejected or handed up, and gets a Meldung only after «Gemeinde zuordnen».
// - **A lead carries no wording.** `recherchehinweise` keeps revisions, so
//   the lead names the find by source and day and is created by a
//   system-level service; the Chefredaktion reads the material live from
//   the find, where retention reaches it.
// - **Nothing a model or a provider said reaches the browser.** The house's
//   own answers (`createError`) go out as they are; everything else is
//   logged by its class and answered with a neutral 502.
//
// The rules live in `redaktion/buschtelefon*.ts`; what is here is the order
// of reads and writes, as functions over small injected services so it is
// tested without a database, and `verdrahteBuschtelefon`, which hangs them
// on the router. `index.ts` keeps only what has to share its closures: the
// chat branch and the two lead routes.

import { createError, isDirectusError } from '@directus/errors'
import type { NextFunction, Response, Router } from 'express'
import type { MessageSender } from '../../shared/claude'
import {
  BuschtelefonFehler,
  liesZugang
} from '../../shared/buschtelefon/client'
import { isAuthenticated, type ApiRequest } from '../../shared/http'
import type { BuschtelefonFund } from '../../types/schema'
import { leereKommentare } from '../../redaktion/buschtelefon'
import { abholungLaeuft } from '../../redaktion/buschtelefonlauf'
import {
  FUND_FELDER,
  hatSchreibMaterial,
  schreibeFundMeldung,
  ueberarbeiteBuschtelefon,
  type FundRohzeile
} from '../../redaktion/buschtelefonmeldungen'
import { verwirfEntwurfZu } from '../../redaktion/entwurf'
import type { RedaktionsBeitrag } from '../../redaktion/ergaenzung'
import type { EntscheidSignal } from '../../redaktion/gedaechtnis'
import {
  buschtelefonFundAlsHinweis,
  reicheWeiter
} from '../../redaktion/weiterreichen'

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export const BuschtelefonLaufLaeuftBereits = createError(
  'RUN_IN_PROGRESS',
  'Das Buschtelefon wird gerade abgeholt. Bitte kurz warten.',
  409
)

export const FundSchonEntschieden = createError(
  'ALREADY_DECIDED',
  'Über diesen Fund ist bereits entschieden.',
  409
)

export const FundMeldungSchonDa = createError(
  'ALREADY_WRITTEN',
  'Zu diesem Fund gibt es bereits eine Meldung. Sie lässt sich dort überarbeiten — oder zuerst verwerfen.',
  409
)

export const FundMeldungInArbeit = createError(
  'MELDUNG_IN_ARBEIT',
  'Die Meldung zu diesem Fund ist in der Gegenprüfung, freigegeben oder publiziert. Ablehnen oder weiterreichen lässt sich der Fund erst, wenn sie dort verworfen ist.',
  409
)

/**
 * The neutral 502 of this desk. A model's or a provider's error can carry
 * the prompt — and here the prompt is a private person's post — so nothing
 * of the cause reaches the browser; the log gets its name and code.
 */
export const BuschtelefonFehlgeschlagen = createError(
  'REQUEST_FAILED',
  'Das hat nicht geklappt. Die Ursache steht im Protokoll des Servers.',
  502
)

/** What `GET /buschtelefon/lauf` says about a run that broke off — never the error's own text. */
export const LAUF_ABGEBROCHEN =
  'Der Lauf ist abgebrochen. Die Ursache steht im Protokoll des Servers.'

export const FundOhneGemeindeFehler = createError(
  'FUND_OHNE_GEMEINDE',
  'Dieser Fund ist keiner Gemeinde zugeordnet. Bitte zuerst die Gemeinde wählen.',
  422
)

export const FundOhneMaterialFehler = createError(
  'FUND_OHNE_MATERIAL',
  'Zu diesem Fund liegt kein Wortlaut mehr vor. Eine Meldung ist nur mit eigenen Angaben oder von Hand möglich.',
  422
)

export const MaterialGenuegtNichtFehler = createError(
  'MATERIAL_GENUEGT_NICHT',
  'Das Material trägt keine Meldung. Mit eigenen Angaben oder von Hand geht es trotzdem.',
  422
)

export const UngueltigerFundGrund = createError(
  'INVALID_REASON',
  'Unbekannter Ablehnungsgrund.',
  400
)

export const UngueltigeFundGemeinde = createError(
  'INVALID_GEMEINDE',
  'Diese Gemeinde gibt es nicht oder sie wird nicht bespielt.',
  400
)

/** The writer's own refusals (`buschtelefonmeldungen.ts`) as answers a browser gets — each a 422 in its own words. */
export function alsAntwort(fehler: unknown): unknown {
  const code = (fehler as { code?: unknown } | null)?.code
  if (code === 'FUND_OHNE_GEMEINDE') return new FundOhneGemeindeFehler()
  if (code === 'FUND_OHNE_MATERIAL') return new FundOhneMaterialFehler()
  if (code === 'MATERIAL_GENUEGT_NICHT') return new MaterialGenuegtNichtFehler()
  return fehler
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

/** Decision 5 of the newsroom. `unbestaetigt` and `personenbezug` are this desk's own. */
export const ABLEHNUNGSGRUENDE = [
  'nicht_relevant',
  'unbestaetigt',
  'personenbezug',
  'doublette',
  'veraltet',
  'andere'
] as const
export type Ablehnungsgrund = (typeof ABLEHNUNGSGRUENDE)[number]

function wort(wert: unknown): string | null {
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null
}

/** `{grund, kommentar?}` — null where the reason is not one of the desk's. */
export function leseAblehnung(
  koerper: unknown
): { grund: Ablehnungsgrund; kommentar: string | null } | null {
  const k = (koerper ?? {}) as { grund?: unknown; kommentar?: unknown }
  if (
    typeof k.grund !== 'string' ||
    !(ABLEHNUNGSGRUENDE as readonly string[]).includes(k.grund)
  )
    return null
  return { grund: k.grund as Ablehnungsgrund, kommentar: wort(k.kommentar) }
}

export function leseBegruendung(koerper: unknown): string | null {
  return wort(((koerper ?? {}) as { begruendung?: unknown }).begruendung)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `{gemeinde: uuid}` — null for anything else, so a typo never reaches Postgres. */
export function leseGemeinde(koerper: unknown): string | null {
  const wert = ((koerper ?? {}) as { gemeinde?: unknown }).gemeinde
  return typeof wert === 'string' && UUID.test(wert) ? wert : null
}

// ---------------------------------------------------------------------------
// The decisions — services injected, no Directus in sight
// ---------------------------------------------------------------------------

interface LeseDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown>
}

interface ZeilenDienst extends LeseDienst {
  readOne(key: string, query: Record<string, unknown>): Promise<unknown>
  updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
}

interface MeldungsDienst extends LeseDienst {
  createOne(payload: Record<string, unknown>): Promise<unknown>
  updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
}

/** Articles of this find that are not discarded — at most one, by the partial unique index. */
async function lebendeMeldung(
  meldungen: LeseDienst,
  fundId: string
): Promise<{ id: string; status: string } | null> {
  const [meldung] = (await meldungen.readByQuery({
    filter: {
      buschtelefon_fund: { _eq: fundId },
      status: { _neq: 'verworfen' }
    },
    fields: ['id', 'status'],
    limit: 1
  })) as Array<{ id: string; status: string }>
  return meldung ?? null
}

function ohneBeitrag(beitrag: RedaktionsBeitrag): boolean {
  return beitrag.ergaenzung === null && beitrag.eigene === null
}

export interface UebernahmeErgebnis {
  meldung: string
  warnungen: string[]
  bedenken: string | null
  /** True where the run's draft was taken over and nothing was written. */
  entwurf_uebernommen: boolean
}

/**
 * «Meldung»: the first of the three decisions.
 *
 * - A row the run already wrote a draft for, and an empty body: the decision
 *   is set and NO second article is written — taking the draft over is the
 *   whole act.
 * - No article yet: written by the very function the run uses, then the
 *   decision is set. Without a municipality, or with nothing to write from
 *   and no Beitrag carrying it, the writer refuses and the caller answers 422.
 * - An article exists and the editor brings a Beitrag, or the row is decided
 *   otherwise: 409. A taken-over row whose article was discarded may be
 *   written again.
 *
 * Teaches nothing: taking a proposal over is never learned from
 * (`lohntLernen`) — a positive rule is how a desk overflows.
 */
export async function uebernehmeFund(
  dienste: {
    funde: ZeilenDienst
    meldungen: MeldungsDienst
    regeln: readonly string[]
    send?: MessageSender
  },
  id: string,
  beitrag: RedaktionsBeitrag,
  jetzt: string
): Promise<UebernahmeErgebnis> {
  const zeile = (await dienste.funde.readOne(id, {
    fields: FUND_FELDER
  })) as FundRohzeile
  if (zeile.entscheid !== 'offen' && zeile.entscheid !== 'uebernommen')
    throw new FundSchonEntschieden()

  const entschieden = { entscheid: 'uebernommen', entschieden_am: jetzt }
  const vorhanden = await lebendeMeldung(dienste.meldungen, id)
  if (vorhanden !== null) {
    if (zeile.entscheid !== 'offen' || !ohneBeitrag(beitrag))
      throw new FundMeldungSchonDa()
    await dienste.funde.updateOne(id, entschieden)
    return {
      meldung: vorhanden.id,
      warnungen: [],
      bedenken: zeile.entwurf_bedenken,
      entwurf_uebernommen: true
    }
  }

  // Said here rather than left to the writer, so the order of the refusals
  // is fixed: the municipality first — it is the one the editor can mend
  // with one click.
  if (zeile.gemeinde === null) throw new FundOhneGemeindeFehler()
  if (beitrag.eigene === null && !hatSchreibMaterial(zeile, beitrag.ergaenzung))
    throw new FundOhneMaterialFehler()

  let geschrieben: Awaited<ReturnType<typeof schreibeFundMeldung>>
  try {
    geschrieben = await schreibeFundMeldung(
      {
        funde: dienste.funde,
        meldungen: dienste.meldungen,
        regeln: dienste.regeln,
        ...(dienste.send === undefined ? {} : { send: dienste.send })
      },
      zeile,
      { beitrag }
    )
  } catch (fehler) {
    throw alsAntwort(fehler)
  }
  await dienste.funde.updateOne(id, entschieden)
  return { ...geschrieben, entwurf_uebernommen: false }
}

/**
 * «Ablehnen mit Grund». The comments and the image texts leave the row in
 * the SAME write as the decision; a draft goes with it.
 *
 * Refused (409) while the find's article is anything but a draft — in the
 * counter-check, approved or published. Rejecting then would leave that
 * article under a find the desk no longer shows (only `offen` and
 * `uebernommen` rows are on it, and the row is the only place its card is
 * rendered), with the comments it was checked against emptied, and teach
 * the next Sichtung «rejected» about a story the newsroom is publishing.
 * The way is to discard the article first.
 */
export async function lehneFundAb(
  dienste: { funde: ZeilenDienst; meldungen: MeldungsDienst },
  id: string,
  ablehnung: { grund: Ablehnungsgrund; kommentar: string | null },
  jetzt: string
): Promise<void> {
  const zeile = (await dienste.funde.readOne(id, {
    fields: ['id', 'entscheid', 'bilder', 'geteilt']
  })) as Pick<BuschtelefonFund, 'id' | 'entscheid' | 'bilder' | 'geteilt'>
  // A handed-up find has a lead on the Chefredaktion's desk, a lapsed one is
  // over: neither is this desk's to reject any more.
  if (zeile.entscheid !== 'offen' && zeile.entscheid !== 'uebernommen')
    throw new FundSchonEntschieden()
  const meldung = await lebendeMeldung(dienste.meldungen, id)
  if (meldung !== null && meldung.status !== 'entwurf')
    throw new FundMeldungInArbeit()

  await dienste.funde.updateOne(id, {
    ...leereKommentare(zeile),
    entscheid: 'abgelehnt',
    ablehnungsgrund: ablehnung.grund,
    ablehnungskommentar: ablehnung.kommentar,
    entschieden_am: jetzt
  })
  await verwirfEntwurfZu(
    dienste.meldungen as Parameters<typeof verwirfEntwurfZu>[0],
    { buschtelefon_fund: { _eq: id } },
    `Fund abgelehnt: ${ablehnung.grund}`
  )
}

/**
 * What the lead is built from, plus what the route has to know first — and
 * nothing of the material: the lead carries no wording
 * (`buschtelefonFundAlsHinweis`), so the route does not even read it.
 */
export const WEITERREICH_FELDER = [
  'id',
  'entscheid',
  'kanal',
  'quelle_art',
  'quelle_name',
  'quelle_sichtbarkeit',
  'veroeffentlicht_tag',
  'vorschlag_begruendung',
  'gemeinde.id'
]

/**
 * «An die Chefredaktion» — the editor's, or a rule's (`automatisch` with the
 * `regel` that asked). The lead first, the mark second (`reicheWeiter`), the
 * mark and its stamp in one write; the draft goes.
 *
 * `hinweise` is a SYSTEM-level service at both callers (the route and the
 * run): the find is read first through `funde`, which is the caller's own
 * service at the route, so the right to the find is proven before the lead
 * is created — and a create without accountability writes no revision.
 */
export async function reicheFundWeiter(
  dienste: {
    funde: ZeilenDienst
    hinweise: { createOne(payload: Record<string, unknown>): Promise<unknown> }
    meldungen: MeldungsDienst
  },
  id: string,
  begruendung: string | null,
  jetzt: string,
  automatik: { regel: string } | null = null
): Promise<string> {
  const zeile = (await dienste.funde.readOne(id, {
    fields: WEITERREICH_FELDER
  })) as Parameters<typeof buschtelefonFundAlsHinweis>[0] &
    Pick<BuschtelefonFund, 'entscheid'>
  if (zeile.entscheid !== 'offen') throw new FundSchonEntschieden()
  // Sending the draft on marks the find `uebernommen` (`markiereUebernommen`),
  // so an open find with an article past the draft is rare — but that mark
  // never throws, and an administrator can change a status in the admin UI.
  // Handing up would then discard nothing (`verwirfEntwurfZu` touches only
  // drafts) and leave the article under a find the desk no longer shows.
  const meldung = await lebendeMeldung(dienste.meldungen, id)
  if (meldung !== null && meldung.status !== 'entwurf')
    throw new FundMeldungInArbeit()

  const hinweis = await reicheWeiter(
    { hinweise: dienste.hinweise, ursprung: dienste.funde },
    {
      ursprungId: id,
      felder: buschtelefonFundAlsHinweis(zeile, begruendung),
      ursprungFelder: { entschieden_am: jetzt },
      ...(automatik === null
        ? {}
        : { automatisch: true, regel: automatik.regel })
    }
  )
  await verwirfEntwurfZu(
    dienste.meldungen as Parameters<typeof verwirfEntwurfZu>[0],
    { buschtelefon_fund: { _eq: id } },
    'Fund an die Chefredaktion weitergereicht'
  )
  return hinweis
}

/**
 * «Zurück auf den Tisch» for a find whose lead the Chefredaktion gives back
 * (`POST /hinweise/:id/zurueck` closes the lead either way).
 *
 * - The material is still there: the find reopens `offen` and its
 *   `entschieden_am` is stamped NOW — retention counts the fourteen open days
 *   from the later of the first release and that stamp, so a find handed
 *   back on day twenty is not lapsed by the very next run.
 * - The material is gone (the door reported the post removed, or retention
 *   emptied it after ninety days): there is nothing to decide on and nothing
 *   retention would ever touch again, so reopening would leave an empty row
 *   on the desk for good — and «Mit eigenen Angaben» could still write about
 *   a post withdrawn at the source. The find lapses instead.
 */
export async function gibFundZurueck(
  funde: ZeilenDienst,
  fundId: string,
  jetzt: string
): Promise<'offen' | 'verfallen'> {
  const zeile = (await funde.readOne(fundId, {
    fields: ['id', 'status', 'material_geloescht_am']
  })) as Pick<BuschtelefonFund, 'id' | 'status' | 'material_geloescht_am'>
  if (zeile.status === 'entfernt' || zeile.material_geloescht_am !== null) {
    await funde.updateOne(fundId, { entscheid: 'verfallen' })
    return 'verfallen'
  }
  await funde.updateOne(fundId, { entscheid: 'offen', entschieden_am: jetzt })
  return 'offen'
}

/**
 * «Gemeinde zuordnen» — only while the find is open, only to a municipality
 * the newsroom covers, and not once an article exists: that article belongs
 * to the municipality it was written for.
 */
export async function ordneGemeindeZu(
  dienste: {
    funde: ZeilenDienst
    gemeinden: LeseDienst
    meldungen: LeseDienst
  },
  id: string,
  gemeindeId: string
): Promise<void> {
  const [gemeinde] = (await dienste.gemeinden.readByQuery({
    filter: { id: { _eq: gemeindeId }, aktiv: { _eq: true } },
    fields: ['id'],
    limit: 1
  })) as Array<{ id: string }>
  if (gemeinde === undefined) throw new UngueltigeFundGemeinde()

  const zeile = (await dienste.funde.readOne(id, {
    fields: ['id', 'entscheid']
  })) as Pick<BuschtelefonFund, 'id' | 'entscheid'>
  if (zeile.entscheid !== 'offen') throw new FundSchonEntschieden()
  if ((await lebendeMeldung(dienste.meldungen, id)) !== null)
    throw new FundMeldungSchonDa()

  await dienste.funde.updateOne(id, { gemeinde: gemeindeId })
}

/**
 * Sending the run's draft on — to the counter-check, to `freigegeben`, or
 * out — IS taking the find over, whether or not anyone clicked «Meldung» on
 * the row. Without this the row stayed `offen`, lapsed after fourteen days,
 * and the next Sichtung read a published find as one the newsroom left lying.
 * Never throws: the status change has already happened.
 */
export async function markiereUebernommen(
  funde: ZeilenDienst,
  fundId: string,
  jetzt: string,
  logger?: { warn: (e: unknown, m?: string) => void }
): Promise<boolean> {
  try {
    const zeile = (await funde.readOne(fundId, {
      fields: ['id', 'entscheid']
    })) as Pick<BuschtelefonFund, 'id' | 'entscheid'>
    if (zeile.entscheid !== 'offen') return false
    await funde.updateOne(fundId, {
      entscheid: 'uebernommen',
      entschieden_am: jetzt
    })
    return true
  } catch (fehler) {
    logger?.warn(
      fehlerKennung(fehler),
      'redaktion: Buschtelefon-Fund nicht als übernommen markiert'
    )
    return false
  }
}

/**
 * The chat revision of an article written from a find. The find is read
 * FRESH: its material may have been emptied since the first write, and then
 * only the editor's stored additions carry the revision — or nothing does,
 * and the writer says so.
 */
export async function ueberarbeiteFundMeldung(
  dienste: {
    funde: ZeilenDienst
    meldungen: MeldungsDienst
    regeln: readonly string[]
    send?: MessageSender
  },
  meldung: {
    id: string
    titel: string | null
    lead: string | null
    text: string | null
  },
  fundId: string,
  anweisung: string,
  ergaenzung: string | null
): Promise<string[]> {
  const zeile = (await dienste.funde.readOne(fundId, {
    fields: FUND_FELDER
  })) as FundRohzeile
  return ueberarbeiteBuschtelefon(
    {
      funde: dienste.funde,
      meldungen: dienste.meldungen,
      regeln: dienste.regeln,
      ...(dienste.send === undefined ? {} : { send: dienste.send })
    },
    meldung,
    zeile,
    anweisung,
    ergaenzung
  )
}

// ---------------------------------------------------------------------------
// The run's state, as the button sees it
// ---------------------------------------------------------------------------

export interface BuschtelefonLaufStatus {
  laeuft: boolean
  gestartet_um: string | null
  beendet_um: string | null
  ergebnis: Record<string, unknown> | null
  fehler: string | null
}

export function leererLauf(): BuschtelefonLaufStatus {
  return {
    laeuft: false,
    gestartet_um: null,
    beendet_um: null,
    ergebnis: null,
    fehler: null
  }
}

/**
 * What `GET /buschtelefon/lauf` answers: the process's own state plus
 * whether the door is set up at all — and, where it is not, WHICH variable
 * is missing (the `CRAWLER_KEY` bargain: off, and it says so). Names of
 * variables only, never a value.
 */
export function laufAntwort(
  lauf: BuschtelefonLaufStatus,
  env: NodeJS.ProcessEnv = process.env
): BuschtelefonLaufStatus & { eingerichtet: boolean; fehlend: string[] } {
  const zugang = liesZugang(env)
  return {
    ...lauf,
    eingerichtet: zugang.ok,
    fehlend: zugang.ok ? [] : zugang.fehlend
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

type Dienst = ZeilenDienst & MeldungsDienst

export interface BuschtelefonUmgebung {
  services: {
    ItemsService: new (
      sammlung: string,
      optionen: { schema: unknown; accountability?: unknown }
    ) => Dienst
  }
  getSchema: () => Promise<unknown>
  logger: {
    info: (obj: unknown, msg?: string) => void
    warn: (obj: unknown, msg?: string) => void
    error: (obj: unknown, msg?: string) => void
  }
  /** Runs the operation `buschtelefon-abholen` — the very handler the Flow calls. */
  holeAb: () => Promise<unknown>
  /** `index.ts`'s own helpers, handed in so one rule has one home. */
  pruefeId: (wert: unknown) => string
  beitragAus: (req: ApiRequest) => RedaktionsBeitrag
  lerne: (signal: EntscheidSignal) => void
  /** The desk's text rules — `allgemein` rides along (`ladeRegeln`). */
  textregeln: () => Promise<string[]>
  uebersetze: (fehler: unknown) => unknown
  NichtAngemeldet: new () => unknown
  /**
   * Whether a run is going ANYWHERE in this process — the Flow's as well as
   * the button's. Defaults to `abholungLaeuft` (`redaktion/buschtelefonlauf.ts`,
   * the process-wide single-flight the operation goes through); a test hands
   * in its own.
   */
  laeuftAnderswo?: () => boolean
}

/**
 * Whose words an error is. Every answer of this desk and of Directus itself
 * is built with `createError` (`isDirectusError`) — those are the caller's
 * mistakes or the house's own sentences and go out as they are. Anything
 * else — a model's malformed answer, the Anthropic SDK's `APIError` with its
 * own 4xx, a bug — may carry the prompt, which here is a private person's
 * post: it is decided by TYPE, never by a status that a provider error
 * carries just as well.
 */
export function istEigeneAntwort(fehler: unknown): boolean {
  return isDirectusError(fehler)
}

/** What of an error may go into the log: its class, never its text. */
export function fehlerKennung(fehler: unknown): {
  name: string | null
  code: string | null
  status: number | null
} {
  const f = (fehler ?? {}) as {
    name?: unknown
    code?: unknown
    status?: unknown
  }
  return {
    name: typeof f.name === 'string' ? f.name : null,
    code: typeof f.code === 'string' ? f.code : null,
    status: typeof f.status === 'number' ? f.status : null
  }
}

/** The text `GET /lauf` shows for a run that threw: the door's own sentence, else a neutral one. */
export function laufFehlerText(fehler: unknown): string {
  // `BuschtelefonFehler` is the client's own class: its sentences are
  // written in `shared/buschtelefon/client.ts` and never carry a secret or a
  // response body. Anything else is not read.
  return fehler instanceof BuschtelefonFehler
    ? fehler.message
    : LAUF_ABGEBROCHEN
}

export function verdrahteBuschtelefon(
  router: Router,
  umgebung: BuschtelefonUmgebung
): void {
  const { services, getSchema, logger } = umgebung
  const { ItemsService } = services
  const laeuftAnderswo = umgebung.laeuftAnderswo ?? abholungLaeuft

  const lauf = leererLauf()

  function laeuft(): boolean {
    return lauf.laeuft || laeuftAnderswo()
  }

  function starte(): boolean {
    // The Flow's 12:00 run does not set `lauf.laeuft`; without asking the
    // process-wide guard, the button would be offered — and pressed — while
    // the Flow is half-way through its Sichtung.
    if (laeuft()) return false
    lauf.laeuft = true
    lauf.gestartet_um = new Date().toISOString()
    lauf.beendet_um = null
    lauf.ergebnis = null
    lauf.fehler = null

    // Detached: the answer has gone out. Always caught — an unhandled
    // rejection here would take the process down.
    void Promise.resolve()
      .then(() => umgebung.holeAb())
      .then((ergebnis: unknown) => {
        logger.info(ergebnis, 'redaktion: Buschtelefon-Lauf beendet')
        lauf.ergebnis =
          typeof ergebnis === 'object' && ergebnis !== null
            ? (ergebnis as Record<string, unknown>)
            : null
      })
      .catch((fehler: unknown) => {
        logger.error(
          fehlerKennung(fehler),
          'redaktion: Buschtelefon-Lauf fehlgeschlagen'
        )
        lauf.fehler = laufFehlerText(fehler)
      })
      .finally(() => {
        lauf.laeuft = false
        lauf.beendet_um = new Date().toISOString()
      })
    return true
  }

  /** A route's failure: the house's own answers as they are, everything else logged by class and hidden behind the 502. */
  function scheitere(fehler: unknown, next: NextFunction, wo: string): void {
    if (istEigeneAntwort(fehler)) return next(umgebung.uebersetze(fehler))
    logger.error(
      fehlerKennung(fehler),
      `redaktion: Buschtelefon-${wo} fehlgeschlagen`
    )
    return next(new BuschtelefonFehlgeschlagen())
  }

  async function dienste(req: ApiRequest): Promise<{
    funde: Dienst
    meldungen: Dienst
    hinweise: Dienst
    gemeinden: Dienst
  }> {
    const schema = await getSchema()
    const optionen = { schema, accountability: req.accountability }
    return {
      funde: new ItemsService('buschtelefon_funde', optionen),
      meldungen: new ItemsService('meldungen', optionen),
      // System-level on purpose, and used for nothing but creating a lead:
      // `recherchehinweise` keeps revisions, and a create with the caller's
      // accountability would copy the lead into `directus_revisions`. The
      // session was checked by the route, the caller's right to the find by
      // the `funde.readOne` (her own service) that precedes the create in
      // `reicheFundWeiter`, and the lead carries no wording anyway.
      hinweise: new ItemsService('recherchehinweise', { schema }),
      gemeinden: new ItemsService('gemeinden', optionen)
    }
  }

  router.get(
    '/buschtelefon/lauf',
    (req: ApiRequest, res: Response, next: NextFunction) => {
      if (!isAuthenticated(req)) return next(new umgebung.NichtAngemeldet())
      return res.json({ data: laufAntwort({ ...lauf, laeuft: laeuft() }) })
    }
  )

  router.post(
    '/buschtelefon/pruefen',
    (req: ApiRequest, res: Response, next: NextFunction) => {
      if (!isAuthenticated(req)) return next(new umgebung.NichtAngemeldet())
      if (!starte()) return next(new BuschtelefonLaufLaeuftBereits())
      return res.status(202).json({ data: { gestartet: true } })
    }
  )

  router.post(
    '/buschtelefon/:id/meldung',
    async (req: ApiRequest, res: Response, next: NextFunction) => {
      if (!isAuthenticated(req)) return next(new umgebung.NichtAngemeldet())
      try {
        const id = umgebung.pruefeId(req.params['id'])
        const beitrag = umgebung.beitragAus(req)
        const d = await dienste(req)
        const ergebnis = await uebernehmeFund(
          {
            funde: d.funde,
            meldungen: d.meldungen,
            regeln: await umgebung.textregeln()
          },
          id,
          beitrag,
          new Date().toISOString()
        )
        return res.json({ data: ergebnis })
      } catch (fehler) {
        // A provider error can carry the prompt — and here the prompt is a
        // private person's post. Logged by its class, never answered.
        return scheitere(fehler, next, 'Meldung')
      }
    }
  )

  router.post(
    '/buschtelefon/:id/ablehnen',
    async (req: ApiRequest, res: Response, next: NextFunction) => {
      if (!isAuthenticated(req)) return next(new umgebung.NichtAngemeldet())
      const ablehnung = leseAblehnung(req.body)
      if (ablehnung === null) return next(new UngueltigerFundGrund())
      try {
        const id = umgebung.pruefeId(req.params['id'])
        const d = await dienste(req)
        await lehneFundAb(d, id, ablehnung, new Date().toISOString())
        umgebung.lerne({
          tisch: 'buschtelefon',
          art: 'entscheid',
          zeileId: id,
          entscheid: 'abgelehnt',
          grund: ablehnung.grund,
          kommentar: ablehnung.kommentar
        })
        return res.json({ data: { fund: id, entscheid: 'abgelehnt' } })
      } catch (fehler) {
        return scheitere(fehler, next, 'Ablehnung')
      }
    }
  )

  router.post(
    '/buschtelefon/:id/weiterreichen',
    async (req: ApiRequest, res: Response, next: NextFunction) => {
      if (!isAuthenticated(req)) return next(new umgebung.NichtAngemeldet())
      const begruendung = leseBegruendung(req.body)
      try {
        const id = umgebung.pruefeId(req.params['id'])
        const d = await dienste(req)
        const hinweis = await reicheFundWeiter(
          d,
          id,
          begruendung,
          new Date().toISOString()
        )
        umgebung.lerne({
          tisch: 'buschtelefon',
          art: 'entscheid',
          zeileId: id,
          entscheid: 'weitergereicht',
          grund: null,
          kommentar: begruendung
        })
        return res.json({ data: { hinweis } })
      } catch (fehler) {
        return scheitere(fehler, next, 'Weitergabe')
      }
    }
  )

  router.post(
    '/buschtelefon/:id/gemeinde',
    async (req: ApiRequest, res: Response, next: NextFunction) => {
      if (!isAuthenticated(req)) return next(new umgebung.NichtAngemeldet())
      const gemeinde = leseGemeinde(req.body)
      if (gemeinde === null) return next(new UngueltigeFundGemeinde())
      try {
        const id = umgebung.pruefeId(req.params['id'])
        await ordneGemeindeZu(await dienste(req), id, gemeinde)
        return res.json({ data: { fund: id, gemeinde } })
      } catch (fehler) {
        return scheitere(fehler, next, 'Zuordnung')
      }
    }
  )
}
