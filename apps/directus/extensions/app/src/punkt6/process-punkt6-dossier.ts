import { completeJson, type MessageSender } from '../shared/claude'
import { punkt6EditionFields, type ResolvedBeitrag } from './edition-fields'
import { parsePunkt6Dossier, type Punkt6Segment } from './pdf-parser'
import { sliceTranscriptBySegments, type SlicedSegment } from './segment-slicer'
import {
  buildSummaryPrompt,
  parseSummaryAnswer,
  SUMMARY_SYSTEM_PROMPT,
  type SegmentLead
} from './summary-prompt'
import type { TelebaselClient, TelebaselEpisode } from './telebasel-client'
import type { Punkt6Dossier, Punkt6Edition } from '../types/schema'

// Orchestrates turning one `punkt6_dossiers` row into ONE `punkt6_editions` row -
// one row per Sendung (episode), same shape as one Regionaljournal `dossiers` row
// turning into one `editions` row with its Hauptbeitrag plus `extra_topics`
// (dossiers/process-dossier.ts). Earlier versions of this module created one
// edition PER Beitrag; that was a misreading of the intended editorial shape -
// a Sendung is reviewed and published as a single piece, one shared video, with
// the further Beitraege listed underneath the Hauptbeitrag, exactly like
// Regionaljournal's extra_topics.
//
// Shared by the manual endpoint (src/endpoints/punkt6-dossier-process) and the
// scheduled operation (src/operations/punkt6-dossiers-process-pending) - same
// "one shared module, two thin callers" shape as dossiers/process-dossier.ts.

/** The minimal slice of Directus' ItemsService this module needs. */
export interface ItemsServiceLike<T> {
  readOne(key: string, query?: unknown): Promise<T>
  createOne(data: Partial<T>): Promise<string>
  updateOne(key: string, data: Partial<T>): Promise<string>
  readByQuery(query: unknown): Promise<T[]>
}

export interface Punkt6Logger {
  warn: (obj: unknown, msg?: string) => void
  error: (obj: unknown, msg?: string) => void
}

export interface ProcessPunkt6DossierDeps {
  dossiers: ItemsServiceLike<Punkt6Dossier>
  editions: ItemsServiceLike<Punkt6Edition>
  /** Reads the dossier PDF's bytes out of Directus Files - never the local filesystem. */
  readSourceFile: (fileId: string) => Promise<Buffer>
  telebaselClient: TelebaselClient
  logger: Punkt6Logger
  /** Injectable seam for Claude, same pattern as shared/claude.ts's MessageSender - tests never hit the network. */
  sendToClaude?: MessageSender
  /**
   * Defaults to the real parsePunkt6Dossier (pdfjs-dist). Overridable in tests so
   * they can run without a real PDF fixture when one isn't the point of the test.
   */
  parseDossier?: (buffer: Buffer) => Promise<Punkt6Segment>
  /** Today as ISO "YYYY-MM-DD" - injectable so tests can pin the marker patience window. */
  heute?: string
}

export interface ProcessPunkt6DossierResult {
  dossierId: string
  /**
   * 'wartet': the episode resolved (video, transcript) but telebasel.ch has not
   * published its Beitrag markers yet - the dossier stays 'pending' so the daily
   * run retries, and the municipality Sichtung is deliberately NOT run yet
   * (a whole-show blob makes poor candidates, and the real ones follow).
   */
  status: 'processed' | 'failed' | 'wartet'
  editionId: string | null
}

/** How many days after the broadcast the pipeline keeps waiting for markers. */
const MARKER_GEDULD_TAGE = 3

/**
 * telebasel.ch publishes a fresh episode WITHOUT its schema.org Clip blocks and
 * adds them later (measured 2026-09-01: the 31.08. page had video but zero
 * `hasPart` entries ~17h after airing, while the 30.08. page carried five). And
 * markers that DO exist can belong to a different edit than the broadcast the
 * transcript describes (same day: an episode titled "31.08." carried next-day
 * stories, one of five markers matching). Either way the segmentation is not
 * usable yet - not an error, just too early. Waiting is bounded: after
 * MARKER_GEDULD_TAGE the unsegmented edition is accepted as final.
 */
