// Eine Meldung aus einem Fund des Buschtelefons — der eine Weg, den der
// 12-Uhr-Lauf und der Knopf am Tisch teilen.
//
// Die Abmachung der Gemeindeseiten (`gemeindemeldungen.ts`), mit dem, was
// dieser Tisch anders braucht:
//
// - Der Lauf schreibt den Entwurf zu jedem VORSCHLAG mit Gemeinde. Er lehrt
//   nichts, und der Entscheid auf der Zeile bleibt OFFEN: Uebernehmen,
//   Ablehnen und Weiterreichen stehen weiter neben dem Entwurf. Darum setzt
//   diese Datei `entscheid` nie — das tut die Route, wenn ein Mensch klickt.
// - In `meldungen.zeit_warnungen` stehen NUR die Pruefungen, in Gesichtern
//   ohne Namen und ohne Wert (`warnungen.ts`): die Spalte verlaesst das Haus
//   ueber das Pruefsiegel der oeffentlichen API. Die Bedenken des Schreibers
//   und was die Namenspruefung im Einzelnen fand, stehen auf dem Fund
//   (`entwurf_bedenken`) und nur dort.
// - `datengrundlage` traegt weder Wortlaut noch Kommentare noch Vornamen.
// - Wo das Material keine Meldung traegt, antwortet der Schreiber
//   `{"genuegt": false}`; der Knopf macht daraus ein 422, der Lauf merkt es
//   sich auf der Zeile und fragt erst wieder, wenn der Fund sich aendert.

import { BuschtelefonFehler } from '../shared/buschtelefon/client'
import {
  ClaudeFormatError,
  ClaudeTruncatedError,
  completeJson,
  type MessageSender
} from '../shared/claude'
import type { BuschtelefonFund } from '../types/schema'
import {
  buildBuschtelefonPrompt,
  buildBuschtelefonRevision,
  BUSCHTELEFON_SYSTEM_PROMPT,
  datengrundlageVon,
  hatMaterial,
  herkunftsSatz,
  herkunftsWarnung,
  materialGenuegtNicht,
  mitQuelle,
  ohneQuelle,
  parseAntwort,
  personenPruefung,
  pruefungen,
  quelleNeuSetzen,
  quellenName,
  tagMitWochentag,
  wertfrei,
  type BuschtelefonFakten
} from './buschtelefon'
import {
  eigeneFelder,
  herkunftFelder,
  OHNE_BEITRAG,
  type RedaktionsBeitrag
} from './ergaenzung'

/** Wie viele Entwuerfe ein Lauf schreibt. Ein Modellaufruf je Stueck. */
export const BUSCHTELEFON_MELDUNGEN_JE_LAUF = 20

/** What the run notes on a row whose material carried no Meldung — and what makes it skip the row until the find changes. */
export const KEIN_ENTWURF =
  'Kein Entwurf: Der Schreiber fand im Material keine Meldung.'

/** The row as the writer needs it — the Gemeinde expanded, the bigints left out. */
export type FundRohzeile = Pick<
  BuschtelefonFund,
  | 'id'
  | 'status'
  | 'kanal'
  | 'quelle_name'
  | 'quelle_art'
  | 'quelle_sichtbarkeit'
  | 'quelle_url'
  | 'link'
  | 'veroeffentlicht_tag'
  | 'datum_genauigkeit'
  | 'autor_art'
  | 'autor_rolle'
  | 'autor_name'
  | 'autor_vorname'
  | 'autor_ref'
  | 'text'
  | 'text_abgeschnitten'
  | 'bilder'
  | 'verlinkt'
  | 'geteilt'
  | 'kommentare'
  | 'kommentare_stand'
  | 'aktualisiert_am'
  | 'entwurf_bedenken'
  | 'entscheid'
  | 'material_geloescht_am'
> & { gemeinde: { id: string; name: string } | null }

export const FUND_FELDER = [
  'id',
  'status',
  'kanal',
  'quelle_name',
  'quelle_art',
  'quelle_sichtbarkeit',
  'quelle_url',
  'link',
  'veroeffentlicht_tag',
  'datum_genauigkeit',
  'autor_art',
  'autor_rolle',
  'autor_name',
  'autor_vorname',
  'autor_ref',
  'text',
  'text_abgeschnitten',
  'bilder',
  'verlinkt',
  'geteilt',
  'kommentare',
  'kommentare_stand',
  'aktualisiert_am',
  'entwurf_bedenken',
  'entscheid',
  'material_geloescht_am',
  'gemeinde.id',
  'gemeinde.name'
]

