// The Directus-bound half of the Buschtelefon desk: the hourly pick-up with
// its upsert, the cleanup, and the Meldung written from one find.
//
// Services are injected as the small interfaces below, so everything here is
// tested against stubs. No environment is read here either: the caller hands
// the access in (`liesZugang`).

import {
  BuschtelefonFehler,
  holeAlle,
  seitFuer,
  type FetchLike,
  type Zugang,
  type ZugangsErgebnis
} from '../shared/buschtelefon/client'
import { completeJson } from '../shared/claude'
import { schreibeEinmalMitNachfassen } from './gemeindemeldungen'
import {
  aenderung,
  aufraeumAktion,
  BUSCHTELEFON_SYSTEM_PROMPT,
  bedenkenAus,
  buildBuschtelefonPrompt,
  buildBuschtelefonRevision,
  buschtelefonFakten,
  datengrundlageVon,
  FUND_FELDER,
  fundPayload,
  gemeindeKarte,
  hatMaterial,
  herkunftsWarnung,
  mitQuelle,
  parseMeldungstext,
  pruefungen,
  type BuschtelefonFakten,
  type FundRohzeile
} from './buschtelefon'

export interface LeseDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown>
}

export interface FundDienst extends LeseDienst {
  createOne(payload: Record<string, unknown>): Promise<string | number>
  updateOne(
    key: string,
    payload: Record<string, unknown>
  ): Promise<string | number>
  updateMany(keys: string[], payload: Record<string, unknown>): Promise<unknown>
  deleteMany(keys: string[]): Promise<unknown>
}

export interface Logger {
  info: (m: string) => void
  warn: (e: unknown, m?: string) => void
}

/** How many finds one existence check asks for — keeps the `_in` list modest. */
const BLOCK = 100

// ---------------------------------------------------------------------------
// 1. The pick-up
// ---------------------------------------------------------------------------

export type AbholStatus = 'ok' | 'nicht_eingerichtet' | 'fehler'

export interface AbholErgebnis {
  status: AbholStatus
  /** Names of the environment variables that are missing — never their values. */
  fehlend: string[]
  /** Where this read started (null: the first read, no stand yet). */
  seit: string | null
  seiten: number
  gelesen: number
  neu: number
  aktualisiert: number
  unveraendert: number
  /** Finds stored without a municipality: the door's slug is not one of ours. */
  ohneGemeinde: number
  /** Finds the door sent that failed validation — counted, never stored. */
  ungueltig: number
  /** What the door itself held back because it has no link to the original. */
  ohneLink: number
  aufgeraeumt: { verfallen: number; geloescht: number }
  fehler: string[]
  /** The newest `erfasst_am` the desk holds after this read. */
  stand: string | null
}

function leeresErgebnis(): AbholErgebnis {
  return {
    status: 'ok',
    fehlend: [],
    seit: null,
    seiten: 0,
    gelesen: 0,
    neu: 0,
    aktualisiert: 0,
    unveraendert: 0,
    ohneGemeinde: 0,
    ungueltig: 0,
    ohneLink: 0,
    aufgeraeumt: { verfallen: 0, geloescht: 0 },
    fehler: [],
    stand: null
  }
}

/**
 * The stored stand: the newest `erfasst_am` of any row of the desk. Derived
 * from the rows themselves, so it can never run ahead of what was actually
 * stored — a failed write leaves it where it was.
 */
export async function ladeStand(funde: LeseDienst): Promise<string | null> {
  const [neuester] = (await funde.readByQuery({
    sort: ['-erfasst_am'],
    fields: ['erfasst_am'],
    limit: 1
  })) as Array<{ erfasst_am: string | null }>
  return neuester?.erfasst_am ?? null
}

function fehlerText(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : 'Unbekannter Fehler'
}

/** A unique-violation is a row another run stored a moment ago — no error. */
function istDoppelt(fehler: unknown): boolean {
  return /unique|duplicate|RECORD_NOT_UNIQUE/i.test(fehlerText(fehler))
}

export interface AbholKontext {
  funde: FundDienst
  gemeinden: LeseDienst
  zugang: ZugangsErgebnis
  holen: FetchLike
  jetzt?: Date
  limit?: number
  logger: Logger
}

/**
 * One pick-up: read from the stand minus two hours, page by page, upsert by
 * `kennung`, then clean up. Never throws for a thing the world can do — a
 * missing variable, a turned-away request, a bad find — it reports.
 */
