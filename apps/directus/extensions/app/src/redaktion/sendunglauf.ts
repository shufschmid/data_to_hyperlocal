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
  type SendungsQuelle
} from './sendung'
import { ladeSendungSignale, LERN_FENSTER } from './lernsignale'
import { ladeRegeln, type WissenDienst } from './gedaechtnis'
import {
  automatischeWeitergabe,
  regelnBlock,
  SICHTUNGSREGELN_UEBERSCHRIFT
} from './lernen'
import { reicheWeiter, sendungAlsHinweis } from './weiterreichen'
import { datumDeutsch } from './amtsblatt'
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
  updateMany?(
    keys: string[],
    payload: Record<string, unknown>
  ): Promise<unknown>
  updateOne?(key: string, payload: Record<string, unknown>): Promise<unknown>
}

/** A read-only stand-in where a caller has no service to offer. */
const NICHTS: { readByQuery(): Promise<unknown[]> } = {
  readByQuery: async () => []
}

export interface SichtungKontext {
  kandidaten: ItemsServiceLike
  /**
   * The leads hand-ups became — for the Chefredaktion's verdicts, and for the
   * hand-ups a rule makes (which need `createOne`). Optional: tests.
   */
  hinweise?: {
    readByQuery(query: Record<string, unknown>): Promise<unknown>
    createOne?(payload: Record<string, unknown>): Promise<unknown>
  }
  /** The Meldungen taken-over rows produced — a discarded one is a lesson. */
  meldungen?: { readByQuery(query: Record<string, unknown>): Promise<unknown> }
  /** The rule store — the desk's Sichtung rules ride into every inventory call. */
  wissen?: WissenDienst
  logger: { warn: (e: unknown, m?: string) => void }
  /** Test seam, exactly as in shared/claude.ts. */
  send?: MessageSender
  model?: string | null
  /**
   * Decided candidates of the SAME edition, as `${gemeindeId}|${titel}` keys.
   * A reprocessed edition (telebasel.ch markers arriving late, an editor
   * pressing the button twice) must never re-ask a decided question - the
   * decision rows are the memory.
   */
  bereitsEntschieden?: ReadonlySet<string>
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
  /**
   * True when no passage of the transcript could be located for this topic and
   * `text` is only headline plus the show's own 2-3-sentence summary. The
   * inventory prompt then LABELS it as a summary — asking the HANDELT/ERWAEHNT
   * distinction of a text presented as "Wortlaut" that is no such thing is how
   * a verdict gets computed on false premises.
   */
  nurZusammenfassung?: boolean
}

/**
 * The whole text a contribution is judged on.
 *
 * A Regionaljournal edition carries its transcript plus separately summarised
 * extra topics; a punkt6 edition carries the whole episode and slices it by
 * telebasel.ch's own boundaries. Both end up here as plain contributions.
 *
 * A broadcast has a SHAPE, and ignoring it produced duplicates. The show opens
 * by trailing every topic in one breath ("Eine junge Frau stirbt an einer
 * Überdosis … Das Land zahlt weniger … in Bottmingen …"), then covers each one
 * at length, and sometimes recaps at the end. Handing the whole transcript to
 * the main contribution meant every "Ausserdem" topic was judged TWICE: once
 * inside that full text, once on its own — measured on 22 candidates, six were
 * such pairs, and the copy from the full text carried no timestamp, so it
 * pointed the editor at no passage at all.
 *
 * So each topic now gets its OWN passage, `beitraegeAusPunkt6`-style — its own
 * or none, never a copy of its neighbour's (see the first-claim rule below).
 * Where a topic appears more than once, the long passage is the one that
 * counts — the resolution step already looked for exactly that, "der Timecode,
 * ab dem das Thema wirklich inhaltlich behandelt wird (nicht die blosse
 * Erwaehnung am Anfang)" (`dossiers/topics-prompt.ts`).
 *
 * The main contribution keeps everything the topics do NOT claim, and that is
 * deliberate rather than lazy: it holds the opening trail, its own report, and
 * any story the show never listed under "Ausserdem" — and those are worth real
 * money. Measured in the same run: Tempo 30 in Münchenstein, the tram network
 * rebuild in Muttenz and the southern approach flights over Allschwil had no
 * topic entry of their own and would never have been seen. What remains of a
 * trailed topic there is a single sentence, which the inventory prompt is built
 * to read as "merely mentioned" rather than as a story.
 */