/** A find without a municipality cannot become a Meldung — an article belongs to one. */
export class FundOhneGemeinde extends Error {
  readonly code = 'FUND_OHNE_GEMEINDE'
  constructor() {
    super(
      'Dieser Fund ist keiner Gemeinde zugeordnet. Bitte zuerst die Gemeinde wählen.'
    )
    this.name = 'FundOhneGemeinde'
  }
}

/** The material was emptied (retention, a removal at the source) or never carried words. */
export class FundOhneMaterial extends Error {
  readonly code = 'FUND_OHNE_MATERIAL'
  constructor() {
    super(
      'Zu diesem Fund liegt kein Wortlaut mehr vor. Eine Meldung ist nur mit eigenen Angaben oder von Hand möglich.'
    )
    this.name = 'FundOhneMaterial'
  }
}

/** The writer answered `{"genuegt": false}`. */
export class MaterialGenuegtNicht extends Error {
  readonly code = 'MATERIAL_GENUEGT_NICHT'
  constructor() {
    super(
      'Das Material trägt keine Meldung. Mit eigenen Angaben oder von Hand geht es trotzdem.'
    )
    this.name = 'MaterialGenuegtNicht'
  }
}

// ---------------------------------------------------------------------------
// Failures, as this desk may say them
// ---------------------------------------------------------------------------

/** The desk's own refusals — fixed German sentences, safe to show and to store. */
function eigenerFehler(fehler: unknown): fehler is Error {
  return (
    fehler instanceof FundOhneGemeinde ||
    fehler instanceof FundOhneMaterial ||
    fehler instanceof MaterialGenuegtNicht ||
    fehler instanceof BuschtelefonFehler
  )
}

function codeVon(fehler: unknown): string | number | null {
  if (typeof fehler !== 'object' || fehler === null) return null
  const { code, status } = fehler as { code?: unknown; status?: unknown }
  if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(code))
    return code
  if (typeof code === 'number' && Number.isSafeInteger(code)) return code
  if (typeof status === 'number' && status >= 100 && status <= 599)
    return status
  return null
}

/**
 * What the log gets of a failure on this desk: its class and its code,
 * never its message. A `ClaudeFormatError` carries the first 500 characters
 * of the model's answer — a draft about a private person's post — and a
 * provider error can carry the prompt; the logger takes neither.
 */
export function fehlerKennung(fehler: unknown): {
  name: string
  code: string | number | null
} {
  const name =
    fehler instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(fehler.name)
      ? fehler.name
      : 'unbekannt'
  return { name, code: codeVon(fehler) }
}

/**
 * A failure as a sentence for the run's result — which is stored in
 * `buschtelefon_stand.ergebnis`, logged by the Flow and served to the desk.
 * Keyed on the error CLASS, so no model answer and no provider text can ride
 * in it: the desk's own refusals and the door's errors are fixed sentences
 * and pass; a Directus error names a field and a collection, never a value;
 * everything else becomes a neutral sentence and the cause stays in the log
 * (`fehlerKennung`).
 */
export function fehlerSatz(fehler: unknown): string {
  if (eigenerFehler(fehler)) return fehler.message
  if (fehler instanceof ClaudeFormatError)
    return 'Die Antwort des Modells war nicht lesbar.'
  if (fehler instanceof ClaudeTruncatedError)
    return `Die Antwort des Modells brach an der Höchstlänge ab (${fehler.maxTokens} Tokens).`
  if (
    fehler instanceof Error &&
    fehler.name === 'DirectusError' &&
    typeof codeVon(fehler) === 'string'
  )
    return `${fehler.message.slice(0, 300)} (${String(codeVon(fehler))})`
  const code = codeVon(fehler)
  return code === null
    ? 'Unerwarteter Fehler — Einzelheiten im Protokoll.'
    : `Unerwarteter Fehler (${String(code)}) — Einzelheiten im Protokoll.`
}