export async function holeFunde(kontext: AbholKontext): Promise<AbholErgebnis> {
  const ergebnis = leeresErgebnis()

  if (!kontext.zugang.ok) {
    // Not an error, not a log line: a host without the variables has no
    // feed. The result (and the desk) names what is missing.
    ergebnis.status = 'nicht_eingerichtet'
    ergebnis.fehlend = kontext.zugang.fehlend
    return ergebnis
  }
  const zugang: Zugang = kontext.zugang.zugang

  const stand = await ladeStand(kontext.funde)
  ergebnis.seit = seitFuer(stand)
  ergebnis.stand = stand

  let abholung: Awaited<ReturnType<typeof holeAlle>>
  try {
    abholung = await holeAlle(
      zugang,
      {
        seit: ergebnis.seit,
        ...(kontext.limit === undefined ? {} : { limit: kontext.limit })
      },
      kontext.holen
    )
  } catch (fehler) {
    ergebnis.status = 'fehler'
    ergebnis.fehler.push(
      fehler instanceof BuschtelefonFehler ? fehler.message : fehlerText(fehler)
    )
    return ergebnis
  }

  ergebnis.seiten = abholung.seiten
  ergebnis.gelesen = abholung.funde.length
  ergebnis.ungueltig = abholung.ungueltig
  ergebnis.ohneLink = abholung.ohneLink
  if (abholung.abbruch !== null) {
    ergebnis.status = 'fehler'
    ergebnis.fehler.push(abholung.abbruch.message)
  }

  const gemeinden = gemeindeKarte(
    (await kontext.gemeinden.readByQuery({
      filter: { aktiv: { _eq: true } },
      fields: ['id', 'name'],
      limit: -1
    })) as Array<{ id: string; name: string }>
  )

  // The finds arrive oldest first. A write that fails ends the loop: the
  // stand is the newest row stored, so going on past a gap would move it over
  // a find that was never stored.
  for (let von = 0; von < abholung.funde.length; von += BLOCK) {
    const block = abholung.funde.slice(von, von + BLOCK)
    const vorhanden = new Map(
      (
        (await kontext.funde.readByQuery({
          filter: { kennung: { _in: block.map((f) => f.kennung) } },
          fields: ['id', 'kennung', 'gemeinde', ...ZU_VERGLEICHEN],
          limit: -1
        })) as Array<Record<string, unknown> & { id: string; kennung: string }>
      ).map((z) => [z.kennung, z] as const)
    )

    for (const fund of block) {
      const payload = fundPayload(fund, gemeinden)
      const bestehend = vorhanden.get(fund.kennung)
      try {
        if (bestehend === undefined) {
          await kontext.funde.createOne({ ...payload, entscheid: 'offen' })
          ergebnis.neu += 1
          if (payload.gemeinde === null) ergebnis.ohneGemeinde += 1
        } else {
          const diff = aenderung(bestehend, payload)
          if (diff === null) {
            ergebnis.unveraendert += 1
          } else {
            await kontext.funde.updateOne(bestehend.id, diff)
            ergebnis.aktualisiert += 1
          }
        }
      } catch (fehler) {
        if (bestehend === undefined && istDoppelt(fehler)) {
          ergebnis.unveraendert += 1
          continue
        }
        ergebnis.status = 'fehler'
        ergebnis.fehler.push(
          `Fund ${fund.kennung} nicht gespeichert: ${fehlerText(fehler)}`
        )
        return finish(kontext, ergebnis)
      }
    }
  }

  return finish(kontext, ergebnis)
}

const ZU_VERGLEICHEN = [
  'gemeinde_slug',
  'kanton',
  'quelle_name',
  'link',
  'titel',
  'text',
  'zusammenfassung',
  'artikel_text',
  'kommentare',
  'n_kommentare',
  'n_reaktionen',
  'n_geteilt',
  'doublette_von',
  'bildtext',
  'pruefsumme'
]

async function finish(
  kontext: AbholKontext,
  ergebnis: AbholErgebnis
): Promise<AbholErgebnis> {
  try {
    ergebnis.aufgeraeumt = await raeumeFundeAuf(
      kontext.funde,
      kontext.jetzt ?? new Date(),
      kontext.logger
    )
  } catch (fehler) {
    // Housekeeping never costs the run its work.
    ergebnis.fehler.push(`Aufräumen: ${fehlerText(fehler)}`)
  }
  try {
    ergebnis.stand = await ladeStand(kontext.funde)
  } catch {
    // The stand in the result is a courtesy.
  }
  return ergebnis
}

// ---------------------------------------------------------------------------
// 2. Cleanup — raw finds of private persons do not stay
// ---------------------------------------------------------------------------