export function beitraegeAusEdition(edition: {
  headline: string
  lead: string | null
  transcript: TranscriptParagraph[] | null
  extra_topics: ExtraTopic[] | null
}): SichtungsBeitrag[] {
  const absaetze = edition.transcript ?? []
  const themen = edition.extra_topics ?? []

  // Where each topic's own coverage begins, in order. A topic the resolution
  // could not place (`paragraphSeconds: null`) claims no passage — it still
  // gets judged on its headline and summary.
  const grenzen = themen
    .map((t) => t.paragraphSeconds)
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b)

  const naechsteGrenze = (von: number): number | null =>
    grenzen.find((g) => g > von) ?? null

  const schnitt = (von: number, bis: number | null): string =>
    absaetze
      .filter((p) => p.seconds >= von && (bis === null || p.seconds < bis))
      .map((p) => p.text)
      .join('\n')

  // Everything before the first topic's own coverage: the opening trail, the
  // main report itself, and whatever the show covered without listing it under
  // "Ausserdem". From the first boundary on, the segments below cover the rest
  // of the broadcast without a gap, so there is nothing else left over.
  const erste = grenzen[0]
  const ungeteilt = absaetze
    .filter((p) => erste === undefined || p.seconds < erste)
    .map((p) => p.text)
    .join('\n')

  const beitraege: SichtungsBeitrag[] = [
    {
      titel: edition.headline,
      text: [edition.lead ?? '', ungeteilt]
        .filter((t) => t !== '')
        .join('\n\n'),
      zeitmarkeSekunden: null
    }
  ]

  // A passage belongs to the FIRST topic that claimed its paragraph. Two topics
  // can resolve to the same one — measured on the 11.09.2026 morning edition,
  // where "Feuerverbote" and "Radio Basilisk" both landed on second 206 — and
  // handing the slice to both produces two contributions with byte-identical
  // text: the Sichtung then judges the same passage twice under two headlines,
  // and a reader gets a passage that is not about its own heading. The later
  // ones keep their timestamp (it is still a usable jump mark) but are labelled
  // `nurZusammenfassung`, exactly like a topic whose passage was never found —
  // which is the honest description of what they now carry.
  const vergeben = new Set<number>()

  for (const thema of themen) {
    const beginn = thema.paragraphSeconds
    const schonVergeben = beginn !== null && vergeben.has(beginn)
    if (beginn !== null) vergeben.add(beginn)

    const eigenerText =
      beginn === null || schonVergeben
        ? ''
        : schnitt(beginn, naechsteGrenze(beginn))
    beitraege.push({
      titel: thema.headline,
      text: [thema.headline, thema.summary ?? '', eigenerText]
        .filter((t) => t !== '')
        .join('\n\n'),
      zeitmarkeSekunden: thema.paragraphSeconds,
      nurZusammenfassung: eigenerText === ''
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
    const eigenerText = schnitt(thema.startSeconds, thema.endSeconds)
    beitraege.push({
      titel: thema.headline,
      text: [thema.summary ?? '', eigenerText]
        .filter((t) => t !== '')
        .join('\n\n'),
      zeitmarkeSekunden: thema.startSeconds,
      nurZusammenfassung: eigenerText === ''
    })
  }

  // Everything no clip claims — before the first, between two, after the last.
  // The Regionaljournal's main contribution keeps unclaimed text by
  // construction; punkt6's clip marks are LITERAL start/end pairs from the
  // page, with no guarantee of covering the show. Without this, a story in one
  // of the gaps reached no prompt at all — the Sichtung judged a broadcast it
  // had never fully read. (The unsegmented fallback is untouched: with no
  // marks at all, the main slice above is already the whole show.)
  const fenster: Array<{ von: number | null; bis: number | null }> = [
    { von: edition.main_start_seconds, bis: edition.main_end_seconds },
    ...(edition.extra_topics ?? []).map((t) => ({
      von: t.startSeconds,
      bis: t.endSeconds
    }))
  ]
  const abgedeckt = (s: number): boolean =>
    fenster.some(
      (f) => (f.von === null || s >= f.von) && (f.bis === null || s < f.bis)
    )
  const rest = absaetze.filter((p) => !abgedeckt(p.seconds))
  if (rest.length > 0) {
    beitraege.push({
      titel: `${edition.headline} — Sendungsteile ohne eigenes Kapitel`,
      text: rest.map((p) => p.text).join('\n'),
      zeitmarkeSekunden: rest[0]?.seconds ?? null
    })
  }
  return beitraege
}

export interface SichtungErgebnis {
  geprueft: number
  mitTreffer: number
  kandidaten: number
}

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

  // What this show's desk taught us — reasons and comments, the
  // Chefredaktion's verdicts on hand-ups, the tally of what was left lying.
  const signale = await ladeSendungSignale(
    {
      zeilen: kontext.kandidaten,
      hinweise: kontext.hinweise ?? NICHTS,
      meldungen: kontext.meldungen ?? NICHTS
    },
    bezug.quelle,
    new Date().toISOString().slice(0, 10)
  )
  const digest = lernDigest(signale.entscheide, LERN_FENSTER, signale.rahmen)
  // What the newsroom taught in words — rules, numbered so an answer can
  // cite one. Loaded once per show, not per contribution.
  const regelzeilen =
    kontext.wissen === undefined
      ? []
      : await ladeRegeln(
          kontext.wissen,
          { bereich: 'sendung', stufe: 'sichtung' },
          { warn: (m: string) => kontext.logger.warn(m) }
        )
  const sichtungsregeln = regelnBlock(regelzeilen, SICHTUNGSREGELN_UEBERSCHRIFT)
  const regeln = sichtungsregeln.text

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
              datum: bezug.datum,
              nurZusammenfassung: beitrag.nurZusammenfassung
            },
            treffer,
            digest,
            regeln
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
        if (kontext.bereitsEntschieden?.has(`${gemeindeId}|${kandidat.titel}`))
          continue
        const neuId = String(
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
        )
        ergebnis.kandidaten += 1

        // A rule the editor armed may hand the candidate straight to the
        // Chefredaktion — as a lead, marked, reversible. Never a Meldung:
        // that still takes a person. Needs the writers a run has and a test
        // may not, so it stays quiet without them.
        const regel = automatischeWeitergabe(
          kandidat,
          sichtungsregeln.nummern,
          regelzeilen
        )
        const legeAn = kontext.hinweise?.createOne
        const aktualisiere = kontext.kandidaten.updateOne
        if (
          regel !== null &&
          legeAn !== undefined &&
          aktualisiere !== undefined
        ) {
          await reicheWeiter(
            {
              hinweise: { createOne: (p) => legeAn.call(kontext.hinweise, p) },
              ursprung: {
                updateOne: (k, p) => aktualisiere.call(kontext.kandidaten, k, p)
              }
            },
            {
              ursprungId: neuId,
              felder: sendungAlsHinweis(
                {
                  id: neuId,
                  titel: kandidat.titel,
                  quelle: bezug.quelle,
                  begruendung: kandidat.begruendung,
                  zusammenfassung: kandidat.zusammenfassung,
                  gemeinde: { id: gemeindeId },
                  datum: datumDeutsch(bezug.datum)
                },
                `Automatisch weitergereicht nach Regel: ${regel.regel}`
              ),
              automatisch: true,
              regel: regel.id
            }
          )
        }
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
    hinweise?: { readByQuery(query: Record<string, unknown>): Promise<unknown> }
    meldungen?: {
      readByQuery(query: Record<string, unknown>): Promise<unknown>
    }
    wissen?: WissenDienst
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

      // A reprocessed edition (late telebasel.ch markers, a second button
      // press) diffs like the press review's re-inventory: its own OPEN
      // candidates are replaced by the fresh Sichtung, decided ones stay and
      // are never re-created - they are the memory.
      const bereitsEntschieden = await ersetzeOffeneKandidaten(
        id,
        quelle,
        dienste.kandidaten
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
          ...(dienste.hinweise === undefined
            ? {}
            : { hinweise: dienste.hinweise }),
          ...(dienste.meldungen === undefined
            ? {}
            : { meldungen: dienste.meldungen }),
          ...(dienste.wissen === undefined ? {} : { wissen: dienste.wissen }),
          logger: dienste.logger,
          bereitsEntschieden,
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
 * Deletes one edition's OPEN candidates (the fresh Sichtung re-creates what
 * still holds) and returns its decided ones as `${gemeindeId}|${titel}` keys,
 * so they are never asked again.
 */
