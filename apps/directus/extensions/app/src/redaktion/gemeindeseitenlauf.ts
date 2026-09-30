// The Directus-bound half of the municipal-news desk: the cleanup and the
// Sichtung, shared by the 13:00 run and the "Jetzt prüfen" button.
//
// Services are injected as the small interfaces below, so both functions are
// tested against stubs. No fetching here — the reader hands rows in.

import { parseStufenSichtung, STUFEN_SCHEMA } from './sichtung'
import {
  istVorschlag,
  STANDARD_EINSTELLUNG,
  type Tischeinstellung
} from './tischeinstellungen'
import {
  cacheableSystem,
  completeJson,
  type MessageSender
} from '../shared/claude'
import { pakete, SICHTUNG_AUFRUF, sichtungsFehlerText } from './sichtungspakete'
import { verschiebe } from './feiertage'
import type { RegelZeile } from './gedaechtnis'
import {
  abfuhrAbgleich,
  abfuhrkalenderBlock,
  aufraeumAktion,
  auszugVon,
  buildSichtungPrompt,
  hatAbfuhrbezug,
  heuteFuer,
  lernDigest,
  SICHTUNG_SYSTEM_PROMPT,
  sichtungsAuswahl,
  VORBEI_BEGRUENDUNG,
  type AbfuhrTermin,
  type AufraeumZeile,
  type SichtungsZeile
} from './gemeindeseite'
import { automatischeWeitergabe, type NummerierteRegel } from './lernen'
import { ladeGemeindeSignale, LERN_FENSTER } from './lernsignale'
import { mitteilungAlsHinweis, reicheWeiter } from './weiterreichen'

export interface LeseDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown>
}

export interface MitteilungenDienst extends LeseDienst {
  updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
  updateMany(keys: string[], payload: Record<string, unknown>): Promise<unknown>
  deleteMany(keys: string[]): Promise<unknown>
}

export interface Logger {
  info: (m: string) => void
  warn: (e: unknown, m?: string) => void
}

/**
 * Marks lapsed proposals `verfallen`, deletes stale unproposed rows. Wrapped
 * in its own try/catch by the caller — housekeeping never costs the run its work.
 */
export async function raeumeMitteilungenAuf(
  mitteilungen: MitteilungenDienst,
  heute: string,
  fensterTage: number,
  logger: Logger
): Promise<{ geloescht: number; verfallen: number }> {
  const offene = (await mitteilungen.readByQuery({
    filter: { entscheid: { _eq: 'offen' } },
    fields: [
      'id',
      'entscheid',
      'vorschlag',
      'publiziert_am',
      'veranstaltung_am',
      'date_created'
    ],
    limit: -1
  })) as AufraeumZeile[]

  const loeschen: string[] = []
  const verfallen: string[] = []
  for (const zeile of offene) {
    const aktion = aufraeumAktion(zeile, heute, fensterTage)
    if (aktion === 'loeschen') loeschen.push(zeile.id)
    else if (aktion === 'verfallen') verfallen.push(zeile.id)
  }
  if (verfallen.length > 0)
    await mitteilungen.updateMany(verfallen, { entscheid: 'verfallen' })
  if (loeschen.length > 0) await mitteilungen.deleteMany(loeschen)
  if (loeschen.length + verfallen.length > 0) {
    logger.info(
      `gemeindeseiten: ${verfallen.length} Vorschlaege verfallen, ${loeschen.length} Zeilen geloescht.`
    )
  }
  return { geloescht: loeschen.length, verfallen: verfallen.length }
}

export interface Abfuhrkalender {
  vorhanden: boolean
  termine: AbfuhrTermin[]
  merkblatt: string | null
}

/** Two weeks back, three months ahead: what an announcement could be talking about. */
export const KALENDER_TAGE_ZURUECK = 14
export const KALENDER_TAGE_VORAUS = 90

/** The municipality's collection dates around today, plus the regular collections the calendar notes. */
export async function ladeAbfuhrkalender(
  termine: LeseDienst,
  kalender: LeseDienst,
  gemeindeId: string,
  heute: string
): Promise<Abfuhrkalender> {
  const kalenderZeilen = (await kalender.readByQuery({
    filter: { gemeinde: { _eq: gemeindeId } },
    fields: ['id', 'jahr', 'merkblatt'],
    sort: ['-jahr'],
    limit: 1
  })) as Array<{ id: string; jahr: number; merkblatt: string | null }>
  const aktuell = kalenderZeilen[0]
  if (aktuell === undefined)
    return { vorhanden: false, termine: [], merkblatt: null }

  const zeilen = (await termine.readByQuery({
    filter: {
      kalender: { gemeinde: { _eq: gemeindeId } },
      datum: {
        _between: [
          verschiebe(heute, -KALENDER_TAGE_ZURUECK),
          verschiebe(heute, KALENDER_TAGE_VORAUS)
        ]
      }
    },
    fields: ['kategorie', 'zone', 'datum'],
    sort: ['datum'],
    limit: -1
  })) as AbfuhrTermin[]

  return { vorhanden: true, termine: zeilen, merkblatt: aktuell.merkblatt }
}

