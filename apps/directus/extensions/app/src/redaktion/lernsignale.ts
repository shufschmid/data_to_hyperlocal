// Learning signals: what the newsroom decided, loaded once per desk and in one
// shape, so the three Sichtungen learn from the same facts.
//
// Directus-facing, but through injected services only (`readByQuery`), which
// is what keeps it unit-testable with a stub. The RENDERING stays in each
// desk's own module (`lernDigest` in presseschau.ts, amtsblatt.ts, sendung.ts)
// — the desks differ in what an example looks like, not in where it comes from.
//
// Two things were measured before this module existed. The Amtsblatt and the
// Sendung loaders stored the editor's comment and never read it back — the
// richest signal each desk captures was thrown away. And undecided proposals
// were DELETED when the desk moved on, so "the editor ignored 35 of 61
// proposals" — the loudest signal for "too many proposals" — was invisible to
// the model. Ignored rows are now marked `verfallen` and counted here.

import { ANKER_TEXT } from './veranstaltung'
import type {
  FaehrtenUrteil,
  GemeindeKorrektur,
  LernEintrag as PresseEintrag,
  PerlenUrteil
} from './presseschau'
import type { LernEintrag as AmtsblattEintrag } from './amtsblatt'
import type { LernEintrag as SendungEintrag, SendungsQuelle } from './sendung'

/** How many past decisions ride into a Sichtung as examples. */
export const LERN_FENSTER = 20
/** The press review's tally window: the paper's newest issues. */
export const BILANZ_AUSGABEN = 3
/** The other desks' tally window, in days. */
export const BILANZ_TAGE = 30
/** How many ignored titles are named — the rest is a number. */
export const VERFALLENE_BEISPIELE = 10
/** Perle verdicts are taste, and taste is global: the newest across papers. */
export const PERLEN_FENSTER = 10

export interface ItemsServiceLike {
  readByQuery(query: Record<string, unknown>): Promise<unknown>
}

export interface LernDienste {
  /** The desk's own rows: wochenblattkandidaten, amtsblattmeldungen or sendungskandidaten. */
  zeilen: ItemsServiceLike
  hinweise: ItemsServiceLike
  meldungen: ItemsServiceLike
  /** The press review only: the paper's issues, to bound the window by issue. */
  ausgaben?: ItemsServiceLike
}

export type HinweisStatus =
  | 'offen'
  | 'brauchbar'
  | 'kein_hinweis'
  | 'zurueckgegeben'

/** The Chefredaktion's verdict on a lead that a hand-up produced. */
export interface HinweisUrteil {
  status: HinweisStatus
  kommentar: string | null
  /** Handed up by a rule, not by a person — no example until she judged it. */
  automatisch: boolean
}

/** A Meldung that was written from a taken-over row and then discarded. */
export interface Verwurf {
  grund: string | null
}

export interface Bilanz {
  gesamt: number
  uebernommen: number
  weitergereicht: number
  abgelehnt: number
  verfallen: number
  offen: number
}

/** What frames the examples: the tally, the ignored titles, the declared cap. */
export interface Beispielrahmen {
  bilanz: string
  verfallene: string[]
  kappung: string
}

const ENTSCHIEDEN = ['uebernommen', 'abgelehnt', 'weitergereicht'] as const

export function bilanz(zeilen: readonly { entscheid: string }[]): Bilanz {
  const b: Bilanz = {
    gesamt: zeilen.length,
    uebernommen: 0,
    weitergereicht: 0,
    abgelehnt: 0,
    verfallen: 0,
    offen: 0
  }
  for (const z of zeilen) {
    if (z.entscheid === 'uebernommen') b.uebernommen += 1
    else if (z.entscheid === 'weitergereicht') b.weitergereicht += 1
    else if (z.entscheid === 'abgelehnt') b.abgelehnt += 1
    else if (z.entscheid === 'verfallen') b.verfallen += 1
    else b.offen += 1
  }
  return b
}

