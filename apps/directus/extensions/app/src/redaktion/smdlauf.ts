// The Directus-bound half of the SMD desk: turning a read dossier into rows,
// the cleanup and the Sichtung, shared by the 14:45 run and the «Jetzt
// prüfen» button.
//
// Services are injected as the small interfaces below, so everything here is
// tested against stubs. No fetching of its own — `shared/smd/` hands the
// dossier in, `shared/verlage/` is asked for the address.

import {
  cacheableSystem,
  completeJson,
  type MessageSender
} from '../shared/claude'
import type { DossierLesung } from '../shared/smd/parse'
import type { Linksucher } from '../shared/verlage'
import type { SmdArt } from '../types/schema'
import { auszugMitFundstellen } from './auszug'
import type { RegelZeile } from './gedaechtnis'
import { automatischeWeitergabe, type NummerierteRegel } from './lernen'
import { ladeSmdSignale, LERN_FENSTER } from './lernsignale'
import { pakete, SICHTUNG_AUFRUF, sichtungsFehlerText } from './sichtungspakete'
import {
  aufraeumAktionSmd,
  AUSZUG_ZEICHEN,
  BLOG_FENSTER_TAGE,
  buildSmdSichtungPrompt,
  gekappterText,
  kandidatenAus,
  lernDigest,
  linkFelderAus,
  parseSichtung,
  SICHTUNG_SCHEMA,
  SMD_SICHTUNG_SYSTEM_PROMPT,
  vorfilter,
  type Kandidat,
  type LinkFelder,
  type SmdSichtungsZeile
} from './smd'
import { reicheWeiter, smdBeitragAlsHinweis } from './weiterreichen'

export interface LeseDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown>
}

export interface BeitraegeDienst extends LeseDienst {
  createOne(payload: Record<string, unknown>): Promise<unknown>
  updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
  updateMany(keys: string[], payload: Record<string, unknown>): Promise<unknown>
  deleteMany(keys: string[]): Promise<unknown>
}

export interface Logger {
  info: (m: string) => void
  warn: (e: unknown, m?: string) => void
}

function fehlerText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unbekannter Fehler'
}

// ---------------------------------------------------------------------------
// 1. Rows — one per (piece, municipality it names)
// ---------------------------------------------------------------------------

export interface SmdZeilePayload extends LinkFelder {
  dossier: string
  gemeinde: string
  schluessel: string
  art: SmdArt
  medium: string
  datum: string
  zeit: string | null
  blog: string | null
  rubrik: string | null
  titel: string
  lead: string | null
  autor: string | null
  text: string | null
  text_abgeschnitten: boolean
  seite_von: number
  seite_bis: number
  gemeinden_genannt: string[]
  hinweise: string[] | null
  entscheid: 'offen'
}

/** The stored rows for one candidate: one per covered municipality it names, the same link on all. */
export function zeilenAus(eingabe: {
  kandidat: Kandidat
  dossierId: string
  getroffene: ReadonlyArray<{ id: string; name: string }>
  link: LinkFelder
}): SmdZeilePayload[] {
  const { kandidat, getroffene } = eingabe
  const text = gekappterText(kandidat.text)
  const hinweise: string[] = []
  if (text.abgeschnitten) hinweise.push('Text gekürzt')
  if (kandidat.text.trim() === '') hinweise.push('Kein Text gefunden')
  const namen = getroffene.map((g) => g.name)
  return getroffene.map((g) => ({
    dossier: eingabe.dossierId,
    gemeinde: g.id,
    schluessel: kandidat.schluessel,
    art: kandidat.art,
    medium: kandidat.medium,
    datum: kandidat.datum,
    zeit: kandidat.zeit,
    blog: kandidat.blog,
    rubrik: kandidat.rubrik,
    titel: kandidat.titel.slice(0, 500),
    lead: kandidat.lead,
    autor: kandidat.autor === null ? null : kandidat.autor.slice(0, 200),
    text: text.text.trim() === '' ? null : text.text,
    text_abgeschnitten: text.abgeschnitten,
    seite_von: kandidat.seiteVon,
    seite_bis: kandidat.seiteBis,
    gemeinden_genannt: namen,
    hinweise: hinweise.length === 0 ? null : hinweise,
    entscheid: 'offen',
    ...eingabe.link
  }))
}

