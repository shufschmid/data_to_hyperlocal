// The Directus-bound half of the events desk: the upsert of Anlässe, the
// choice of what gets its detail page and what reaches the Sichtung, the
// Dauerangebot dose, the cleanup and the one Sichtung call per municipality.
// Shared by the 13:00 run and the "Jetzt prüfen" button.
//
// Services are injected as the small interfaces below, so everything here is
// tested against stubs. No fetching: the reader hands rows in, the operation
// hands pages in.

import type { Anker, Dauerangebot, Zugang } from '../types/schema'
import { completeJson, type MessageSender } from '../shared/claude'
import { kappe, TEXT_MAX_ZEICHEN, type Heute } from '../shared/gemeindeseite'
import {
  berechneAnker,
  DAUERANGEBOTE_JE_WOCHE,
  imVorschlagsfenster,
  waehleDauerangebote,
  type Anlass,
  type AnkerBefund,
  type GeleseneAnlass
} from '../shared/veranstaltung'
import { verschiebe } from './feiertage'
import type { RegelZeile } from './gedaechtnis'
import { automatischeWeitergabe, type NummerierteRegel } from './lernen'
import { ladeVeranstaltungSignale, LERN_FENSTER } from './lernsignale'
import {
  aufraeumAnlass,
  auszugVon,
  lernDigest,
  NEWS_KONTEXT_TAGE,
  parseSichtung,
  SICHTUNG_SCHEMA,
  SICHTUNG_SYSTEM_PROMPT,
  buildSichtungPrompt,
  type AufraeumAnlass,
  type SichtungsAnlass
} from './veranstaltung'
import { anlassAlsHinweis, reicheWeiter } from './weiterreichen'

export interface LeseDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown>
}

export interface AnlaesseDienst extends LeseDienst {
  createOne(payload: Record<string, unknown>): Promise<unknown>
  updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
  updateMany(keys: string[], payload: Record<string, unknown>): Promise<unknown>
  deleteMany(keys: string[]): Promise<unknown>
}

