import { completeJson, ClaudeFormatError } from '../shared/claude'
import {
  faktenFuer,
  type Abstimmungszeile
} from '../endpoints/redaktion/abstimmung'
import {
  abstimmungsAttributionsWarnung,
  linkWarnungen,
  parseAbstimmungsmeldung,
  zeitWarnungen
} from './abstimmung'
import {
  buildTagesPrompt,
  buildTagesRevision,
  bundWarnungenTag,
  datengrundlageTag,
  mitTagesQuelle,
  stichfragenWarnungenTag,
  tagesFakten,
  TAGES_SYSTEM_PROMPT,
  zahlWarnungenTag,
  type BundErgebnis,
  type TagesFakten
} from './abstimmungstag'
import type { Gemeinde } from '../types/schema'

// The one path from a vote day's stored rows to a summary Meldung — shared by
// the button (`POST /redaktion/abstimmungen/:id/meldung`) and by the Sunday
// run, which writes the drafts by itself once every covered municipality is
// counted (the newsroom's words of 27 September 2026: the newsroom fetches the
// data itself, and when it is there it generates the proposals).
//
// Like the Gemeindeseiten drafts it teaches nothing; an editor publishes,
// revises (and names the most interesting Vorlagen) or discards.

interface ItemsServiceLike {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  readOne(key: string, query?: Record<string, unknown>): Promise<unknown>
  createOne(payload: Record<string, unknown>): Promise<string | number>
  updateOne(
    key: string,
    payload: Record<string, unknown>
  ): Promise<string | number>
}

export interface TagesKontext {
  abstimmungen: ItemsServiceLike
  gemeinden: ItemsServiceLike
  meldungen: ItemsServiceLike
  regeln: readonly string[]
}

/** The stored fields a day summary is built from. */
export const TAGES_FELDER = [
  'id',
  'vote_id',
  'datum',
  'titel',
  'ebene',
  'teile',
  'gemeindezahlen',
  'gemeinden_total',
  'gemeinden_ausgezaehlt',
  'ausgezaehlt',
  'stichfrage_gilt',
  'stichfrage_grund',
  'vergleich',
  'quelle_url',
  'bund'
] as const

type Tageszeile = Abstimmungszeile & { bund?: BundErgebnis | null }

/** Every Vorlage of the day, sorted by `vote_id` — the first one carries the article's foreign key. */
export async function ladeTag(
  abstimmungen: ItemsServiceLike,
  datum: string
): Promise<Tageszeile[]> {
  return (await abstimmungen.readByQuery({
    filter: { datum: { _eq: datum } },
    fields: [...TAGES_FELDER],
    sort: ['vote_id'],
    limit: -1
  })) as Tageszeile[]
}

/**
 * The day's facts for one municipality. Throws the refusals of `faktenFuer`
 * — a municipality still counting ANY Vorlage has no result that day.
 */
export function tagesFaktenAus(
  zeilen: readonly Tageszeile[],
  gemeinde: Pick<Gemeinde, 'name' | 'bfs_nummer'>
): TagesFakten {
  return tagesFakten(
    zeilen.map((zeile) => ({
      fakten: faktenFuer({ zeile, gemeinde }),
      bund: zeile.bund ?? null
    }))
  )
}

export interface Tagesentwurf {
  bericht: { titel: string; lead: string; text: string }
  warnungen: string[]
}

async function schreibe(prompt: string): Promise<unknown> {
  try {
    return await completeJson<unknown>({
      system: TAGES_SYSTEM_PROMPT,
      prompt,
      maxTokens: 1800
    })
  } catch (fehler) {
    // One second attempt at unparseable JSON, the Gemeindeseiten lesson: the
    // run writes these unattended.
    if (!(fehler instanceof ClaudeFormatError)) throw fehler
    return completeJson<unknown>({
      system: TAGES_SYSTEM_PROMPT,
      prompt,
      maxTokens: 1800
    })
  }
}

/** One summary, written and measured against what it was handed. */
export async function schreibeTagesmeldung(
  fakten: TagesFakten,
  prompt: string
): Promise<Tagesentwurf> {
  let bericht = parseAbstimmungsmeldung(await schreibe(prompt))
  let attribution = abstimmungsAttributionsWarnung(
    `${bericht.lead} ${bericht.text}`
  )
  if (attribution !== null) {
    bericht = parseAbstimmungsmeldung(
      await schreibe(
        buildTagesRevision(
          fakten,
          bericht,
          'Nenne den Kanton Basel-Landschaft im Fliesstext als Quelle des Ergebnisses, etwa "nach dem amtlichen Ergebnis des Kantons".'
        )
      )
    )
    attribution = abstimmungsAttributionsWarnung(
      `${bericht.lead} ${bericht.text}`
    )
  }
  const alles = `${bericht.titel} ${bericht.lead} ${bericht.text}`
  return {
    bericht,
    warnungen: [
      ...zeitWarnungen(alles),
      ...zahlWarnungenTag(alles, fakten),
      ...linkWarnungen(alles),
      ...stichfragenWarnungenTag(alles, fakten),
      ...bundWarnungenTag(fakten),
      ...(attribution === null ? [] : [attribution])
    ]
  }
}

