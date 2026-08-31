import { completeJson, type MessageSender } from '../shared/claude'
import {
  buildInventarPrompt,
  gemeindeTreffer,
  INVENTAR_SCHEMA,
  INVENTAR_SYSTEM_PROMPT,
  lernDigest,
  parseInventar,
  darfWeg,
  type AufraeumZeile,
  type LernEintrag,
  type SendungsQuelle
} from './sendung'
import type {
  ExtraTopic,
  Punkt6ExtraTopic,
  TranscriptParagraph
} from '../types/schema'

// Turning broadcast contributions into municipality candidates.
//
// Deliberately a SEPARATE step after the ported pipeline rather than a hook
// inside it: `dossiers/` and `punkt6/` came over from the sister project
// unchanged, and keeping them that way means the next fix over there is a copy,
// not a merge. Everything the newsroom added lives here.
//
// The cheap filter runs first and does most of the work: both shows are
// Basel-heavy, and on most days no contribution names a covered municipality at
// all. No match, no model call.

interface ItemsServiceLike {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  createOne(payload: Record<string, unknown>): Promise<string | number>
  deleteMany?(keys: string[]): Promise<unknown>
}

export interface SichtungKontext {
  kandidaten: ItemsServiceLike
  logger: { warn: (e: unknown, m?: string) => void }
  /** Test seam, exactly as in shared/claude.ts. */
  send?: MessageSender
  model?: string | null
}

export interface GemeindeZeile {
  id: string
  name: string
}

/** One contribution, already sliced out of whichever show it came from. */
export interface SichtungsBeitrag {
  titel: string
  text: string
  zeitmarkeSekunden: number | null
}

/**
 * The whole text a contribution is judged on.
 *
 * A Regionaljournal edition carries its transcript plus separately summarised
 * extra topics; a punkt6 edition carries the whole episode and slices it by
 * telebasel.ch's own boundaries. Both end up here as plain contributions.
 */
export function beitraegeAusEdition(edition: {
  headline: string
  lead: string | null
  transcript: TranscriptParagraph[] | null
  extra_topics: ExtraTopic[] | null
}): SichtungsBeitrag[] {
  const volltext = (edition.transcript ?? []).map((p) => p.text).join('\n')
  const beitraege: SichtungsBeitrag[] = [
    {
      titel: edition.headline,
      text: [edition.lead ?? '', volltext].filter((t) => t !== '').join('\n\n'),
      zeitmarkeSekunden: null
    }
  ]
  for (const thema of edition.extra_topics ?? []) {
    beitraege.push({
      titel: thema.headline,
      text: [thema.headline, thema.summary ?? '']
        .filter((t) => t !== '')
        .join('\n'),
      zeitmarkeSekunden: thema.paragraphSeconds
    })
  }
  return beitraege
}

export function beitraegeAusPunkt6(edition: {
  headline: string
  lead: string | null
  transcript: TranscriptParagraph[] | null
  extra_topics: Punkt6ExtraTopic[] | null
  main_start_seconds: number | null
  main_end_seconds: number | null
}): SichtungsBeitrag[] {
  const absaetze = edition.transcript ?? []
  const schnitt = (von: number | null, bis: number | null): string =>
    absaetze
      .filter(
        (p) =>
          (von === null || p.seconds >= von) &&
          (bis === null || p.seconds < bis)
      )
      .map((p) => p.text)
      .join('\n')

  const beitraege: SichtungsBeitrag[] = [
    {
      titel: edition.headline,
      text: [
        edition.lead ?? '',
        schnitt(edition.main_start_seconds, edition.main_end_seconds)
      ]
        .filter((t) => t !== '')
        .join('\n\n'),
      zeitmarkeSekunden: edition.main_start_seconds
    }
  ]
  for (const thema of edition.extra_topics ?? []) {
    beitraege.push({
      titel: thema.headline,
      text: [thema.summary ?? '', schnitt(thema.startSeconds, thema.endSeconds)]
        .filter((t) => t !== '')
        .join('\n\n'),
      zeitmarkeSekunden: thema.startSeconds
    })
  }
  return beitraege
}