/** The facts the writer works from. Throws `FundOhneGemeinde` — the caller decides what that costs. */
export function fundFakten(
  zeile: FundRohzeile,
  /** The editor's additions (`redaktion/ergaenzung.ts`). */
  ergaenzung: string | null = null
): BuschtelefonFakten {
  if (zeile.gemeinde === null) throw new FundOhneGemeinde()
  return {
    gemeinde: zeile.gemeinde.name,
    kanal: zeile.kanal,
    quelle_art: zeile.quelle_art,
    quelle_name: zeile.quelle_name,
    quelle_sichtbarkeit: zeile.quelle_sichtbarkeit,
    quelle_url: zeile.quelle_url,
    link: zeile.link,
    veroeffentlicht_tag: zeile.veroeffentlicht_tag,
    datum_genauigkeit: zeile.datum_genauigkeit,
    autor_art: zeile.autor_art,
    autor_rolle: zeile.autor_rolle,
    autor_name: zeile.autor_name,
    autor_vorname: zeile.autor_vorname,
    autor_ref: zeile.autor_ref,
    text: zeile.text,
    text_abgeschnitten: zeile.text_abgeschnitten,
    bilder: zeile.bilder,
    verlinkt: zeile.verlinkt,
    geteilt: zeile.geteilt,
    kommentare: zeile.kommentare,
    kommentare_stand: zeile.kommentare_stand,
    status: zeile.status,
    ergaenzung
  }
}

/** No article from nothing: the row's own material, or what the editor typed. */
export function hatSchreibMaterial(
  zeile: FundRohzeile,
  ergaenzung: string | null = null
): boolean {
  return hatMaterial(zeile) || (ergaenzung ?? '').trim() !== ''
}

/** How the run and the desk name a find WITHOUT its wording — a result must not carry what retention removes. */
export function fundBezeichnung(
  zeile: Pick<
    FundRohzeile,
    'gemeinde' | 'kanal' | 'quelle_art' | 'quelle_name' | 'veroeffentlicht_tag'
  >
): string {
  const tag =
    zeile.veroeffentlicht_tag === null
      ? ''
      : ` vom ${tagMitWochentag(zeile.veroeffentlicht_tag)}`
  return `${zeile.gemeinde?.name ?? 'ohne Gemeinde'}: Beitrag aus ${quellenName(zeile)}${tag}`
}

const ZWECK = 'buschtelefon:meldung'

/** One attempt, and on unparseable JSON exactly one more — the house's rule since the first unattended run. */
async function frage(
  prompt: string,
  send: MessageSender | undefined,
  zweck: string = ZWECK
): Promise<unknown> {
  const anfrage = {
    system: BUSCHTELEFON_SYSTEM_PROMPT,
    prompt,
    maxTokens: 1500
  }
  try {
    return await completeJson<unknown>({ ...anfrage, zweck }, send)
  } catch (fehler) {
    if (!(fehler instanceof ClaudeFormatError)) throw fehler
    return completeJson<unknown>(
      { ...anfrage, zweck: `${zweck}:json-wiederholung` },
      send
    )
  }
}

export interface GeschriebeneFundMeldung {
  bericht: { titel: string; lead: string; text: string }
  /** The checks only — what `meldungen.zeit_warnungen` takes. */
  warnungen: string[]
  /** The writer's reservations plus the details of the name check — for `entwurf_bedenken`, never for the article. */
  bedenken: string | null
}

/**
 * The article with the checks that make its rules real. The origin check —
 * names the network or group AND says it is unconfirmed — is the one that
 * buys a second call; everything else is reported. Throws
 * `MaterialGenuegtNicht` where the writer declined.
 */
export async function fundMeldungMitChecks(
  fakten: BuschtelefonFakten,
  prompt: string,
  send?: MessageSender
): Promise<GeschriebeneFundMeldung> {
  let antwort = await frage(prompt, send)
  if (materialGenuegtNicht(antwort)) throw new MaterialGenuegtNicht()
  let bericht = parseAntwort(antwort)

  let herkunft = herkunftsWarnung(`${bericht.lead} ${bericht.text}`, fakten)
  if (herkunft !== null) {
    antwort = await completeJson<unknown>(
      {
        zweck: `${ZWECK}:nachfassen`,
        system: BUSCHTELEFON_SYSTEM_PROMPT,
        prompt: buildBuschtelefonRevision(
          fakten,
          bericht,
          herkunftsSatz(fakten)
        ),
        maxTokens: 1500
      },
      send
    )
    // A retry that declines keeps the first article and its warning.
    if (!materialGenuegtNicht(antwort)) {
      bericht = parseAntwort(antwort)
      herkunft = herkunftsWarnung(`${bericht.lead} ${bericht.text}`, fakten)
    }
  }

  const { warnungen, einzelheiten } = pruefungen(bericht, fakten, herkunft)
  const bedenken = [
    ...(bericht.bedenken === null ? [] : [bericht.bedenken]),
    ...einzelheiten
  ].join('\n')
  return {
    bericht: { titel: bericht.titel, lead: bericht.lead, text: bericht.text },
    warnungen,
    bedenken: bedenken === '' ? null : bedenken
  }
}

