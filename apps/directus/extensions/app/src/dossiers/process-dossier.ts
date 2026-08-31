import { completeJson, type MessageSender } from '../shared/claude'
import { editionFields } from './edition-fields'
import { parseDossier, type Segment } from './pdf-parser'
import type { SrgssrClient, SrgssrEpisode } from './srgssr-client'
import {
  buildTopicsPrompt,
  parseExtraTopicHeadlines,
  parseTopicsAnswer,
  TOPICS_SYSTEM_PROMPT,
  type ResolvedExtraTopic
} from './topics-prompt'
import type { Dossier, Edition } from '../types/schema'

// Orchestrates turning one `dossiers` row into one or more `editions` rows.
// Shared by the manual endpoint (src/endpoints/dossier-process) and the scheduled
// operation (src/operations/dossiers-process-pending) - same reasoning as
// notes-summary/prompt.ts being reused by notes-summarize-pending: one place, so
// the two call sites cannot silently diverge.
//
// Every collaborator is injected (see ProcessDossierDeps) rather than imported
// directly, including how the PDF's bytes get read out of Directus Files - this
// keeps the orchestration itself fully unit-testable without a running Directus
// instance, and means the exact Directus AssetsService call (unverified in this
// build - no way to run it without `docker compose up`) lives only in the two
// thin wiring files, not here.

/** The minimal slice of Directus' ItemsService this module needs - satisfied
 * structurally by the real service, and trivially fakeable in tests. */
export interface ItemsServiceLike<T> {
  readOne(key: string, query?: unknown): Promise<T>
  createOne(data: Partial<T>): Promise<string>
  updateOne(key: string, data: Partial<T>): Promise<string>
  readByQuery(query: unknown): Promise<T[]>
}

export interface DossierLogger {
  warn: (obj: unknown, msg?: string) => void
  error: (obj: unknown, msg?: string) => void
}

export interface ProcessDossierDeps {
  dossiers: ItemsServiceLike<Dossier>
  editions: ItemsServiceLike<Edition>
  /** Reads the dossier PDF's bytes out of Directus Files - never the local filesystem. */
  readSourceFile: (fileId: string) => Promise<Buffer>
  srgssrClient: SrgssrClient
  logger: DossierLogger
  /** Injectable seam for Claude, same pattern as shared/claude.ts's MessageSender - tests never hit the network. */
  sendToClaude?: MessageSender
}

export interface ProcessDossierResult {
  dossierId: string
  status: 'processed' | 'failed'
  editionIds: string[]
}

async function extractTopics(
  segment: Segment,
  headlines: string[],
  deps: ProcessDossierDeps
): Promise<ResolvedExtraTopic[]> {
  const fallback = headlines.map((headline) => ({
    headline,
    paragraphTimestamp: null,
    paragraphSeconds: null,
    summary: null
  }))
  if (headlines.length === 0) return fallback

  try {
    const answer = await completeJson<unknown>(
      {
        system: TOPICS_SYSTEM_PROMPT,
        prompt: buildTopicsPrompt(segment.paragraphs, headlines),
        // A real dossier's transcript can run 30+ paragraphs, and the model has to
        // read the whole thing per headline before answering - 2048 truncated on a
        // real segment (confirmed via a real dossier run), even though the JSON
        // answer itself is short.
        maxTokens: 8192
      },
      deps.sendToClaude
    )
    return parseTopicsAnswer(answer, headlines, segment.paragraphs)
  } catch (error) {
    // A malformed/truncated Claude answer degrades to "no topic matched" rather
    // than aborting the whole segment - the headline still gets shown, just
    // without a listen link, same as the old PoC's behaviour for an unmatched topic.
    deps.logger.warn(
      error,
      `process-dossier: topic extraction failed for "${segment.headline}"`
    )
    return fallback
  }
}

async function resolveSegmentEpisode(
  segment: Segment,
  deps: ProcessDossierDeps
): Promise<{ episode: SrgssrEpisode | null; resolutionError: string | null }> {
  try {
    return {
      episode: await deps.srgssrClient.resolveEpisode(
        segment.headline,
        segment.broadcastDate
      ),
      resolutionError: null
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.logger.warn(
      error,
      `process-dossier: could not resolve SRGSSR episode for "${segment.headline}"`
    )
    return { episode: null, resolutionError: message }
  }
}

async function upsertEdition(
  segment: Segment,
  dossierId: string,
  fields: ReturnType<typeof editionFields>,
  deps: ProcessDossierDeps
): Promise<string> {
  const existing = await deps.editions.readByQuery({
    filter: {
      dossier: { _eq: dossierId },
      headline: { _eq: segment.headline },
      broadcast_date: { _eq: segment.broadcastDate }
    },
    limit: 1,
    fields: ['id']
  })

  const existingId = existing[0]?.id
  if (existingId) {
    await deps.editions.updateOne(existingId, fields)
    return existingId
  }

  return deps.editions.createOne({
    ...fields,
    dossier: dossierId,
    headline: segment.headline,
    broadcast_date: segment.broadcastDate
  })
}

async function processSegment(
  segment: Segment,
  dossierId: string,
  deps: ProcessDossierDeps
): Promise<string> {
  const { episode, resolutionError } = await resolveSegmentEpisode(
    segment,
    deps
  )
  const headlines = parseExtraTopicHeadlines(episode?.description ?? null)
  const extraTopics = await extractTopics(segment, headlines, deps)
  const fields = editionFields(segment, episode, extraTopics, resolutionError)
  return upsertEdition(segment, dossierId, fields, deps)
}

export async function processDossier(
  dossierId: string,
  deps: ProcessDossierDeps
): Promise<ProcessDossierResult> {
  // Let a failure here (missing/unreadable dossier) propagate to the caller
  // untouched - the endpoint maps it to 403 the same way notes-summary does,
  // the operation's per-dossier loop catches and logs it like any other item.
  const dossier = await deps.dossiers.readOne(dossierId, {
    fields: ['id', 'source_file']
  })
  await deps.dossiers.updateOne(dossierId, { status: 'processing' })

  try {
    const buffer = await deps.readSourceFile(dossier.source_file)
    const segments = await parseDossier(buffer)

    const editionIds: string[] = []
    for (const segment of segments) {
      editionIds.push(await processSegment(segment, dossierId, deps))
    }

    await deps.dossiers.updateOne(dossierId, {
      status: 'processed',
      processed_at: new Date().toISOString(),
      error_message: null
    })
    return { dossierId, status: 'processed', editionIds }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.dossiers.updateOne(dossierId, {
      status: 'failed',
      processed_at: new Date().toISOString(),
      error_message: message
    })
    deps.logger.error(
      error,
      `process-dossier: failed to process dossier ${dossierId}`
    )
    return { dossierId, status: 'failed', editionIds: [] }
  }
}