export function wartetAufBeitragsmarken(
  episode: TelebaselEpisode | null,
  brauchbarSegmentiert: boolean,
  broadcastDate: string,
  heute: string
): boolean {
  if (episode === null || brauchbarSegmentiert) return false
  const alterTage = (Date.parse(heute) - Date.parse(broadcastDate)) / 86_400_000
  return Number.isFinite(alterTage) && alterTage <= MARKER_GEDULD_TAGE
}

async function resolveEpisode(
  broadcastDate: string,
  deps: ProcessPunkt6DossierDeps
): Promise<{
  episode: TelebaselEpisode | null
  resolutionError: string | null
}> {
  try {
    return {
      episode: await deps.telebaselClient.resolveEpisode(broadcastDate),
      resolutionError: null
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.logger.warn(
      error,
      `process-punkt6-dossier: could not resolve telebasel.ch episode for ${broadcastDate}`
    )
    return { episode: null, resolutionError: message }
  }
}

async function buildLeads(
  slices: SlicedSegment[],
  deps: ProcessPunkt6DossierDeps
): Promise<SegmentLead[]> {
  // `passt: true` in the fallback on purpose: the coherence check only rejects a
  // segmentation on the model's explicit word - an infrastructure failure must
  // degrade to "no leads", never to "throw the segmentation away".
  const fallback: SegmentLead[] = slices.map((s) => ({
    headline: s.headline,
    lead: null,
    passt: true
  }))
  if (slices.length === 0) return fallback

  const summaryInputs = slices.map((s) => ({
    headline: s.headline,
    paragraphs: s.paragraphs
  }))
  try {
    const answer = await completeJson<unknown>(
      {
        system: SUMMARY_SYSTEM_PROMPT,
        prompt: buildSummaryPrompt(summaryInputs),
        maxTokens: 4096
      },
      deps.sendToClaude
    )
    return parseSummaryAnswer(answer, summaryInputs)
  } catch (error) {
    // A malformed/truncated Claude answer degrades to "no lead" rather than
    // aborting the whole dossier - the headline and transcript are still useful
    // editorial content on their own.
    deps.logger.warn(
      error,
      'process-punkt6-dossier: lead generation failed, continuing without leads'
    )
    return fallback
  }
}

/** Resolves the Hauptbeitrag (Beitrag 1) and the rest, both with their Claude leads looked up. */
async function resolveBeitraege(
  segment: Punkt6Segment,
  episode: TelebaselEpisode | null,
  deps: ProcessPunkt6DossierDeps
): Promise<{
  main: ResolvedBeitrag
  extras: ResolvedBeitrag[]
  /** false: no markers, or markers belonging to a different edit - both mean "keep waiting". */
  brauchbar: boolean
}> {
  // telebasel.ch is what tells us how to split the Sendung into Beitraege at all -
  // without it there's no boundary to slice by, so the whole episode becomes a
  // single, unsegmented edition rather than being silently dropped.
  const unsegmentiert = {
    main: {
      headline: segment.headline,
      lead: null,
      startSeconds: null,
      endSeconds: null
    },
    extras: [],
    brauchbar: false
  }

  const slices = episode
    ? sliceTranscriptBySegments(segment.paragraphs, episode.segments)
    : []
  if (slices.length === 0) return unsegmentiert

  const leads = await buildLeads(slices, deps)

  // The lead call doubles as the coherence check: the web cut can be a DIFFERENT
  // edit than the broadcast the transcript describes (measured 2026-09-01: an
  // episode titled "31.08." carried next-day stories, and only one of five
  // markers matched the transcript). Slicing by mismatched markers produces
  // confidently wrong Beitraege - wrong headlines, wrong jump marks - so when
  // most slices do not fit their headline, the segmentation is rejected
  // wholesale and the edition stays unsegmented (and keeps waiting).
  const passend = leads.filter((l) => l.passt).length
  if (passend * 2 < leads.length) {
    deps.logger.warn(
      { passend, segmente: leads.length },
      'process-punkt6-dossier: markers do not match the transcript - segmentation rejected'
    )
    return unsegmentiert
  }

  const leadsByHeadline = new Map(leads.map((l) => [l.headline, l.lead]))
  const toResolved = (s: SlicedSegment): ResolvedBeitrag => ({
    headline: s.headline,
    lead: leadsByHeadline.get(s.headline) ?? null,
    startSeconds: s.startSeconds,
    endSeconds: s.endSeconds
  })

  const [mainSlice, ...restSlices] = slices
  return {
    main: toResolved(mainSlice!),
    extras: restSlices.map(toResolved),
    brauchbar: true
  }
}

async function upsertEdition(
  dossierId: string,
  headline: string,
  broadcastDate: string,
  fields: ReturnType<typeof punkt6EditionFields>,
  deps: ProcessPunkt6DossierDeps
): Promise<string> {
  const existing = await deps.editions.readByQuery({
    filter: { dossier: { _eq: dossierId } },
    limit: 1,
    fields: ['id']
  })

  const existingId = existing[0]?.id
  if (existingId) {
    // headline included on purpose: while telebasel.ch's markers are missing the
    // edition carries the generic show title, and the retry that finally finds
    // them must be able to replace it with the Hauptbeitrag's own headline.
    // `dossier` and `broadcast_date` stay untouched - they are the identity.
    await deps.editions.updateOne(existingId, { ...fields, headline })
    return existingId
  }

  return deps.editions.createOne({
    ...fields,
    dossier: dossierId,
    headline,
    broadcast_date: broadcastDate
  })
}

export async function processPunkt6Dossier(
  dossierId: string,
  deps: ProcessPunkt6DossierDeps
): Promise<ProcessPunkt6DossierResult> {
  // Let a failure here (missing/unreadable dossier) propagate to the caller
  // untouched - the endpoint maps it to 403 the same way dossier-process does,
  // the operation's per-dossier loop catches and logs it like any other item.
  const dossier = await deps.dossiers.readOne(dossierId, {
    fields: ['id', 'source_file']
  })
  await deps.dossiers.updateOne(dossierId, { status: 'processing' })

  try {
    const buffer = await deps.readSourceFile(dossier.source_file)
    const segment = await (deps.parseDossier ?? parsePunkt6Dossier)(buffer)
    const { episode, resolutionError } = await resolveEpisode(
      segment.broadcastDate,
      deps
    )
    const { main, extras, brauchbar } = await resolveBeitraege(
      segment,
      episode,
      deps
    )

    const fields = punkt6EditionFields(
      segment.paragraphs,
      main,
      extras,
      episode,
      resolutionError
    )
    const editionId = await upsertEdition(
      dossierId,
      main.headline,
      segment.broadcastDate,
      fields,
      deps
    )

    // The edition already carries video and transcript - keep it - but the
    // dossier stays 'pending' so the daily run reprocesses it until the markers
    // appear (each retry costs two GETs and no model call while they are
    // missing; the upsert then fills main/extras in place).
    const heute = deps.heute ?? new Date().toISOString().slice(0, 10)
    if (
      wartetAufBeitragsmarken(episode, brauchbar, segment.broadcastDate, heute)
    ) {
      await deps.dossiers.updateOne(dossierId, {
        status: 'pending',
        processed_at: new Date().toISOString(),
        error_message:
          'telebasel.ch has not published Beitrag markers matching this transcript yet - retried daily until they appear.'
      })
      return { dossierId, status: 'wartet', editionId }
    }

    await deps.dossiers.updateOne(dossierId, {
      status: 'processed',
      processed_at: new Date().toISOString(),
      error_message: null
    })
    return { dossierId, status: 'processed', editionId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.dossiers.updateOne(dossierId, {
      status: 'failed',
      processed_at: new Date().toISOString(),
      error_message: message
    })
    deps.logger.error(
      error,
      `process-punkt6-dossier: failed to process dossier ${dossierId}`
    )
    return { dossierId, status: 'failed', editionId: null }
  }
}