interface LeseDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown>
}

interface SchreibDienst {
  updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
}

export interface FundMeldungDienste {
  /** `buschtelefon_funde` — only `entwurf_bedenken` is ever written here. */
  funde: SchreibDienst
  meldungen: LeseDienst &
    SchreibDienst & {
      createOne(payload: Record<string, unknown>): Promise<unknown>
    }
  /** The desk's text rules, `ladeRegeln({bereich: 'buschtelefon', stufe: 'text'})` — it brings `allgemein` along. */
  regeln: readonly string[]
  logger?: { info: (m: string) => void; warn: (e: unknown, m?: string) => void }
  /** Tests inject a stub; production leaves it out. */
  send?: MessageSender
}

/**
 * Eine Meldung aus einem Fund. `beitrag` ist, was die Redaktion dazugibt
 * (`redaktion/ergaenzung.ts`): der Lauf gibt nie etwas, der Knopf entweder
 * ergaenzende Angaben oder die ganze Meldung von Hand (kein Modellaufruf,
 * die Quellenzeile vom Code). Lehrt nichts und setzt keinen Entscheid.
 */
export async function schreibeFundMeldung(
  dienste: FundMeldungDienste,
  zeile: FundRohzeile,
  optionen: { beitrag?: RedaktionsBeitrag } = {}
): Promise<{ meldung: string; warnungen: string[]; bedenken: string | null }> {
  const beitrag = optionen.beitrag ?? OHNE_BEITRAG
  if (zeile.gemeinde === null) throw new FundOhneGemeinde()
  const grundlage = {
    ...datengrundlageVon(zeile),
    ...herkunftFelder(beitrag)
  }
  const ohneTermin = {
    termin: null,
    termin_vorschlag: null,
    wichtig: null,
    wichtig_vorschlag: null
  }

  if (beitrag.eigene !== null) {
    const felder = eigeneFelder(beitrag.eigene, (text) =>
      mitQuelle(text, zeile)
    )
    // Her own text passes the desk's person checks too (decision 7): the
    // contact check always, the surname check against the material where
    // the row still carries it. The house's link face quotes the address —
    // here it becomes the value-free one, the address goes to the desk.
    const eigene = beitrag.eigene
    const alles = `${eigene.titel} ${eigene.lead} ${eigene.text}`
    const personen = personenPruefung(
      alles,
      hatMaterial(zeile) ? fundFakten(zeile, null) : null
    )
    const geprueft = wertfrei([
      ...((felder['zeit_warnungen'] as string[] | null) ?? []),
      ...personen.warnungen
    ])
    const einzelheiten = [...personen.einzelheiten, ...geprueft.einzelheiten]
    const meldung = (await dienste.meldungen.createOne({
      buschtelefon_fund: zeile.id,
      gemeinde: zeile.gemeinde.id,
      ...felder,
      zeit_warnungen: geprueft.warnungen.length > 0 ? geprueft.warnungen : null,
      ...ohneTermin,
      datengrundlage: grundlage
    })) as string
    // Reservations about a machine draft say nothing about her own text —
    // what the checks found in HER text replaces them.
    const bedenken = einzelheiten.length === 0 ? null : einzelheiten.join('\n')
    if (zeile.entwurf_bedenken !== bedenken)
      await dienste.funde.updateOne(zeile.id, { entwurf_bedenken: bedenken })
    return { meldung, warnungen: geprueft.warnungen, bedenken }
  }

  if (!hatSchreibMaterial(zeile, beitrag.ergaenzung))
    throw new FundOhneMaterial()
  const fakten = fundFakten(zeile, beitrag.ergaenzung)
  const { bericht, warnungen, bedenken } = await fundMeldungMitChecks(
    fakten,
    buildBuschtelefonPrompt(fakten, dienste.regeln),
    dienste.send
  )

  const meldung = (await dienste.meldungen.createOne({
    buschtelefon_fund: zeile.id,
    gemeinde: zeile.gemeinde.id,
    titel: bericht.titel,
    lead: bericht.lead,
    text: mitQuelle(bericht.text, zeile),
    status: 'entwurf',
    verarbeitung: 'idle',
    // The checks only. Never the writer's reservations, never a name: this
    // column is served by the public API's Pruefsiegel.
    zeit_warnungen: warnungen.length > 0 ? warnungen : null,
    ...ohneTermin,
    datengrundlage: grundlage
  })) as string
  await dienste.funde.updateOne(zeile.id, { entwurf_bedenken: bedenken })
  return { meldung, warnungen, bedenken }
}