export function tagesMeldungsfelder(
  entwurf: Tagesentwurf,
  fakten: TagesFakten
): Record<string, unknown> {
  return {
    titel: entwurf.bericht.titel,
    lead: entwurf.bericht.lead,
    text: mitTagesQuelle(entwurf.bericht.text, fakten),
    zeit_warnungen: entwurf.warnungen.length > 0 ? entwurf.warnungen : null,
    verarbeitung: 'idle',
    anweisung: null,
    fehler: null
  }
}

/** The article of this municipality for this day, if one exists (any Vorlage of the day, not discarded). */
export async function vorhandeneTagesmeldung(
  meldungen: ItemsServiceLike,
  zeilen: readonly { id: string }[],
  gemeindeId: string
): Promise<string | null> {
  if (zeilen.length === 0) return null
  const treffer = (await meldungen.readByQuery({
    filter: {
      abstimmung: { _in: zeilen.map((z) => z.id) },
      gemeinde: { _eq: gemeindeId },
      status: { _neq: 'verworfen' }
    },
    fields: ['id'],
    limit: 1
  })) as { id: string }[]
  return treffer[0]?.id ?? null
}

/** Writes and stores one day summary. The caller checked that none exists. */
export async function legeTagesmeldungAn(
  kontext: TagesKontext,
  zeilen: readonly Tageszeile[],
  gemeinde: Pick<Gemeinde, 'id' | 'name' | 'bfs_nummer'>
): Promise<{ meldung: string; warnungen: string[] }> {
  const erste = zeilen[0]
  if (erste === undefined) throw new Error('Ein Abstimmungstag ohne Vorlage.')
  const fakten = tagesFaktenAus(zeilen, gemeinde)
  const entwurf = await schreibeTagesmeldung(
    fakten,
    buildTagesPrompt(fakten, kontext.regeln)
  )
  const meldung = (await kontext.meldungen.createOne({
    abstimmung: erste.id,
    gemeinde: gemeinde.id,
    status: 'entwurf',
    ...tagesMeldungsfelder(entwurf, fakten),
    datengrundlage: datengrundlageTag(fakten)
  })) as string
  return { meldung, warnungen: entwurf.warnungen }
}

/** How many summaries one run writes — a vote day covers the newsroom's municipalities once. */
export const TAGESMELDUNGEN_JE_LAUF = 20

export interface TagesmeldungenErgebnis {
  geschrieben: string[]
  vorhanden: number
  /** Municipalities still counting or without figures — named, never quietly skipped. */
  offen: string[]
  fehler: string[]
  wartend: number
}

/**
 * A draft for every covered municipality that is fully counted and has no
 * summary yet. Only called by the run once the whole day is complete.
 */
export async function schreibeTagesmeldungen(
  kontext: TagesKontext,
  datum: string,
  gemeinden: ReadonlyArray<Pick<Gemeinde, 'id' | 'name' | 'bfs_nummer'>>,
  hoechstens = TAGESMELDUNGEN_JE_LAUF
): Promise<TagesmeldungenErgebnis> {
  const ergebnis: TagesmeldungenErgebnis = {
    geschrieben: [],
    vorhanden: 0,
    offen: [],
    fehler: [],
    wartend: 0
  }
  const zeilen = await ladeTag(kontext.abstimmungen, datum)
  if (zeilen.length === 0) return ergebnis

  const bfsImTag = new Set(
    zeilen.flatMap((z) => (z.gemeindezahlen ?? []).map((g) => g.bfs))
  )
  const betroffen = gemeinden.filter((g) => bfsImTag.has(String(g.bfs_nummer)))
  for (const gemeinde of betroffen) {
    if (
      (await vorhandeneTagesmeldung(kontext.meldungen, zeilen, gemeinde.id)) !==
      null
    ) {
      ergebnis.vorhanden += 1
      continue
    }
    if (ergebnis.geschrieben.length >= hoechstens) {
      ergebnis.wartend += 1
      continue
    }
    try {
      await legeTagesmeldungAn(kontext, zeilen, gemeinde)
      ergebnis.geschrieben.push(gemeinde.name)
    } catch (fehler) {
      const status = (fehler as { status?: unknown }).status
      if (status === 422) ergebnis.offen.push(gemeinde.name)
      else
        ergebnis.fehler.push(
          `${gemeinde.name}: ${fehler instanceof Error ? fehler.message : 'Fehler'}`
        )
    }
  }
  return ergebnis
}