/**
 * The tally as a fact, never as an order.
 *
 * "Sei strenger" computed from a ratio oscillates: a lean week says strenger,
 * the next run proposes less, the ratio rises, the imperative disappears. So
 * the line states the numbers and the SYSTEM prompt carries the one fixed
 * sentence about what an ignored proposal costs. Silent below a handful of
 * outcomes — two decisions are not a tally.
 */
export function bilanzZeile(b: Bilanz, rahmen: string, mindestens = 8): string {
  const ausgaenge = b.gesamt - b.offen
  if (ausgaenge < mindestens) return ''
  return (
    `Bilanz ${rahmen}: ${b.gesamt} Vorschlaege — ${b.uebernommen} uebernommen, ` +
    `${b.weitergereicht} weitergereicht, ${b.abgelehnt} abgelehnt, ` +
    `${b.verfallen} liegen gelassen` +
    (b.offen > 0 ? `, ${b.offen} noch unentschieden` : '') +
    '.'
  )
}

/** A cap that bites must be audible — the newsroom's rule for every list. */
export function deklariereKappung(
  gesamt: number,
  gezeigt: number,
  was = 'Entscheide'
): string {
  return gesamt > gezeigt
    ? `(${gesamt - gezeigt} weitere ${was} nicht aufgefuehrt)`
    : ''
}