export interface FundMeldungenErgebnis {
  geschrieben: number
  /** What the cap of this run left lying, named without its wording; the next run takes it. */
  wartend: string[]
  /** Proposals without a municipality — no draft, the desk shows «Gemeinde fehlt». */
  ohneGemeinde: number
  /** Proposals whose material carried no Meldung, by the writer's own answer — noted on the row. */
  ohneMeldung: number
  fehler: string[]
}

function zeit(wert: string | null | undefined): number | null {
  if (wert === null || wert === undefined) return null
  const z = Date.parse(wert)
  return Number.isFinite(z) ? z : null
}

/**
 * Whether the run still owes this row a draft. It owes none where an
 * article that was not discarded exists, where any article — a discarded
 * one too — was written since the material last changed (the editor threw
 * the draft away; writing it again every noon would be an insult), and where
 * the writer already declined this state of the find.
 */
export function brauchtEntwurf(
  zeile: Pick<FundRohzeile, 'aktualisiert_am' | 'entwurf_bedenken'>,
  meldungen: ReadonlyArray<{ status: string; date_created: string | null }>
): boolean {
  if ((zeile.entwurf_bedenken ?? '').startsWith(KEIN_ENTWURF)) return false
  if (meldungen.some((m) => m.status !== 'verworfen')) return false
  const seit = zeit(zeile.aktualisiert_am)
  if (seit === null) return meldungen.length === 0
  return !meldungen.some((m) => {
    const erstellt = zeit(m.date_created)
    return erstellt === null || erstellt >= seit
  })
}

/**
 * Jeder Vorschlag mit Gemeinde bekommt seinen Entwurf — hoechstens `deckel`
 * je Lauf, in der Reihenfolge, in der die Zeilen kommen (der Lauf reicht sie
 * nach Stufe, dann nach Alter). Der Rest wird genannt und wartet auf morgen.
 */