/**
 * Marks open finds older than the door's window `verfallen`, deletes
 * rejected and lapsed ones after `LOESCH_TAGE`. A taken-over find stays.
 */
export async function raeumeFundeAuf(
  funde: FundDienst,
  jetzt: Date,
  logger: Logger
): Promise<{ verfallen: number; geloescht: number }> {
  const zeilen = (await funde.readByQuery({
    filter: { entscheid: { _in: ['offen', 'abgelehnt', 'verfallen'] } },
    fields: ['id', 'entscheid', 'erfasst_am'],
    limit: -1
  })) as Array<{ id: string; entscheid: string; erfasst_am: string | null }>

  const verfallen: string[] = []
  const loeschen: string[] = []
  for (const zeile of zeilen) {
    const aktion = aufraeumAktion(zeile, jetzt)
    if (aktion === 'verfallen') verfallen.push(zeile.id)
    else if (aktion === 'loeschen') loeschen.push(zeile.id)
  }
  if (verfallen.length > 0)
    await funde.updateMany(verfallen, { entscheid: 'verfallen' })
  if (loeschen.length > 0) await funde.deleteMany(loeschen)
  if (verfallen.length + loeschen.length > 0)
    logger.info(
      `buschtelefon: ${verfallen.length} Funde verfallen, ${loeschen.length} gelöscht.`
    )
  return { verfallen: verfallen.length, geloescht: loeschen.length }
}

// ---------------------------------------------------------------------------
// 3. The Meldung
// ---------------------------------------------------------------------------

/** A find without a municipality cannot become a Meldung: the editor sets one first. */
export class FundOhneGemeinde extends Error {
  constructor() {
    super('Der Fund hat keine Gemeinde.')
    this.name = 'FundOhneGemeinde'
  }
}

export interface GeschriebeneFundMeldung {
  bericht: { titel: string; lead: string; text: string }
  warnungen: string[]
}

/**
 * The article, with the checks that make its rules real: the source named
 * as social networks AND «nicht bestätigt» (retried once), digits against
 * the material, absolute dates, no addresses, phone numbers or e-mails, no
 * named source, no named person, no verbatim copy of the post.
 */
export async function fundMeldungMitChecks(
  fakten: BuschtelefonFakten,
  prompt: string
): Promise<GeschriebeneFundMeldung> {
  let antwort = await schreibeEinmalMitNachfassen(
    prompt,
    BUSCHTELEFON_SYSTEM_PROMPT,
    'buschtelefon:meldung'
  )
  let bericht = parseMeldungstext(antwort)

  if (herkunftsWarnung(`${bericht.lead} ${bericht.text}`) !== null) {
    antwort = await completeJson<unknown>({
      zweck: 'buschtelefon:meldung:nachfassen',
      system: BUSCHTELEFON_SYSTEM_PROMPT,
      prompt: buildBuschtelefonRevision(
        fakten,
        bericht,
        'Nenne die Herkunft im Fliesstext ("wie in sozialen Netzwerken der Gemeinde berichtet wird") und sage ausdruecklich, dass die Angaben nicht bestaetigt sind.'
      ),
      maxTokens: 1500
    })
    bericht = parseMeldungstext(antwort)
  }

  return {
    bericht,
    warnungen: pruefungen(bericht, fakten, bedenkenAus(antwort))
  }
}

export interface MeldungsDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  createOne(payload: Record<string, unknown>): Promise<string | number>
}

/** One Meldung from one find — the way the button takes. The find becomes `uebernommen`. */
export async function schreibeFundMeldung(
  kontext: {
    funde: Pick<FundDienst, 'updateOne'>
    meldungen: MeldungsDienst
    regeln?: readonly string[]
  },
  zeile: FundRohzeile
): Promise<{ meldung: string; warnungen: string[] }> {
  if (zeile.gemeinde === null) throw new FundOhneGemeinde()
  const fakten = buschtelefonFakten({
    ...zeile,
    gemeinde: zeile.gemeinde
  })
  const { bericht, warnungen } = await fundMeldungMitChecks(
    fakten,
    buildBuschtelefonPrompt(fakten, kontext.regeln ?? [])
  )

  const meldungId = (await kontext.meldungen.createOne({
    buschtelefon_fund: zeile.id,
    gemeinde: zeile.gemeinde.id,
    titel: bericht.titel,
    lead: bericht.lead,
    text: mitQuelle(bericht.text, fakten),
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: warnungen,
    datengrundlage: datengrundlageVon()
  })) as string

  await kontext.funde.updateOne(zeile.id, { entscheid: 'uebernommen' })
  return { meldung: meldungId, warnungen }
}

export { FUND_FELDER, hatMaterial }