/** A freshly stored row, as the Sichtung needs it. */
export interface ZeileFuerSichtung {
  id: string
  titel: string
  teaser: string | null
  text: string | null
  publiziert_am: string | null
  kategorie: string | null
  text_abgeschnitten: boolean
  anhaenge: ReadonlyArray<{ gelesen: boolean }> | null
  /** Set on an events row; a past one is judged by code, never by the model. */
  veranstaltung_am: string | null
}

export interface SichtungKontext {
  mitteilungen: MitteilungenDienst
  hinweise: LeseDienst & {
    createOne(payload: Record<string, unknown>): Promise<unknown>
  }
  meldungen: LeseDienst
  termine: LeseDienst
  kalender: LeseDienst
  regelzeilen: readonly RegelZeile[]
  sichtungsregeln: {
    text: string
    nummern: ReadonlyMap<string, NummerierteRegel>
  }
  heute: string
  logger: Logger
  model?: string | null
  send?: MessageSender
  /** The desk's threshold; the standard when the run has no row. */
  einstellung?: Tischeinstellung
}

/**
 * One Sonnet call over a municipality's new items: sorts, never filters.
 * Steered by the desk's rules, this municipality's decision history and —
 * where an item talks about collections — its waste calendar. A rule the
 * editor armed may hand an item to the Chefredaktion by itself, as a lead.
 */