/** A freshly stored row, as the Sichtung needs it. */
export interface ZeileFuerSmdSichtung {
  id: string
  titel: string
  lead: string | null
  text: string | null
  datum: string
  medium: string
  blog: string | null
  gemeinden_genannt: string[] | null
  text_abgeschnitten: boolean
}

export interface DossierVerarbeitung {
  dokumente: number
  blogs: number
  /** Entries the blogs carried, in all. */
  blogEintraege: number
  /** Entries older than the window — archive, counted and never stored. */
  blogAlt: number
  kandidaten: number
  /** Candidates naming no covered municipality — SMD's search matched inside a word, or a passing mention of a town elsewhere. */
  ohneGemeinde: number
  /** (piece, municipality) pairs already stored from an earlier dossier — SMD's 26-hour window, or a blog brought whole again. */
  wiederholt: number
  neu: number
  links: {
    gefunden: number
    nichtGefunden: number
    keineTuer: number
    fehler: number
  }
  fehler: string[]
  /** The new rows, per municipality id — what the Sichtung works on. */
  angelegt: Map<string, ZeileFuerSmdSichtung[]>
}

export interface DossierKontext {
  dossierId: string
  /** ISO day of the dossier — anchors the blog window. */
  dossierDatum: string
  gemeinden: ReadonlyArray<{ id: string; name: string }>
  beitraege: BeitraegeDienst
  linksucher: Linksucher
  blogFensterTage?: number
  logger: Logger
}

/**
 * The rows of one dossier: every document, or a blog's new entries, that
 * names a covered municipality and is not already on the desk — with the
 * online address asked once per piece, not per municipality.
 */
export async function verarbeiteDossier(
  lesung: DossierLesung,
  kontext: DossierKontext
): Promise<DossierVerarbeitung> {
  const ergebnis: DossierVerarbeitung = {
    dokumente: lesung.dokumente.length,
    blogs: 0,
    blogEintraege: 0,
    blogAlt: 0,
    kandidaten: 0,
    ohneGemeinde: 0,
    wiederholt: 0,
    neu: 0,
    links: { gefunden: 0, nichtGefunden: 0, keineTuer: 0, fehler: 0 },
    fehler: [],
    angelegt: new Map()
  }
  const fenster = kontext.blogFensterTage ?? BLOG_FENSTER_TAGE

  const alle: Array<{
    kandidat: Kandidat
    getroffene: Array<{ id: string; name: string }>
  }> = []
  for (const dokument of lesung.dokumente) {
    if (dokument.blog !== null) {
      ergebnis.blogs += 1
      ergebnis.blogEintraege += dokument.blog.eintraege.length
    }
    const { kandidaten, blogAlt } = kandidatenAus(
      dokument,
      kontext.dossierDatum,
      fenster
    )
    ergebnis.blogAlt += blogAlt
    for (const kandidat of kandidaten) {
      ergebnis.kandidaten += 1
      const getroffene = vorfilter(kandidat, kontext.gemeinden)
      if (getroffene.length === 0) {
        ergebnis.ohneGemeinde += 1
        continue
      }
      alle.push({ kandidat, getroffene })
    }
  }
  if (alle.length === 0) return ergebnis

  // What is already on the desk, in one query over every key of this dossier.
  const schluessel = [...new Set(alle.map((a) => a.kandidat.schluessel))]
  const bekannt = new Set(
    (
      (await kontext.beitraege.readByQuery({
        filter: { schluessel: { _in: schluessel } },
        fields: ['schluessel', 'gemeinde'],
        limit: -1
      })) as Array<{ schluessel: string; gemeinde: string }>
    ).map((z) => `${z.schluessel}|${z.gemeinde}`)
  )

  for (const { kandidat, getroffene } of alle) {
    const neue = getroffene.filter(
      (g) => !bekannt.has(`${kandidat.schluessel}|${g.id}`)
    )
    ergebnis.wiederholt += getroffene.length - neue.length
    if (neue.length === 0) continue

    // The address once per piece — the searcher caches the publisher's
    // sitemap and pages for the run, so a second piece of the same medium
    // costs no second sitemap.
    const antwort = await kontext.linksucher.suche(kandidat.medium, {
      titel: kandidat.titel,
      lead: kandidat.lead,
      datum: kandidat.datum,
      blogTitel: kandidat.blogTitel
    })
    if (antwort.status === 'gefunden') ergebnis.links.gefunden += 1
    else if (antwort.status === 'nicht_gefunden')
      ergebnis.links.nichtGefunden += 1
    else if (antwort.status === 'keine_tuer') ergebnis.links.keineTuer += 1
    else ergebnis.links.fehler += 1
    const link = linkFelderAus(antwort)

    for (const zeile of zeilenAus({
      kandidat,
      dossierId: kontext.dossierId,
      getroffene: neue,
      link
    })) {
      try {
        const id = (await kontext.beitraege.createOne(
          zeile as unknown as Record<string, unknown>
        )) as string
        ergebnis.neu += 1
        const liste = ergebnis.angelegt.get(zeile.gemeinde) ?? []
        liste.push({
          id,
          titel: zeile.titel,
          lead: zeile.lead,
          text: zeile.text,
          datum: zeile.datum,
          medium: zeile.medium,
          blog: zeile.blog,
          gemeinden_genannt: zeile.gemeinden_genannt,
          text_abgeschnitten: zeile.text_abgeschnitten
        })
        ergebnis.angelegt.set(zeile.gemeinde, liste)
      } catch (fehler) {
        // A row another run stored a minute ago is no error.
        if (/unique|duplicate|RECORD_NOT_UNIQUE/i.test(fehlerText(fehler)))
          ergebnis.wiederholt += 1
        else
          ergebnis.fehler.push(
            `${kandidat.medium}: "${kandidat.titel.slice(0, 60)}" nicht gespeichert: ${fehlerText(fehler)}`
          )
      }
    }
  }
  return ergebnis
}

