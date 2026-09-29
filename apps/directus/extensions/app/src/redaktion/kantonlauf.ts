// The Directus-bound half of the Kanton desk: the row builder, the cleanup
// and the Sichtung, shared by the 12:00 run and the "Jetzt prüfen" button.
//
// Services are injected as the small interfaces below, so everything here is
// tested against stubs. No fetching — `shared/kanton/` hands items in.

import { completeJson, type MessageSender } from '../shared/claude'
import type { Heute } from '../shared/gemeindeseite/datum'
import {
  behoerdeAusPfad,
  datumAus,
  oeffentlicheSeite,
  type Detail,
  type KantonListe,
  type ListenItem
} from '../shared/kanton/api'
import type { KantonQuelle } from '../types/schema'
import type { RegelZeile } from './gedaechtnis'
import {
  aufraeumAktionKanton,
  auszugVon,
  buildKantonSichtungPrompt,
  KANTON_SICHTUNG_SYSTEM_PROMPT,
  lernDigest,
  parseSichtung,
  SICHTUNG_SCHEMA,
  type KantonSichtungsZeile
} from './kanton'
import { automatischeWeitergabe, type NummerierteRegel } from './lernen'
import { ladeKantonSignale, LERN_FENSTER } from './lernsignale'
import { kantonsmitteilungAlsHinweis, reicheWeiter } from './weiterreichen'

export interface LeseDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown>
}

export interface KantonsmitteilungenDienst extends LeseDienst {
  updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
  updateMany(keys: string[], payload: Record<string, unknown>): Promise<unknown>
  deleteMany(keys: string[]): Promise<unknown>
}

export interface Logger {
  info: (m: string) => void
  warn: (e: unknown, m?: string) => void
}

// ---------------------------------------------------------------------------
// 1. Rows — one per (item, municipality it names)
// ---------------------------------------------------------------------------

export interface KantonsZeilePayload {
  gemeinde: string
  url: string
  quelle: KantonQuelle
  behoerde: string
  titel: string
  teaser: string | null
  text: string | null
  text_abgeschnitten: boolean
  publiziert_am: string | null
  gelesen_am: string
  hinweise: string[] | null
  gemeinden_genannt: string[]
  entscheid: 'offen'
}

/**
 * The stored rows for one item: one per covered municipality it names, all
 * with the same public page as `url` — which is why `(url, gemeinde)` is
 * the identity and not `url`. Every inference is written into `hinweise`.
 */
export function zeilenAus(eingabe: {
  item: ListenItem
  detail: Detail
  liste: KantonListe
  getroffene: ReadonlyArray<{ id: string; name: string }>
  seite: string
  heute: Heute
  gelesenAm: string
}): KantonsZeilePayload[] {
  const { item, detail, liste, getroffene, seite } = eingabe
  const url = oeffentlicheSeite(item.id, seite)
  if (url === null || getroffene.length === 0) return []

  const hinweise: string[] = []
  const { datum, quelle: datumQuelle } = datumAus(
    detail.newsDate,
    detail.effective,
    eingabe.heute
  )
  if (datumQuelle === 'effective')
    hinweise.push('Datum aus dem Publikationszeitpunkt der Liste abgeleitet')
  if (datumQuelle === 'keins') hinweise.push('Kein Datum gefunden')
  if (detail.textAbgeschnitten) hinweise.push('Text gekürzt')
  if (detail.text.trim() === '') hinweise.push('Kein Text gefunden')

  const namen = getroffene.map((g) => g.name)
  return getroffene.map((g) => ({
    gemeinde: g.id,
    url,
    quelle: liste.kennung,
    behoerde: behoerdeAusPfad(detail.pfad),
    titel: detail.titel ?? item.titel,
    teaser: detail.teaser ?? item.teaser,
    text: detail.text.trim() === '' ? null : detail.text,
    text_abgeschnitten: detail.textAbgeschnitten,
    publiziert_am: datum,
    gelesen_am: eingabe.gelesenAm,
    hinweise: hinweise.length === 0 ? null : hinweise,
    gemeinden_genannt: namen,
    entscheid: 'offen'
  }))
}

// ---------------------------------------------------------------------------
// 2. Cleanup — the desk empties itself
// ---------------------------------------------------------------------------

/**
 * Marks lapsed proposals `verfallen`, deletes stale unproposed rows. Wrapped
 * in its own try/catch by the caller — housekeeping never costs the run its work.
 */