export interface Logger {
  info: (m: string) => void
  warn: (e: unknown, m?: string) => void
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function raeumeAnlaesseAuf(
  anlaesse: AnlaesseDienst,
  heute: string,
  logger: Logger
): Promise<{ geloescht: number; verfallen: number }> {
  const offene = (await anlaesse.readByQuery({
    filter: { entscheid: { _eq: 'offen' } },
    fields: [
      'id',
      'entscheid',
      'vorschlag',
      'anker_am',
      'zuletzt_gesehen_am',
      'dauerangebot'
    ],
    limit: -1
  })) as AufraeumAnlass[]

  const loeschen: string[] = []
  const verfallen: string[] = []
  for (const zeile of offene) {
    const aktion = aufraeumAnlass(zeile, heute)
    if (aktion === 'loeschen') loeschen.push(zeile.id)
    else if (aktion === 'verfallen') verfallen.push(zeile.id)
  }
  if (verfallen.length > 0)
    await anlaesse.updateMany(verfallen, { entscheid: 'verfallen' })
  if (loeschen.length > 0) await anlaesse.deleteMany(loeschen)
  if (loeschen.length + verfallen.length > 0)
    logger.info(
      `veranstaltungen: ${verfallen.length} Vorschlaege verfallen, ${loeschen.length} Zeilen geloescht.`
    )
  return { geloescht: loeschen.length, verfallen: verfallen.length }
}

// ---------------------------------------------------------------------------
// Upsert — the calendar's rows onto the desk's Anlässe
// ---------------------------------------------------------------------------

/** What a stored Anlass tells the next run about itself. */
export interface BekannteZeile {
  id: string
  schluessel: string
  titel: string
  anker: Anker | null
  anker_am: string | null
  entscheid: string
  vorschlag: boolean | null
  gelesen_am: string | null
  zuletzt_vorgelegt_am: string | null
  zuletzt_gemeldet_am: string | null
  dauerangebot: Dauerangebot | null
  zugang: Zugang
  frist_am: string | null
  beschreibung: string | null
  url: string
  hinweise: string[] | null
}

export async function ladeBekannteSerien(
  anlaesse: LeseDienst,
  quelleId: string
): Promise<Map<string, BekannteZeile>> {
  const zeilen = (await anlaesse.readByQuery({
    filter: { quelle: { _eq: quelleId } },
    fields: [
      'id',
      'schluessel',
      'titel',
      'anker',
      'anker_am',
      'entscheid',
      'vorschlag',
      'gelesen_am',
      'zuletzt_vorgelegt_am',
      'zuletzt_gemeldet_am',
      'dauerangebot',
      'zugang',
      'frist_am',
      'beschreibung',
      'url',
      'hinweise'
    ],
    limit: -1
  })) as BekannteZeile[]
  return new Map(zeilen.map((z) => [z.schluessel, z]))
}

function normOrt(ort: string): string {
  return ort
    .normalize('NFC')
    .toLowerCase()
    .replace(/\b(bl|bs|so|ag)\b/g, '')
    .replace(/[^\p{L}]+/gu, ' ')
    .trim()
}

/** The place the calendar names is not the municipality's own. */
export function ortAusserhalb(ort: string | null, gemeinde: string): boolean {
  if (ort === null || ort.trim() === '') return false
  const o = normOrt(ort)
  const g = normOrt(gemeinde)
  return o !== '' && !o.includes(g) && !g.includes(o)
}

/** An anchor that reopens a decided row: something happened to the series since the editor judged it. */
const NEU_OEFFNENDE: ReadonlySet<Anker> = new Set<Anker>([
  'ausfall',
  'verschoben',
  'abweichung',
  'frist'
])

export interface GeschriebenerAnlass {
  id: string
  anlass: Anlass
  befund: AnkerBefund
  /** The stored row before this run, or null when the row was created now. */
  vorher: BekannteZeile | null
}

/**
 * Upsert per `(quelle, schluessel)`. A decided row keeps its decision and its
 * detail fields; the run refreshes dates, rhythm, anchor and the
 * last-seen day. A row the editor decided is reopened only when an anchor of
 * the reopening kind arrives — a cancellation after a rejection is news.
 * Every created row says so in its hints.
 */
export async function schreibeAnlaesse(
  anlaesse: AnlaesseDienst,
  quelle: {
    id: string
    gemeinde: { id: string; name: string }
    plattform: string | null
  },
  gruppen: readonly Anlass[],
  bekannt: ReadonlyMap<string, BekannteZeile>,
  heute: string,
  heuteObj: Heute,
  erstlauf: boolean,
  logger: Logger
): Promise<GeschriebenerAnlass[]> {
  const geschrieben: GeschriebenerAnlass[] = []
  for (const anlass of gruppen) {
    const vorher = bekannt.get(anlass.schluessel) ?? null
    const befund = berechneAnker(
      {
        titel: anlass.titel,
        termine: anlass.termine,
        von: anlass.von,
        bis: anlass.bis,
        spanne: anlass.spanne,
        text: `${anlass.teaser ?? ''}\n${vorher?.beschreibung ?? ''}`,
        kategorie: anlass.kategorie,
        teaser: anlass.teaser,
        abgesagt: anlass.abgesagt,
        serieSeit: anlass.serieSeit,
        zugang:
          vorher !== null && vorher.zugang !== 'unbekannt'
            ? vorher.zugang
            : null,
        fristAm: vorher?.frist_am ?? null
      },
      heute,
      { erstlauf, bekannt: vorher !== null },
      heuteObj
    )

    const basis = {
      titel: anlass.titel,
      termine: anlass.termine,
      von: anlass.von,
      bis: anlass.bis,
      rhythmus: befund.rhythmus.rhythmus,
      anker: befund.anker,
      anker_am: befund.ankerAm,
      anker_grund: befund.grund,
      zuletzt_gesehen_am: heute
    }
    try {
      if (vorher === null) {
        const hinweise = [...befund.hinweise]
        if (!erstlauf) hinweise.push('Serie neu erkannt.')
        const gekuerzt = kuerzeFelder({
          schluessel: anlass.schluessel,
          zeit: anlass.zeit,
          lokalitaet: anlass.lokalitaet,
          ort: anlass.ort,
          veranstalter: anlass.veranstalter,
          kategorie: anlass.kategorie
        })
        hinweise.push(...gekuerzt.hinweise)
        const id = (await anlaesse.createOne({
          ...basis,
          ...gekuerzt.felder,
          quelle: quelle.id,
          gemeinde: quelle.gemeinde.id,
          zugang: befund.zugang,
          frist_am: befund.fristAm,
          ort_ausserhalb: ortAusserhalb(anlass.ort, quelle.gemeinde.name),
          url: anlass.url,
          plattform: quelle.plattform,
          hinweise,
          entscheid: 'offen'
        })) as string
        geschrieben.push({ id, anlass, befund, vorher: null })
        continue
      }

      const ankerNeu = befund.anker !== vorher.anker
      const wiederOeffnen =
        ankerNeu &&
        vorher.entscheid !== 'offen' &&
        NEU_OEFFNENDE.has(befund.anker)
      const hinweise = [...befund.hinweise]
      if (wiederOeffnen)
        hinweise.push(`Neuer Anker nach Entscheid: ${befund.anker}.`)
      await anlaesse.updateOne(vorher.id, {
        ...basis,
        // The list's time and venue fill gaps, never overwrite what the
        // detail page said.
        ...(vorher.zugang === 'unbekannt' ? { zugang: befund.zugang } : {}),
        ...(vorher.frist_am === null && befund.fristAm !== null
          ? { frist_am: befund.fristAm }
          : {}),
        hinweise,
        // A changed anchor is a new question for the Sichtung.
        ...(ankerNeu && vorher.entscheid === 'offen'
          ? { vorschlag: null, vorschlag_begruendung: null }
          : {}),
        ...(wiederOeffnen
          ? { entscheid: 'offen', vorschlag: null, vorschlag_begruendung: null }
          : {})
      })
      geschrieben.push({ id: vorher.id, anlass, befund, vorher })
    } catch (fehler) {
      logger.warn(
        fehler,
        `veranstaltungen: ${quelle.gemeinde.name} — "${anlass.titel}" nicht gespeichert.`
      )
    }
  }
  return geschrieben
}

// ---------------------------------------------------------------------------
// Which rows get their detail page, which reach the Sichtung
// ---------------------------------------------------------------------------

/** Anchors that never reach the desk on their own. */
const OHNE_TISCH: ReadonlySet<Anker> = new Set<Anker>([
  'routine',
  'abfuhr',
  'platzhalter'
])

/** Anchors worth a detail read as soon as they exist, whatever the window. */
const SOFORT: ReadonlySet<Anker> = new Set<Anker>([
  'neu',
  'ausfall',
  'verschoben',
  'gremium',
  'abweichung'
])

/**
 * An Anlass gets its detail page when it is (or is about to be) on the desk:
 * an anchor inside the proposal window, or one of the kinds that is news the
 * day it appears. Once per Anlass, never per date — a row read earlier keeps
 * its page.
 */
export function brauchtDetail(
  g: GeschriebenerAnlass,
  heute: string,
  vorschlagTage: number
): boolean {
  if (g.vorher?.gelesen_am != null) return false
  if (OHNE_TISCH.has(g.befund.anker)) return false
  if (SOFORT.has(g.befund.anker)) return true
  return imVorschlagsfenster(g.befund.ankerAm, heute, vorschlagTage)
}

/**
 * The fields a detail read adds to the row, with the anchor recomputed over
 * the whole text — the description names the rhythm, the registration
 * deadline and the kind of access the list could not.
 */
/**
 * Die Spaltenbreiten der freien Textfelder, so wie der Snapshot sie erklaert.
 *
 * Gemessen am ersten Lauf ueber die zehn Kalender (20.09.2026): Prattelns
 * „Lümmel-Wiesn (Oktoberfest)" ging verloren, weil ein Feld einen Buchstaben
 * zu lang war — Directus wies die ganze Zeile ab, und ein Anlass fiel aus dem
 * Lauf, damit eine Zeitangabe vollstaendig bleiben konnte. Das ist der
 * falsche Handel: gekuerzt und gesagt ist besser als weg und still.
 *
 * Adressen der Seiten stehen NICHT in der Liste. Eine gekuerzte URL ist ein
 * falscher Link, und ein falscher Link ist der eine Fehler, den eine Leserin
 * weder sieht noch pruefen kann — passt eine nicht, soll die Zeile scheitern
 * und die Quelle es sagen.
 */
export const FELD_LAENGEN: Readonly<Record<string, number>> = {
  schluessel: 300,
  zeit: 40,
  lokalitaet: 200,
  adresse: 200,
  ort: 200,
  veranstalter: 200,
  kategorie: 100,
  preis: 200
}

/** Wie ein gekuerztes Feld auf der Zeile heisst. */
const FELD_NAME: Readonly<Record<string, string>> = {
  zeit: 'Zeit',
  lokalitaet: 'Lokalität',
  adresse: 'Adresse',
  ort: 'Ort',
  veranstalter: 'Veranstalter',
  kategorie: 'Kategorie',
  preis: 'Preis'
}

/**
 * Kuerzt die freien Textfelder auf ihre Spaltenbreite und sagt, welche.
 *
 * `schluessel` wird still gekuerzt: er ist die Identitaet und steht auf
 * keinem Tisch, und dieselbe Eingabe ergibt denselben gekuerzten Wert.
 */
export function kuerzeFelder(felder: Record<string, unknown>): {
  felder: Record<string, unknown>
  hinweise: string[]
} {
  const gekuerzt: Record<string, unknown> = { ...felder }
  const hinweise: string[] = []
  for (const [feld, laenge] of Object.entries(FELD_LAENGEN)) {
    const wert = gekuerzt[feld]
    if (typeof wert !== 'string' || wert.length <= laenge) continue
    gekuerzt[feld] = wert.slice(0, laenge)
    const name = FELD_NAME[feld]
    if (name !== undefined) hinweise.push(`${name} gekürzt.`)
  }
  return { felder: gekuerzt, hinweise }
}

export function detailPayload(
  g: GeschriebenerAnlass,
  gelesen: GeleseneAnlass,
  gemeinde: string,
  heute: string,
  heuteObj: Heute,
  erstlauf: boolean
): { payload: Record<string, unknown>; befund: AnkerBefund } {
  const d = gelesen.detail
  const beschreibung = kappe(d.beschreibung.trim(), TEXT_MAX_ZEICHEN)
  const termine = [
    ...new Set([...g.anlass.termine, ...d.weitereTermine])
  ].sort()
  const von = termine[0] ?? g.anlass.von
  const letzter = termine[termine.length - 1] ?? null
  const bis = letzter !== null && letzter !== von ? letzter : null
  const ort = d.ort ?? g.anlass.ort
  const befund = berechneAnker(
    {
      titel: g.anlass.titel,
      termine,
      von,
      bis,
      spanne: g.anlass.spanne,
      text: `${g.anlass.teaser ?? ''}\n${d.anmeldung ?? ''}\n${beschreibung.text}`,
      kategorie: g.anlass.kategorie,
      teaser: g.anlass.teaser,
      abgesagt: g.anlass.abgesagt,
      serieSeit: g.anlass.serieSeit
    },
    heute,
    { erstlauf, bekannt: g.vorher !== null },
    heuteObj
  )
  const hinweise = [...befund.hinweise]
  if (beschreibung.abgeschnitten) hinweise.push('Text gekürzt.')
  const ungelesen = gelesen.anhaenge.filter((a) => !a.gelesen).length
  if (ungelesen > 0) hinweise.push(`${ungelesen} Dokumente nicht gelesen.`)
  if (gelesen.traktanden?.abgeschnitten === true)
    hinweise.push('Traktanden gekürzt.')
  if (d.verfahren === 'generisch')
    hinweise.push('Detailseite generisch gelesen.')
  if (gelesen.transport === 'crawler') hinweise.push('Über den Crawler gelesen')

  const gekuerzt = kuerzeFelder({
    zeit: d.zeit ?? g.anlass.zeit,
    lokalitaet: d.lokalitaet ?? g.anlass.lokalitaet,
    adresse: d.adresse,
    ort,
    veranstalter: d.veranstalter ?? g.anlass.veranstalter,
    kategorie: d.kategorie ?? g.anlass.kategorie,
    preis: d.preis
  })
  hinweise.push(...gekuerzt.hinweise)

  return {
    befund,
    payload: {
      ...gekuerzt.felder,
      termine,
      von,
      bis,
      rhythmus: befund.rhythmus.rhythmus,
      zugang: befund.zugang,
      anker: befund.anker,
      anker_am: befund.ankerAm,
      anker_grund: befund.grund,
      frist_am: befund.fristAm,
      ort_ausserhalb: ortAusserhalb(ort, gemeinde),
      anmeldung: d.anmeldung,
      beschreibung: beschreibung.text,
      text_abgeschnitten: beschreibung.abgeschnitten,
      dokumente: gelesen.anhaenge,
      traktanden: gelesen.traktanden?.liste ?? null,
      traktanden_url: gelesen.traktanden?.url ?? null,
      url_kanonisch: d.kanonisch,
      gelesen_am: new Date().toISOString(),
      hinweise,
      zuletzt_gesehen_am: heute
    }
  }
}

/** A row the Sichtung has not judged for its current anchor, inside the window. */
export function sichtungsKandidat(
  zeile: {
    anker: Anker | null
    anker_am: string | null
    vorschlag: boolean | null
    entscheid: string
  },
  heute: string,
  vorschlagTage: number
): boolean {
  if (zeile.entscheid !== 'offen' || zeile.vorschlag !== null) return false
  if (zeile.anker === null || OHNE_TISCH.has(zeile.anker)) return false
  return imVorschlagsfenster(zeile.anker_am, heute, vorschlagTage)
}

export interface RoutineFuerDauerangebot {
  id: string
  zuletzt_vorgelegt_am: string | null
  dauerangebot: Dauerangebot | null
}

/**
 * The Dauerangebot dose for one municipality and run: none when one was put
 * on the desk in the last seven days, else the longest-waiting routine —
 * exactly one. The rest is counted, never dropped.
 */
export function dauerangeboteHeute(
  routinen: readonly RoutineFuerDauerangebot[],
  heute: string,
  max = DAUERANGEBOTE_JE_WOCHE
): { vorgelegt: string[]; warten: number } {
  const vorWoche = verschiebe(heute, -7)
  const kuerzlich = routinen.some(
    (r) => r.zuletzt_vorgelegt_am !== null && r.zuletzt_vorgelegt_am > vorWoche
  )
  const wahl = waehleDauerangebote(routinen, heute, kuerzlich ? 0 : max)
  return kuerzlich ? { vorgelegt: [], warten: wahl.warten } : wahl
}

// ---------------------------------------------------------------------------
// Sichtung
// ---------------------------------------------------------------------------

/** The titles the municipality's news page carried recently — context for the Sichtung. */
export async function ladeNewsKontext(
  mitteilungen: LeseDienst,
  gemeindeId: string,
  heute: string
): Promise<string[]> {
  const zeilen = (await mitteilungen.readByQuery({
    filter: {
      gemeinde: { _eq: gemeindeId },
      veranstaltung_am: { _null: true },
      publiziert_am: { _gte: verschiebe(heute, -NEWS_KONTEXT_TAGE) }
    },
    fields: ['titel'],
    sort: ['-publiziert_am'],
    limit: 60
  })) as Array<{ titel: string }>
  return zeilen.map((z) => z.titel)
}

/** A stored row as the Sichtung reads it back. */
export interface ZeileFuerSichtung {
  id: string
  titel: string
  anker: Anker | null
  anker_am: string | null
  anker_grund: string | null
  termine: string[] | null
  zeit: string | null
  lokalitaet: string | null
  ort: string | null
  ort_ausserhalb: boolean
  veranstalter: string | null
  kategorie: string | null
  preis: string | null
  anmeldung: string | null
  frist_am: string | null
  traktanden: string[] | null
  dokumente: ReadonlyArray<{ gelesen: boolean }> | null
  beschreibung: string | null
  text_abgeschnitten: boolean
  hinweise: string[] | null
  teaser?: string | null
}

export const SICHTUNGS_FELDER = [
  'id',
  'titel',
  'anker',
  'anker_am',
  'anker_grund',
  'termine',
  'zeit',
  'lokalitaet',
  'ort',
  'ort_ausserhalb',
  'veranstalter',
  'kategorie',
  'preis',
  'anmeldung',
  'frist_am',
  'traktanden',
  'dokumente',
  'beschreibung',
  'text_abgeschnitten',
  'hinweise'
]

export interface SichtungKontext {
  anlaesse: AnlaesseDienst
  mitteilungen: LeseDienst
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
 * One Sonnet call over the municipality's anchored Anlässe: sorts, never
 * filters, never for the organiser's sake. Steered by the desk's rules, the
 * municipality's decision history and the titles its news page carried
 * lately. A rule the editor armed may hand an Anlass to the Chefredaktion by
 * itself, as a lead.
 */
export async function sichteAnlaesse(
  ids: readonly string[],
  gemeinde: { id: string; name: string },
  kontext: SichtungKontext
): Promise<{
  vorschlaege: number
  weitergereicht: number
  fehler: string | null
}> {
  if (ids.length === 0)
    return { vorschlaege: 0, weitergereicht: 0, fehler: null }

  const zeilen = (await kontext.anlaesse.readByQuery({
    filter: { id: { _in: [...ids] } },
    fields: SICHTUNGS_FELDER,
    limit: -1
  })) as ZeileFuerSichtung[]
  if (zeilen.length === 0)
    return { vorschlaege: 0, weitergereicht: 0, fehler: null }

  const anlaesse: SichtungsAnlass[] = zeilen.map((z) => ({
    id: z.id,
    titel: z.titel,
    anker: z.anker ?? 'einmalig',
    ankerAm: z.anker_am,
    ankerGrund: z.anker_grund,
    termine: z.termine ?? [],
    zeit: z.zeit,
    lokalitaet: z.lokalitaet,
    ort: z.ort,
    ortAusserhalb: z.ort_ausserhalb,
    veranstalter: z.veranstalter,
    kategorie: z.kategorie,
    preis: z.preis,
    anmeldung: z.anmeldung,
    fristAm: z.frist_am,
    traktanden: z.traktanden ?? [],
    dokumente: z.dokumente?.filter((d) => d.gelesen).length ?? 0,
    auszug: auszugVon({
      teaser: z.teaser ?? null,
      beschreibung: z.beschreibung
    }),
    textAbgeschnitten: z.text_abgeschnitten,
    dauerangebot: z.anker === 'dauerangebot',
    hinweise: z.hinweise ?? []
  }))

  const [signale, newsKontext] = await Promise.all([
    ladeVeranstaltungSignale(
      {
        zeilen: kontext.anlaesse,
        hinweise: kontext.hinweise,
        meldungen: kontext.meldungen
      },
      gemeinde.id,
      kontext.heute
    ),
    ladeNewsKontext(kontext.mitteilungen, gemeinde.id, kontext.heute)
  ])

  const weiterzureichen = new Map<string, NummerierteRegel>()
  let vorschlaege = 0
  let sichtungsFehler: string | null = null
  try {
    const antwort = await completeJson<unknown>(
      {
        system: SICHTUNG_SYSTEM_PROMPT,
        prompt: buildSichtungPrompt(
          gemeinde.name,
          anlaesse,
          lernDigest(signale.entscheide, LERN_FENSTER, signale.rahmen),
          kontext.sichtungsregeln.text,
          newsKontext
        ),
        // The same room the news Sichtung needed: a truncated answer costs
        // the whole municipality its judgement.
        maxTokens: 8000,
        ...(kontext.model == null ? {} : { model: kontext.model }),
        schema: SICHTUNG_SCHEMA
      },
      kontext.send
    )
    for (const urteil of parseSichtung(antwort, anlaesse)) {
      await kontext.anlaesse.updateOne(urteil.id, {
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
    kontext.logger.warn(
      fehler,
      `veranstaltungen: Sichtung fuer ${gemeinde.name} fehlgeschlagen.`
    )
    sichtungsFehler = fehler instanceof Error ? fehler.message : String(fehler)
  }

  let weitergereicht = 0
  for (const [zeileId, regel] of weiterzureichen) {
    try {
      const [voll] = (await kontext.anlaesse.readByQuery({
        filter: { id: { _eq: zeileId }, entscheid: { _eq: 'offen' } },
        fields: [
          'id',
          'titel',
          'url',
          'url_kanonisch',
          'von',
          'bis',
          'zeit',
          'lokalitaet',
          'ort',
          'veranstalter',
          'anker',
          'beschreibung',
          'traktanden',
          'dokumente',
          'vorschlag_begruendung',
          'gemeinde.id'
        ],
        limit: 1
      })) as Array<Parameters<typeof anlassAlsHinweis>[0]>
      if (voll === undefined) continue
      await reicheWeiter(
        { hinweise: kontext.hinweise, ursprung: kontext.anlaesse },
        {
          ursprungId: zeileId,
          felder: anlassAlsHinweis(
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
        `veranstaltungen: Automatisches Weiterreichen von ${zeileId} fehlgeschlagen.`
      )
    }
  }

  return { vorschlaege, weitergereicht, fehler: sichtungsFehler }
}