// ---------------------------------------------------------------------------
// 2. Cleanup — the desk empties itself
// ---------------------------------------------------------------------------

/**
 * Marks lapsed proposals `verfallen`, deletes stale unproposed rows — the
 * municipal desk's rule: news is perishable. Wrapped in its own try/catch
 * by the caller — housekeeping never costs the run its work.
 */
export async function raeumeSmdAuf(
  beitraege: BeitraegeDienst,
  heute: string,
  fensterTage: number,
  logger: Logger
): Promise<{ geloescht: number; verfallen: number }> {
  const offene = (await beitraege.readByQuery({
    filter: { entscheid: { _eq: 'offen' } },
    fields: ['id', 'entscheid', 'vorschlag', 'datum', 'date_created'],
    limit: -1
  })) as Array<{
    id: string
    entscheid: string
    vorschlag: boolean | null
    datum: string | null
    date_created: string | null
  }>
  const loeschen: string[] = []
  const verfallen: string[] = []
  for (const zeile of offene) {
    const aktion = aufraeumAktionSmd(
      {
        id: zeile.id,
        entscheid: zeile.entscheid,
        vorschlag: zeile.vorschlag,
        publiziert_am: zeile.datum,
        date_created: zeile.date_created
      },
      heute,
      fensterTage
    )
    if (aktion === 'loeschen') loeschen.push(zeile.id)
    else if (aktion === 'verfallen') verfallen.push(zeile.id)
  }
  if (verfallen.length > 0)
    await beitraege.updateMany(verfallen, { entscheid: 'verfallen' })
  if (loeschen.length > 0) await beitraege.deleteMany(loeschen)
  if (loeschen.length + verfallen.length > 0)
    logger.info(
      `smd: ${verfallen.length} Vorschlaege verfallen, ${loeschen.length} Zeilen geloescht.`
    )
  return { geloescht: loeschen.length, verfallen: verfallen.length }
}