export interface SichtungErgebnis {
  geprueft: number
  mitTreffer: number
  kandidaten: number
}

/** How many past decisions ride into the inventory as examples. */
const LERN_FENSTER = 20

/**
 * One inventory call per contribution that names a covered municipality.
 *
 * Bounded by construction: a Regionaljournal edition has a handful of topics, a
 * punkt6 episode half a dozen Beiträge, and the pre-filter drops most of them
 * before a call is made.
 */
export async function sichteBeitraege(
  beitraege: readonly SichtungsBeitrag[],
  bezug: {
    quelle: SendungsQuelle
    datum: string
    /** Exactly one is set — the same shape as `lauf`/`spiel` on a Meldung. */
    edition?: string
    punkt6Edition?: string
  },
  gemeinden: readonly GemeindeZeile[],
  kontext: SichtungKontext
): Promise<SichtungErgebnis> {
  const ergebnis: SichtungErgebnis = {
    geprueft: 0,
    mitTreffer: 0,
    kandidaten: 0
  }
  if (gemeinden.length === 0) return ergebnis

  const namen = gemeinden.map((g) => g.name)
  const jeName = new Map(gemeinden.map((g) => [g.name, g.id]))

  const gelernt = (await kontext.kandidaten.readByQuery({
    filter: { quelle: { _eq: bezug.quelle }, entscheid: { _neq: 'offen' } },
    fields: ['titel', 'gemeinde.name', 'entscheid', 'ablehnungsgrund'],
    sort: ['-date_updated'],
    limit: LERN_FENSTER
  })) as {
    titel: string
    gemeinde: { name: string } | null
    entscheid: LernEintrag['entscheid']
    ablehnungsgrund: string | null
  }[]
  const digest = lernDigest(
    gelernt.map((g) => ({
      titel: g.titel,
      gemeinde: g.gemeinde?.name ?? '',
      entscheid: g.entscheid,
      grund: g.ablehnungsgrund
    })),
    LERN_FENSTER
  )

  for (const beitrag of beitraege) {
    ergebnis.geprueft += 1
    const treffer = gemeindeTreffer(`${beitrag.titel}\n${beitrag.text}`, namen)
    if (treffer.length === 0) continue
    ergebnis.mitTreffer += 1

    try {
      const antwort = await completeJson<unknown>(
        {
          system: INVENTAR_SYSTEM_PROMPT,
          prompt: buildInventarPrompt(
            {
              titel: beitrag.titel,
              text: beitrag.text,
              sendung: bezug.quelle,
              datum: bezug.datum
            },
            treffer,
            digest
          ),
          maxTokens: 2048,
          model: kontext.model ?? undefined,
          schema: INVENTAR_SCHEMA
        },
        kontext.send
      )

      for (const kandidat of parseInventar(antwort, treffer)) {
        const gemeindeId = jeName.get(kandidat.gemeinde)
        if (gemeindeId === undefined) continue
        await kontext.kandidaten.createOne({
          quelle: bezug.quelle,
          gemeinde: gemeindeId,
          titel: kandidat.titel,
          zusammenfassung: kandidat.zusammenfassung,
          begruendung: kandidat.begruendung,
          zeitmarke_sekunden: beitrag.zeitmarkeSekunden,
          ...(bezug.edition === undefined ? {} : { edition: bezug.edition }),
          ...(bezug.punkt6Edition === undefined
            ? {}
            : { punkt6_edition: bezug.punkt6Edition })
        })
        ergebnis.kandidaten += 1
      }
    } catch (fehler) {
      // One unreadable contribution never costs the rest of the show its
      // inventory — the same posture as the per-segment SRGSSR failures the
      // ported pipeline already takes.
      kontext.logger.warn(fehler, `Sichtung fehlgeschlagen: "${beitrag.titel}"`)
    }
  }

  return ergebnis
}