export async function schreibeFundMeldungen(
  dienste: FundMeldungDienste,
  zeilen: readonly FundRohzeile[],
  deckel: number = BUSCHTELEFON_MELDUNGEN_JE_LAUF
): Promise<FundMeldungenErgebnis> {
  const ergebnis: FundMeldungenErgebnis = {
    geschrieben: 0,
    wartend: [],
    ohneGemeinde: 0,
    ohneMeldung: 0,
    fehler: []
  }
  if (zeilen.length === 0) return ergebnis

  const vorhandene = (await dienste.meldungen.readByQuery({
    filter: { buschtelefon_fund: { _in: zeilen.map((z) => z.id) } },
    fields: ['buschtelefon_fund', 'status', 'date_created'],
    limit: -1
  })) as Array<{
    buschtelefon_fund: string | null
    status: string
    date_created: string | null
  }>
  const jeFund = new Map<string, typeof vorhandene>()
  for (const m of vorhandene) {
    if (m.buschtelefon_fund === null) continue
    const liste = jeFund.get(m.buschtelefon_fund) ?? []
    liste.push(m)
    jeFund.set(m.buschtelefon_fund, liste)
  }

  const offen: FundRohzeile[] = []
  for (const zeile of zeilen) {
    if (!brauchtEntwurf(zeile, jeFund.get(zeile.id) ?? [])) continue
    if (zeile.gemeinde === null) {
      ergebnis.ohneGemeinde += 1
      continue
    }
    if (!hatSchreibMaterial(zeile)) continue
    offen.push(zeile)
  }
  const dran = offen.slice(0, Math.max(0, deckel))
  ergebnis.wartend = offen.slice(dran.length).map(fundBezeichnung)

  for (const zeile of dran) {
    try {
      await schreibeFundMeldung(dienste, zeile)
      ergebnis.geschrieben += 1
    } catch (fehler) {
      if (fehler instanceof MaterialGenuegtNicht) {
        ergebnis.ohneMeldung += 1
        try {
          await dienste.funde.updateOne(zeile.id, {
            entwurf_bedenken: KEIN_ENTWURF
          })
        } catch (schreibfehler) {
          dienste.logger?.warn(
            schreibfehler,
            `buschtelefon: Vermerk auf ${zeile.id} nicht geschrieben.`
          )
        }
        continue
      }
      // The class and code only: a model's answer or a provider's text
      // never reaches the log, the stored result or the desk.
      dienste.logger?.warn(
        fehlerKennung(fehler),
        `buschtelefon: Entwurf zu ${zeile.id} fehlgeschlagen.`
      )
      ergebnis.fehler.push(
        `${fundBezeichnung(zeile)} — Entwurf fehlgeschlagen: ${fehlerSatz(fehler)}`
      )
    }
  }

  if (ergebnis.geschrieben > 0 || ergebnis.wartend.length > 0)
    dienste.logger?.info(
      `buschtelefon: ${ergebnis.geschrieben} Entwuerfe geschrieben, ${ergebnis.wartend.length} warten.`
    )
  return ergebnis
}

async function liesDatengrundlage(
  meldungen: LeseDienst,
  id: string
): Promise<unknown> {
  const [zeile] = (await meldungen.readByQuery({
    filter: { id: { _eq: id } },
    fields: ['datengrundlage'],
    limit: 1
  })) as Array<{ datengrundlage?: unknown }>
  return zeile?.datengrundlage ?? null
}

/**
 * The chat revision: the source line comes off before the prompt is built
 * (the model would copy it) and goes back on after. The find is handed in
 * FRESH by the caller — its material may have been emptied since the first
 * write, and then only the editor's stored additions carry a revision.
 */
export async function ueberarbeiteBuschtelefon(
  dienste: FundMeldungDienste,
  meldung: {
    id: string
    titel: string | null
    lead: string | null
    text: string | null
    /** Read here when the caller does not hand it over. */
    datengrundlage?: unknown
  },
  zeile: FundRohzeile,
  anweisung: string,
  /** The editor's additions stored with the article (`ergaenzungAus(datengrundlage)`), or null. */
  ergaenzung: string | null = null
): Promise<string[]> {
  if (!hatSchreibMaterial(zeile, ergaenzung)) throw new FundOhneMaterial()
  const fakten = fundFakten(zeile, ergaenzung)
  const { bericht, warnungen, bedenken } = await fundMeldungMitChecks(
    fakten,
    buildBuschtelefonRevision(
      fakten,
      { ...meldung, text: ohneQuelle(meldung.text) },
      anweisung,
      dienste.regeln
    ),
    dienste.send
  )

  // The source line AND `datengrundlage` from the row as it stands now
  // (decision 6): a group that turned out closed since the first write must
  // not keep its post permalink in `quelle_url` behind a rewritten line.
  const grundlage =
    meldung.datengrundlage !== undefined
      ? meldung.datengrundlage
      : await liesDatengrundlage(dienste.meldungen, meldung.id)
  const neu = quelleNeuSetzen(
    { text: bericht.text, datengrundlage: grundlage },
    zeile
  )
  await dienste.meldungen.updateOne(meldung.id, {
    titel: bericht.titel,
    lead: bericht.lead,
    text: mitQuelle(bericht.text, zeile),
    datengrundlage:
      ergaenzung !== null && !('ergaenzung' in neu.datengrundlage)
        ? { ...neu.datengrundlage, ergaenzung }
        : neu.datengrundlage,
    zeit_warnungen: warnungen.length > 0 ? warnungen : null,
    verarbeitung: 'idle',
    anweisung: null,
    fehler: null
  })
  await dienste.funde.updateOne(zeile.id, { entwurf_bedenken: bedenken })
  return warnungen
}