async function ersetzeOffeneKandidaten(
  editionId: string,
  quelle: SendungsQuelle,
  kandidaten: ItemsServiceLike
): Promise<ReadonlySet<string>> {
  const schluessel = quelle === 'punkt6' ? 'punkt6_edition' : 'edition'
  const vorhandene = (await kandidaten.readByQuery({
    filter: { [schluessel]: { _eq: editionId } },
    fields: ['id', 'entscheid', 'titel', 'gemeinde'],
    limit: -1
  })) as { id: string; entscheid: string; titel: string; gemeinde: string }[]

  const offene = vorhandene
    .filter((v) => v.entscheid === 'offen')
    .map((v) => v.id)
  if (offene.length > 0 && kandidaten.deleteMany !== undefined)
    await kandidaten.deleteMany(offene)

  return new Set(
    vorhandene
      .filter((v) => v.entscheid !== 'offen')
      .map((v) => `${v.gemeinde}|${v.titel}`)
  )
}

/**
 * Undecided candidates the desk has stopped caring about, marked `verfallen`.
 *
 * Run at the top of the daily processing, before anything new arrives — a
 * broadcast candidate is perishable, and decided rows are never touched.
 * Marked rather than deleted: a candidate the editor never touched is the
 * loudest form of "too many proposals", and it counts in the next
 * inventory's tally. The desk hides everything that is not open.
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
    if (weg.length > 0 && kandidaten.updateMany !== undefined) {
      await kandidaten.updateMany(weg, { entscheid: 'verfallen' })
      return weg.length
    }
    return 0
  } catch (fehler) {
    logger.warn(fehler, 'Aufraeumen der Sendungskandidaten fehlgeschlagen.')
    return 0
  }
}