/**
 * The whole step, for one show's freshly processed contributions.
 *
 * One line at each of the four call sites (two endpoints, two operations), and
 * a failure here NEVER fails the processing that produced the editions: the
 * broadcast review is the thing this project ported, the municipality
 * candidates are the thing it added, and the added thing must not break the
 * ported one.
 */
export async function sichteSendung(
  editionIds: readonly string[],
  quelle: SendungsQuelle,
  dienste: {
    editions: ItemsServiceLike & {
      readByQuery(query: Record<string, unknown>): Promise<unknown[]>
    }
    kandidaten: ItemsServiceLike
    gemeinden: ItemsServiceLike
    logger: { warn: (e: unknown, m?: string) => void }
    model?: string | null
    send?: MessageSender
  }
): Promise<SichtungErgebnis> {
  const leer: SichtungErgebnis = { geprueft: 0, mitTreffer: 0, kandidaten: 0 }
  if (editionIds.length === 0) return leer

  try {
    const gemeinden = (await dienste.gemeinden.readByQuery({
      filter: { aktiv: { _eq: true } },
      fields: ['id', 'name'],
      limit: -1
    })) as GemeindeZeile[]

    const felder =
      quelle === 'punkt6'
        ? [
            'id',
            'headline',
            'lead',
            'transcript',
            'extra_topics',
            'broadcast_date',
            'main_start_seconds',
            'main_end_seconds'
          ]
        : [
            'id',
            'headline',
            'lead',
            'transcript',
            'extra_topics',
            'broadcast_date'
          ]

    const editions = (await dienste.editions.readByQuery({
      filter: { id: { _in: [...editionIds] } },
      fields: felder,
      limit: -1
    })) as Record<string, unknown>[]

    const gesamt: SichtungErgebnis = {
      geprueft: 0,
      mitTreffer: 0,
      kandidaten: 0
    }
    for (const edition of editions) {
      const id = String(edition['id'])
      const beitraege =
        quelle === 'punkt6'
          ? beitraegeAusPunkt6(
              edition as unknown as Parameters<typeof beitraegeAusPunkt6>[0]
            )
          : beitraegeAusEdition(
              edition as unknown as Parameters<typeof beitraegeAusEdition>[0]
            )

      const teil = await sichteBeitraege(
        beitraege,
        {
          quelle,
          datum: String(edition['broadcast_date'] ?? ''),
          ...(quelle === 'punkt6' ? { punkt6Edition: id } : { edition: id })
        },
        gemeinden,
        {
          kandidaten: dienste.kandidaten,
          logger: dienste.logger,
          ...(dienste.model === undefined ? {} : { model: dienste.model }),
          ...(dienste.send === undefined ? {} : { send: dienste.send })
        }
      )
      gesamt.geprueft += teil.geprueft
      gesamt.mitTreffer += teil.mitTreffer
      gesamt.kandidaten += teil.kandidaten
    }
    return gesamt
  } catch (fehler) {
    dienste.logger.warn(
      fehler,
      `Sichtung der Sendung ${quelle} fehlgeschlagen.`
    )
    return leer
  }
}

/**
 * Undecided candidates the desk has stopped caring about.
 *
 * Run at the top of the daily processing, before anything new arrives — a
 * broadcast candidate is perishable, and decided rows are never touched.
 */
export async function raeumeKandidatenAuf(
  kandidaten: ItemsServiceLike,
  heute: string,
  logger: { warn: (e: unknown, m?: string) => void }
): Promise<number> {
  try {
    const offene = (await kandidaten.readByQuery({
      filter: { entscheid: { _eq: 'offen' } },
      fields: ['id', 'entscheid', 'date_created'],
      limit: -1
    })) as AufraeumZeile[]

    const weg = offene.filter((z) => darfWeg(z, heute)).map((z) => z.id)
    if (weg.length > 0 && kandidaten.deleteMany !== undefined) {
      await kandidaten.deleteMany(weg)
      return weg.length
    }
    return 0
  } catch (fehler) {
    logger.warn(fehler, 'Aufraeumen der Sendungskandidaten fehlgeschlagen.')
    return 0
  }
}