export async function sichteMitteilungen(
  neue: readonly ZeileFuerSichtung[],
  gemeinde: { id: string; name: string },
  kontext: SichtungKontext
): Promise<{
  vorschlaege: number
  weitergereicht: number
  /** Why the model call failed, for the run's result and the municipality's status line; null when it did not. */
  fehler: string | null
}> {
  if (neue.length === 0)
    return { vorschlaege: 0, weitergereicht: 0, fehler: null }
  const heute = heuteFuer(kontext.heute)

  const kalender = neue.some(hatAbfuhrbezug)
    ? await ladeAbfuhrkalender(
        kontext.termine,
        kontext.kalender,
        gemeinde.id,
        kontext.heute
      )
    : null

  const alle: SichtungsZeile[] = neue.map((z) => ({
    id: z.id,
    titel: z.titel,
    auszug: auszugVon(z),
    publiziertAm: z.publiziert_am,
    kategorie: z.kategorie,
    textAbgeschnitten: z.text_abgeschnitten,
    anhaenge: z.anhaenge?.length ?? 0,
    anhaengeGelesen: z.anhaenge?.filter((a) => a.gelesen).length ?? 0,
    abfuhr:
      kalender !== null && kalender.vorhanden && hatAbfuhrbezug(z)
        ? abfuhrAbgleich(z, kalender.termine, heute)
        : null,
    veranstaltungAm: z.veranstaltung_am
  }))

  // An event that has already happened is decided by code, not by the model:
  // a date comparison needs no tokens, and the row still says on the desk why
  // it is no proposal instead of showing an unjudged null.
  const { zuBeurteilen: zeilen, vorbei } = sichtungsAuswahl(alle, kontext.heute)
  for (const z of vorbei) {
    try {
      await kontext.mitteilungen.updateOne(z.id, {
        vorschlag: false,
        vorschlag_begruendung: VORBEI_BEGRUENDUNG
      })
    } catch (fehler) {
      kontext.logger.warn(
        fehler,
        `gemeindeseiten: Vergangener Termin ${z.id} nicht vermerkt.`
      )
    }
  }
  if (zeilen.length === 0)
    return { vorschlaege: 0, weitergereicht: 0, fehler: null }

  const signale = await ladeGemeindeSignale(
    {
      zeilen: kontext.mitteilungen,
      hinweise: kontext.hinweise,
      meldungen: kontext.meldungen
    },
    gemeinde.id,
    kontext.heute
  )

  const weiterzureichen = new Map<string, NummerierteRegel>()
  let vorschlaege = 0
  const schwelle = (kontext.einstellung ?? STANDARD_EINSTELLUNG).schwelle
  const digest = lernDigest(signale.entscheide, LERN_FENSTER, signale.rahmen)
  const kalenderBlock =
    kalender === null ? '' : abfuhrkalenderBlock(gemeinde.name, kalender)
  // In packets (`sichtungspakete.ts`): a failed packet costs its own rows,
  // never the municipality's whole judgement.
  const paketListe = pakete(zeilen)
  const fehlerPakete: string[] = []
  for (const paket of paketListe) {
    try {
      const antwort = await completeJson<unknown>(
        {
          zweck: 'gemeindeseiten:sichtung',
          system: cacheableSystem(SICHTUNG_SYSTEM_PROMPT),
          prompt: buildSichtungPrompt(
            gemeinde.name,
            paket,
            digest,
            kontext.sichtungsregeln.text,
            kalenderBlock
          ),
          // Room, deliberately. The answer carries one verdict with a written
          // reason per item, and a truncated answer costs the WHOLE municipality
          // its Sichtung: `completeJson` throws on `max_tokens`, so not one of
          // the day's items is judged and every one of them sits on the desk
          // unsorted. That happened to Aesch on 18 September 2026 at 4096, with
          // the Abfuhrkalender block in its prompt on top of the items. The
          // ceiling costs nothing unless it is used, and 8000 is the house's
          // highest budget that still goes out as a plain request (the SDK
          // streams from 8192 up) — cheaper than a lost judgement by any measure.
          ...SICHTUNG_AUFRUF,
          ...(kontext.model == null ? {} : { model: kontext.model }),
          schema: STUFEN_SCHEMA
        },
        kontext.send
      )
      for (const urteil of parseStufenSichtung(antwort, paket)) {
        // The grade is the model's, the threshold the newsroom's: stored
        // apart, so a changed dial re-sorts the desk without a second call.
        const vorschlag = istVorschlag(urteil.stufe, schwelle)
        await kontext.mitteilungen.updateOne(urteil.id, {
          vorschlag,
          vorschlag_wert: urteil.stufe,
          vorschlag_begruendung: urteil.begruendung
        })
        if (vorschlag) vorschlaege += 1
        const regel = automatischeWeitergabe(
          urteil,
          kontext.sichtungsregeln.nummern,
          kontext.regelzeilen
        )
        if (regel !== null) weiterzureichen.set(urteil.id, regel)
      }
    } catch (fehler) {
      // `vorschlag` stays null: "not judged", which the desk shows as such —
      // and the run says so, because thirty-two unjudged rows and a quiet log
      // line are how a broken schema went unnoticed for a whole first run.
      kontext.logger.warn(
        fehler,
        `gemeindeseiten: Sichtung fuer ${gemeinde.name} fehlgeschlagen.`
      )
      fehlerPakete.push(
        fehler instanceof Error ? fehler.message : String(fehler)
      )
    }
  }
  const sichtungsFehler = sichtungsFehlerText(fehlerPakete, paketListe.length)

  let weitergereicht = 0
  for (const [zeileId, regel] of weiterzureichen) {
    try {
      const [voll] = (await kontext.mitteilungen.readByQuery({
        filter: { id: { _eq: zeileId }, entscheid: { _eq: 'offen' } },
        fields: [
          'id',
          'titel',
          'url',
          'url_kanonisch',
          'publiziert_am',
          'kategorie',
          'teaser',
          'text',
          'anhaenge',
          'vorschlag_begruendung',
          'gemeinde.id'
        ],
        limit: 1
      })) as Array<Parameters<typeof mitteilungAlsHinweis>[0]>
      if (voll === undefined) continue
      await reicheWeiter(
        { hinweise: kontext.hinweise, ursprung: kontext.mitteilungen },
        {
          ursprungId: zeileId,
          felder: mitteilungAlsHinweis(
            voll,
            `Automatisch weitergereicht nach Regel: ${regel.regel}`
          ),
          automatisch: true,
          regel: regel.id
        }
      )
      weitergereicht += 1
    } catch (fehler) {
      kontext.logger.warn(
        fehler,
        `gemeindeseiten: Automatisches Weiterreichen von ${zeileId} fehlgeschlagen.`
      )
    }
  }

  return { vorschlaege, weitergereicht, fehler: sichtungsFehler }
}

/**
 * Re-applies the desk's threshold to every open, graded row — the run's half
 * of the dial: a threshold lowered in the gear at noon shows on the desk at
 * once (the workspace computes the same rule) and the next run writes the
 * drafts for what moved up. No model call; a row without a grade is left
 * exactly as it is.
 */
export async function gleicheSchwelleAb(
  dienst: {
    readByQuery(query: Record<string, unknown>): Promise<unknown[]>
    updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
  },
  einstellung: Tischeinstellung,
  logger: Logger
): Promise<number> {
  const zeilen = (await dienst.readByQuery({
    filter: { entscheid: { _eq: 'offen' }, vorschlag_wert: { _nnull: true } },
    fields: ['id', 'vorschlag', 'vorschlag_wert'],
    limit: -1
  })) as Array<{
    id: string
    vorschlag: boolean | null
    vorschlag_wert: number | null
  }>
  let geaendert = 0
  for (const z of zeilen) {
    const soll = istVorschlag(z.vorschlag_wert, einstellung.schwelle)
    if (soll === z.vorschlag) continue
    try {
      await dienst.updateOne(z.id, { vorschlag: soll })
      geaendert += 1
    } catch (fehler) {
      logger.warn(
        fehler,
        `gemeindeseiten: Schwelle auf ${z.id} nicht angewandt.`
      )
    }
  }
  return geaendert
}