export async function raeumeKantonsmitteilungenAuf(
  mitteilungen: KantonsmitteilungenDienst,
  heute: string,
  fensterTage: number,
  logger: Logger
): Promise<{ geloescht: number; verfallen: number }> {
  const offene = (await mitteilungen.readByQuery({
    filter: { entscheid: { _eq: 'offen' } },
    fields: ['id', 'entscheid', 'vorschlag', 'publiziert_am', 'date_created'],
    limit: -1
  })) as Array<{
    id: string
    entscheid: string
    vorschlag: boolean | null
    publiziert_am: string | null
    date_created: string | null
  }>

  const loeschen: string[] = []
  const verfallen: string[] = []
  for (const zeile of offene) {
    const aktion = aufraeumAktionKanton(zeile, heute, fensterTage)
    if (aktion === 'loeschen') loeschen.push(zeile.id)
    else if (aktion === 'verfallen') verfallen.push(zeile.id)
  }
  if (verfallen.length > 0)
    await mitteilungen.updateMany(verfallen, { entscheid: 'verfallen' })
  if (loeschen.length > 0) await mitteilungen.deleteMany(loeschen)
  if (loeschen.length + verfallen.length > 0) {
    logger.info(
      `kanton: ${verfallen.length} Vorschlaege verfallen, ${loeschen.length} Zeilen geloescht.`
    )
  }
  return { geloescht: loeschen.length, verfallen: verfallen.length }
}

// ---------------------------------------------------------------------------
// 3. Sichtung — one call per municipality, sorts, never filters
// ---------------------------------------------------------------------------

/** A freshly stored row, as the Sichtung needs it. */
export interface ZeileFuerKantonSichtung {
  id: string
  titel: string
  teaser: string | null
  text: string | null
  publiziert_am: string | null
  quelle: KantonQuelle
  behoerde: string | null
  gemeinden_genannt: string[] | null
  text_abgeschnitten: boolean
}

export interface KantonSichtungKontext {
  mitteilungen: KantonsmitteilungenDienst
  hinweise: LeseDienst & {
    createOne(payload: Record<string, unknown>): Promise<unknown>
  }
  meldungen: LeseDienst
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
 * One Sonnet call over a municipality's new cantonal notices. Steered by the
 * desk's rules and this municipality's decision history; a rule the editor
 * armed may hand an item to the Chefredaktion by itself, as a lead.
 */
export async function sichteKantonsmitteilungen(
  neue: readonly ZeileFuerKantonSichtung[],
  gemeinde: { id: string; name: string },
  kontext: KantonSichtungKontext
): Promise<{
  vorschlaege: number
  weitergereicht: number
  /** Why the model call failed, for the run's result; null when it did not. */
  fehler: string | null
}> {
  if (neue.length === 0)
    return { vorschlaege: 0, weitergereicht: 0, fehler: null }

  const zeilen: KantonSichtungsZeile[] = neue.map((z) => ({
    id: z.id,
    titel: z.titel,
    auszug: auszugVon(z),
    publiziertAm: z.publiziert_am,
    quelle: z.quelle,
    behoerde: z.behoerde,
    weitereGemeinden: (z.gemeinden_genannt ?? []).filter(
      (n) => n !== gemeinde.name
    ),
    textAbgeschnitten: z.text_abgeschnitten
  }))

  const signale = await ladeKantonSignale(
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
        system: KANTON_SICHTUNG_SYSTEM_PROMPT,
        prompt: buildKantonSichtungPrompt(
          gemeinde.name,
          zeilen,
          lernDigest(signale.entscheide, LERN_FENSTER, signale.rahmen),
          kontext.sichtungsregeln.text
        ),
        // The municipal desk's ceiling, for the same reason: a truncated
        // answer costs the whole municipality its Sichtung.
        maxTokens: 8000,
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
    // and the run says so.
    kontext.logger.warn(
      fehler,
      `kanton: Sichtung fuer ${gemeinde.name} fehlgeschlagen.`
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
          'quelle',
          'behoerde',
          'publiziert_am',
          'teaser',
          'text',
          'vorschlag_begruendung',
          'gemeinde.id'
        ],
        limit: 1
      })) as Array<Parameters<typeof kantonsmitteilungAlsHinweis>[0]>
      if (voll === undefined) continue
      await reicheWeiter(
        { hinweise: kontext.hinweise, ursprung: kontext.mitteilungen },
        {
          ursprungId: zeileId,
          felder: kantonsmitteilungAlsHinweis(
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
        `kanton: Automatisches Weiterreichen von ${zeileId} fehlgeschlagen.`
      )
    }
  }

  return { vorschlaege, weitergereicht, fehler: sichtungsFehler }
}