// ---------------------------------------------------------------------------
// 3. Sichtung — one call per municipality, sorts, never filters
// ---------------------------------------------------------------------------

export interface SmdSichtungKontext {
  beitraege: BeitraegeDienst
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
 * One Sonnet call per municipality over its new pieces, in packets. Steered
 * by the desk's rules and this municipality's decision history; a rule the
 * editor armed may hand a piece to the Chefredaktion by itself, as a lead.
 */
export async function sichteSmdBeitraege(
  neue: readonly ZeileFuerSmdSichtung[],
  gemeinde: { id: string; name: string },
  kontext: SmdSichtungKontext
): Promise<{
  vorschlaege: number
  weitergereicht: number
  fehler: string | null
}> {
  if (neue.length === 0)
    return { vorschlaege: 0, weitergereicht: 0, fehler: null }
  const zeilen: SmdSichtungsZeile[] = neue.map((z) => ({
    id: z.id,
    titel: z.titel,
    // The beginning plus every passage naming the municipality — the Kanton
    // desk's lesson of 19 October 2026, and the same question here.
    auszug: auszugMitFundstellen(
      { anriss: z.lead, text: z.text },
      gemeinde.name,
      AUSZUG_ZEICHEN
    ),
    datum: z.datum,
    medium: z.medium,
    blog: z.blog,
    weitereGemeinden: (z.gemeinden_genannt ?? []).filter(
      (n) => n !== gemeinde.name
    ),
    textAbgeschnitten: z.text_abgeschnitten
  }))
  const signale = await ladeSmdSignale(
    {
      zeilen: kontext.beitraege,
      hinweise: kontext.hinweise,
      meldungen: kontext.meldungen
    },
    gemeinde.id,
    kontext.heute
  )
  const digest = lernDigest(signale.entscheide, LERN_FENSTER, signale.rahmen)
  const weiterzureichen = new Map<string, NummerierteRegel>()
  let vorschlaege = 0
  const alle = pakete(zeilen)
  const fehlerPakete: string[] = []
  for (const paket of alle) {
    try {
      const antwort = await completeJson<unknown>(
        {
          zweck: 'smd:sichtung',
          system: cacheableSystem(SMD_SICHTUNG_SYSTEM_PROMPT),
          prompt: buildSmdSichtungPrompt(
            gemeinde.name,
            paket,
            digest,
            kontext.sichtungsregeln.text
          ),
          ...SICHTUNG_AUFRUF,
          ...(kontext.model == null ? {} : { model: kontext.model }),
          schema: SICHTUNG_SCHEMA
        },
        kontext.send
      )
      for (const urteil of parseSichtung(antwort, paket)) {
        await kontext.beitraege.updateOne(urteil.id, {
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
      // `vorschlag` stays null: "not judged", which the desk shows as such.
      kontext.logger.warn(
        fehler,
        `smd: Sichtung fuer ${gemeinde.name} fehlgeschlagen.`
      )
      fehlerPakete.push(fehlerText(fehler))
    }
  }
  const sichtungsFehler = sichtungsFehlerText(fehlerPakete, alle.length)
  let weitergereicht = 0
  for (const [zeileId, regel] of weiterzureichen) {
    try {
      const [voll] = (await kontext.beitraege.readByQuery({
        filter: { id: { _eq: zeileId }, entscheid: { _eq: 'offen' } },
        fields: [
          'id',
          'titel',
          'medium',
          'art',
          'blog',
          'datum',
          'zeit',
          'lead',
          'text',
          'link_url',
          'vorschlag_begruendung',
          'gemeinde.id'
        ],
        limit: 1
      })) as Array<Parameters<typeof smdBeitragAlsHinweis>[0]>
      if (voll === undefined) continue
      await reicheWeiter(
        { hinweise: kontext.hinweise, ursprung: kontext.beitraege },
        {
          ursprungId: zeileId,
          felder: smdBeitragAlsHinweis(
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
        `smd: Automatisches Weiterreichen von ${zeileId} fehlgeschlagen.`
      )
    }
  }
  return { vorschlaege, weitergereicht, fehler: sichtungsFehler }
}
