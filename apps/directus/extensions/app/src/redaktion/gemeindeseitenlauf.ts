// The Directus-bound half of the municipal-news desk: the cleanup and the
// Sichtung, shared by the 13:00 run and the "Jetzt prüfen" button.
//
// Services are injected as the small interfaces below, so both functions are
// tested against stubs. No fetching here — the reader hands rows in.

import { completeJson, type MessageSender } from '../shared/claude'
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
  parseSichtung,
  SICHTUNG_SCHEMA,
  SICHTUNG_SYSTEM_PROMPT,
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
    fields: ['id', 'entscheid', 'vorschlag', 'publiziert_am', 'date_created'],
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

  const zeilen: SichtungsZeile[] = neue.map((z) => ({
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
        : null
  }))

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
  let sichtungsFehler: string | null = null
  try {
    const antwort = await completeJson<unknown>(
      {
        system: SICHTUNG_SYSTEM_PROMPT,
        prompt: buildSichtungPrompt(
          gemeinde.name,
          zeilen,
          lernDigest(signale.entscheide, LERN_FENSTER, signale.rahmen),
          kontext.sichtungsregeln.text,
          kalender === null ? '' : abfuhrkalenderBlock(gemeinde.name, kalender)
        ),
        maxTokens: 4096,
        ...(kontext.model == null ? {} : { model: kontext.model }),
        schema: SICHTUNG_SCHEMA
      },
      kontext.send
    )
    for (const urteil of parseSichtung(antwort, zeilen)) {
      await kontext.mitteilungen.updateOne(urteil.id, {
        vorschlag: urteil.vorschlag,
        vorschlag_begruendung: urteil.begruendung
      })
      if (urteil.vorschlag) vorschlaege += 1
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
    sichtungsFehler = fehler instanceof Error ? fehler.message : String(fehler)
  }

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