function tageZurueck(heute: string, tage: number): string {
  return new Date(Date.parse(`${heute}T00:00:00Z`) - tage * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

function neuesteZuerst(
  a: { date_updated: string | null },
  b: { date_updated: string | null }
): number {
  return (b.date_updated ?? '').localeCompare(a.date_updated ?? '')
}

/** The anchor as the digest names it — the code's own vocabulary, in the newsroom's words. */
function ankerName(anker: string | null): string {
  if (anker === null) return 'Anlass'
  return (ANKER_TEXT as Record<string, string>)[anker] ?? anker
}

type UrsprungsFeld =
  | 'kandidat'
  | 'amtsblattmeldung'
  | 'gemeindemitteilung'
  | 'sendungskandidat'
  | 'veranstaltung'

/** Discarded Meldungen written from these rows, by row id. */
async function ladeVerwuerfe(
  meldungen: ItemsServiceLike,
  feld: UrsprungsFeld,
  ids: readonly string[]
): Promise<Map<string, Verwurf>> {
  if (ids.length === 0) return new Map()
  const zeilen = (await meldungen.readByQuery({
    filter: { [feld]: { _in: [...ids] }, status: { _eq: 'verworfen' } },
    fields: [feld, 'verwerfungsgrund'],
    limit: -1
  })) as Array<Record<string, unknown>>
  const karte = new Map<string, Verwurf>()
  for (const z of zeilen) {
    const id = z[feld]
    if (typeof id !== 'string') continue
    const grund = z['verwerfungsgrund']
    karte.set(id, { grund: typeof grund === 'string' ? grund : null })
  }
  return karte
}

/** The Chefredaktion's verdicts on the leads these rows became, by row id. */
async function ladeUrteile(
  hinweise: ItemsServiceLike,
  feld: UrsprungsFeld,
  ids: readonly string[]
): Promise<Map<string, HinweisUrteil>> {
  if (ids.length === 0) return new Map()
  const zeilen = (await hinweise.readByQuery({
    filter: { [feld]: { _in: [...ids] } },
    fields: [feld, 'status', 'kommentar', 'automatisch'],
    limit: -1
  })) as Array<Record<string, unknown>>
  const karte = new Map<string, HinweisUrteil>()
  for (const z of zeilen) {
    const id = z[feld]
    if (typeof id !== 'string') continue
    const status = z['status']
    karte.set(id, {
      status:
        status === 'brauchbar' ||
        status === 'kein_hinweis' ||
        status === 'zurueckgegeben'
          ? status
          : 'offen',
      kommentar: typeof z['kommentar'] === 'string' ? z['kommentar'] : null,
      automatisch: z['automatisch'] === true
    })
  }
  return karte
}

// ---------------------------------------------------------------------------
// Press review — per paper, windowed by issue
// ---------------------------------------------------------------------------

export interface WochenblattSignale {
  entscheide: PresseEintrag[]
  korrekturen: GemeindeKorrektur[]
  faehrten: FaehrtenUrteil[]
  perlen: PerlenUrteil[]
  rahmen: Beispielrahmen
}

interface KandidatZeile {
  id: string
  titel: string
  typ: PresseEintrag['typ']
  entscheid: string
  ablehnungsgrund: PresseEintrag['ablehnungsgrund']
  ablehnungskommentar: string | null
  perle_vorschlag: boolean
  perle: boolean | null
  perle_kommentar: string | null
  date_updated: string | null
}

/**
 * The recent teaching of THIS paper — take/reject decisions, municipality
 * corrections, lead verdicts — plus the Perle verdicts of ALL papers.
 *
 * Per paper on purpose: what in Binningen is a Doublette says nothing about
 * Muttenz. The window is the paper's newest issues rather than "the last 20
 * rows", because a single issue can carry thirty candidates and a verdict
 * added months later must not push last week out of sight. Perlen are the one
 * exception to "per paper": taste is a property of the newsroom, and each
 * paper alone holds two or three verdicts — too few to learn from nine times.
 */
export async function ladeWochenblattSignale(
  dienste: LernDienste,
  blattId: string
): Promise<WochenblattSignale> {
  let ausgabenIds: string[] = []
  if (dienste.ausgaben !== undefined) {
    const ausgaben = (await dienste.ausgaben.readByQuery({
      filter: { wochenblatt: { _eq: blattId } },
      fields: ['id'],
      sort: ['-datum', '-date_created'],
      limit: BILANZ_AUSGABEN
    })) as Array<{ id: string }>
    ausgabenIds = ausgaben.map((a) => a.id)
  }
  const imFenster =
    ausgabenIds.length > 0
      ? { ausgabe: { _in: ausgabenIds } }
      : { ausgabe: { wochenblatt: { _eq: blattId } } }

  const alle = (await dienste.zeilen.readByQuery({
    filter: imFenster,
    fields: [
      'id',
      'titel',
      'typ',
      'entscheid',
      'ablehnungsgrund',
      'ablehnungskommentar',
      'perle_vorschlag',
      'perle',
      'perle_kommentar',
      'date_updated'
    ],
    limit: -1
  })) as KandidatZeile[]

  const entschiedene = alle
    .filter((z) => (ENTSCHIEDEN as readonly string[]).includes(z.entscheid))
    .sort(neuesteZuerst)
  const beispiele = entschiedene.slice(0, LERN_FENSTER)

  const verwuerfe = await ladeVerwuerfe(
    dienste.meldungen,
    'kandidat',
    beispiele.filter((z) => z.entscheid === 'uebernommen').map((z) => z.id)
  )
  const urteile = await ladeUrteile(
    dienste.hinweise,
    'kandidat',
    beispiele.filter((z) => z.entscheid === 'weitergereicht').map((z) => z.id)
  )

  const entscheide: PresseEintrag[] = beispiele.map((z) => ({
    titel: z.titel,
    typ: z.typ,
    entscheid: z.entscheid as PresseEintrag['entscheid'],
    ablehnungsgrund: z.ablehnungsgrund,
    ablehnungskommentar: z.ablehnungskommentar,
    perleVorschlag: z.perle_vorschlag,
    perleBestaetigt: z.perle,
    perleKommentar: z.perle_kommentar,
    meldungVerworfen: verwuerfe.get(z.id) ?? null,
    faehrte: urteile.get(z.id) ?? null
  }))

  const korrigierte = (await dienste.zeilen.readByQuery({
    filter: {
      gemeinde_korrigiert: { _eq: true },
      ausgabe: { wochenblatt: { _eq: blattId } }
    },
    sort: ['-date_updated'],
    fields: ['titel', 'gemeinde.name'],
    limit: LERN_FENSTER
  })) as Array<{ titel: string; gemeinde: { name: string } | null }>
  const korrekturen: GemeindeKorrektur[] = korrigierte
    .filter((k) => k.gemeinde !== null)
    .map((k) => ({
      titel: k.titel,
      gemeinde: (k.gemeinde as { name: string }).name
    }))

  // The inventory's OWN leads (Leserbriefe etc.). A handed-up candidate is a
  // lead too, but it is rendered with its candidate above — listing it here
  // as well would present the editor's own hand-up as the model's proposal.
  const beurteilte = (await dienste.hinweise.readByQuery({
    filter: {
      status: { _neq: 'offen' },
      ausgabe: { wochenblatt: { _eq: blattId } },
      kandidat: { _null: true }
    },
    sort: ['-date_updated'],
    fields: ['titel', 'status', 'kommentar'],
    limit: LERN_FENSTER
  })) as Array<{ titel: string; status: string; kommentar: string | null }>
  const faehrten: FaehrtenUrteil[] = beurteilte
    .filter((f) => f.status !== 'zurueckgegeben')
    .map((f) => ({
      titel: f.titel,
      brauchbar: f.status === 'brauchbar',
      kommentar: f.kommentar
    }))

  const perlenZeilen = (await dienste.zeilen.readByQuery({
    filter: { perle: { _nnull: true } },
    sort: ['-date_updated'],
    fields: ['titel', 'perle', 'perle_kommentar', 'ausgabe.wochenblatt.name'],
    limit: PERLEN_FENSTER
  })) as Array<{
    titel: string
    perle: boolean
    perle_kommentar: string | null
    ausgabe: { wochenblatt: { name: string } | null } | null
  }>
  const perlen: PerlenUrteil[] = perlenZeilen.map((p) => ({
    titel: p.titel,
    blatt: p.ausgabe?.wochenblatt?.name ?? null,
    bestaetigt: p.perle,
    kommentar: p.perle_kommentar
  }))

  const verfallene = alle
    .filter((z) => z.entscheid === 'verfallen')
    .sort(neuesteZuerst)
    .slice(0, VERFALLENE_BEISPIELE)
    .map((z) => z.titel)

  return {
    entscheide,
    korrekturen,
    faehrten,
    perlen,
    rahmen: {
      bilanz: bilanzZeile(
        bilanz(alle),
        ausgabenIds.length > 0
          ? `der letzten ${ausgabenIds.length} Ausgaben dieses Blatts`
          : 'dieses Blatts'
      ),
      verfallene,
      kappung: deklariereKappung(entschiedene.length, beispiele.length)
    }
  }
}

// ---------------------------------------------------------------------------
// Gazette — per municipality, windowed by days
// ---------------------------------------------------------------------------

export interface AmtsblattSignale {
  entscheide: AmtsblattEintrag[]
  rahmen: Beispielrahmen
}

interface AmtsblattZeile {
  id: string
  titel: string
  rubrik_name: string | null
  entscheid: string
  ablehnungsgrund: string | null
  ablehnungskommentar: string | null
}

export function ladeAmtsblattSignale(
  dienste: LernDienste,
  gemeindeId: string,
  heute: string
): Promise<AmtsblattSignale> {
  return ladeGemeindebezogeneSignale(
    dienste,
    gemeindeId,
    heute,
    'rubrik_name',
    'amtsblattmeldung'
  )
}

/**
 * The municipal-news desk's memory: the same per-municipality shape as the
 * gazette's, keyed on the item's category where the gazette has a rubric.
 */
export function ladeGemeindeSignale(
  dienste: LernDienste,
  gemeindeId: string,
  heute: string
): Promise<AmtsblattSignale> {
  return ladeGemeindebezogeneSignale(
    dienste,
    gemeindeId,
    heute,
    'kategorie',
    'gemeindemitteilung'
  )
}

/**
 * The events desk's memory: per municipality like the other two, keyed on
 * the ANCHOR — what brought the Anlass to the desk is the class the editor's
 * decision teaches about.
 */
export function ladeVeranstaltungSignale(
  dienste: LernDienste,
  gemeindeId: string,
  heute: string
): Promise<AmtsblattSignale> {
  return ladeGemeindebezogeneSignale(
    dienste,
    gemeindeId,
    heute,
    'anker',
    'veranstaltung'
  )
}

/**
 * One loader for the three desks scoped by MUNICIPALITY. What differs is the
 * column that carries the class hint (`rubrik_name` / `kategorie` / `anker`)
 * and the origin field a hand-up's lead points back through.
 */
async function ladeGemeindebezogeneSignale(
  dienste: LernDienste,
  gemeindeId: string,
  heute: string,
  merkmalFeld: 'rubrik_name' | 'kategorie' | 'anker',
  ursprung: UrsprungsFeld
): Promise<AmtsblattSignale> {
  const beispiele = (
    (await dienste.zeilen.readByQuery({
      filter: {
        gemeinde: { _eq: gemeindeId },
        entscheid: { _in: [...ENTSCHIEDEN] }
      },
      fields: [
        'id',
        'titel',
        merkmalFeld,
        'entscheid',
        'ablehnungsgrund',
        'ablehnungskommentar'
      ],
      sort: ['-date_updated'],
      limit: LERN_FENSTER
    })) as Array<Record<string, unknown>>
  ).map(
    (z): AmtsblattZeile => ({
      id: String(z['id']),
      titel: String(z['titel'] ?? ''),
      rubrik_name:
        typeof z[merkmalFeld] === 'string' ? (z[merkmalFeld] as string) : null,
      entscheid: String(z['entscheid']),
      ablehnungsgrund:
        typeof z['ablehnungsgrund'] === 'string'
          ? (z['ablehnungsgrund'] as string)
          : null,
      ablehnungskommentar:
        typeof z['ablehnungskommentar'] === 'string'
          ? (z['ablehnungskommentar'] as string)
          : null
    })
  )

  const alleEntschiedenen = (await dienste.zeilen.readByQuery({
    filter: {
      gemeinde: { _eq: gemeindeId },
      entscheid: { _in: [...ENTSCHIEDEN] }
    },
    fields: ['id'],
    limit: -1
  })) as Array<{ id: string }>

  const imFenster = (await dienste.zeilen.readByQuery({
    filter: {
      gemeinde: { _eq: gemeindeId },
      date_created: { _gte: tageZurueck(heute, BILANZ_TAGE) }
    },
    fields: ['entscheid'],
    limit: -1
  })) as Array<{ entscheid: string }>

  const verfallene = (await dienste.zeilen.readByQuery({
    filter: { gemeinde: { _eq: gemeindeId }, entscheid: { _eq: 'verfallen' } },
    fields: ['titel'],
    sort: ['-date_updated'],
    limit: VERFALLENE_BEISPIELE
  })) as Array<{ titel: string }>

  const verwuerfe = await ladeVerwuerfe(
    dienste.meldungen,
    ursprung,
    beispiele.filter((z) => z.entscheid === 'uebernommen').map((z) => z.id)
  )
  const urteile = await ladeUrteile(
    dienste.hinweise,
    ursprung,
    beispiele.filter((z) => z.entscheid === 'weitergereicht').map((z) => z.id)
  )

  return {
    entscheide: beispiele.map((z) => ({
      titel: z.titel,
      rubrikName:
        merkmalFeld === 'anker'
          ? ankerName(z.rubrik_name)
          : (z.rubrik_name ??
            (merkmalFeld === 'kategorie' ? 'Mitteilung' : '')),
      entscheid: z.entscheid as AmtsblattEintrag['entscheid'],
      grund: z.ablehnungsgrund,
      kommentar: z.ablehnungskommentar,
      meldungVerworfen: verwuerfe.get(z.id) ?? null,
      faehrte: urteile.get(z.id) ?? null
    })),
    rahmen: {
      bilanz: bilanzZeile(
        bilanz(imFenster),
        merkmalFeld === 'anker'
          ? `der letzten ${BILANZ_TAGE} Tage in dieser Gemeinde (Veranstaltungen)`
          : `der letzten ${BILANZ_TAGE} Tage in dieser Gemeinde`
      ),
      verfallene: verfallene.map((z) => z.titel),
      kappung: deklariereKappung(alleEntschiedenen.length, beispiele.length)
    }
  }
}

// ---------------------------------------------------------------------------
// Broadcast — per show, windowed by days
// ---------------------------------------------------------------------------

export interface SendungSignale {
  entscheide: SendungEintrag[]
  rahmen: Beispielrahmen
}

interface SendungZeile {
  id: string
  titel: string
  gemeinde: { name: string } | null
  entscheid: string
  ablehnungsgrund: string | null
  ablehnungskommentar: string | null
}

export async function ladeSendungSignale(
  dienste: LernDienste,
  quelle: SendungsQuelle,
  heute: string
): Promise<SendungSignale> {
  const beispiele = (await dienste.zeilen.readByQuery({
    filter: { quelle: { _eq: quelle }, entscheid: { _in: [...ENTSCHIEDEN] } },
    fields: [
      'id',
      'titel',
      'gemeinde.name',
      'entscheid',
      'ablehnungsgrund',
      'ablehnungskommentar'
    ],
    sort: ['-date_updated'],
    limit: LERN_FENSTER
  })) as SendungZeile[]

  const alleEntschiedenen = (await dienste.zeilen.readByQuery({
    filter: { quelle: { _eq: quelle }, entscheid: { _in: [...ENTSCHIEDEN] } },
    fields: ['id'],
    limit: -1
  })) as Array<{ id: string }>

  const imFenster = (await dienste.zeilen.readByQuery({
    filter: {
      quelle: { _eq: quelle },
      date_created: { _gte: tageZurueck(heute, BILANZ_TAGE) }
    },
    fields: ['entscheid'],
    limit: -1
  })) as Array<{ entscheid: string }>

  const verfallene = (await dienste.zeilen.readByQuery({
    filter: { quelle: { _eq: quelle }, entscheid: { _eq: 'verfallen' } },
    fields: ['titel'],
    sort: ['-date_updated'],
    limit: VERFALLENE_BEISPIELE
  })) as Array<{ titel: string }>

  const verwuerfe = await ladeVerwuerfe(
    dienste.meldungen,
    'sendungskandidat',
    beispiele.filter((z) => z.entscheid === 'uebernommen').map((z) => z.id)
  )
  const urteile = await ladeUrteile(
    dienste.hinweise,
    'sendungskandidat',
    beispiele.filter((z) => z.entscheid === 'weitergereicht').map((z) => z.id)
  )

  return {
    entscheide: beispiele.map((z) => ({
      titel: z.titel,
      gemeinde: z.gemeinde?.name ?? '',
      entscheid: z.entscheid as SendungEintrag['entscheid'],
      grund: z.ablehnungsgrund,
      kommentar: z.ablehnungskommentar,
      meldungVerworfen: verwuerfe.get(z.id) ?? null,
      faehrte: urteile.get(z.id) ?? null
    })),
    rahmen: {
      bilanz: bilanzZeile(
        bilanz(imFenster),
        `der letzten ${BILANZ_TAGE} Tage dieser Sendung`
      ),
      verfallene: verfallene.map((z) => z.titel),
      kappung: deklariereKappung(alleEntschiedenen.length, beispiele.length)
    }
  }
}
