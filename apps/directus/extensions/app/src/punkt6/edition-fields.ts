import type { Paragraph } from '../shared/pdf-text'
import type { TelebaselEpisode } from './telebasel-client'
import type { Punkt6Edition, Punkt6ExtraTopic } from '../types/schema'

/**
 * One resolved Beitrag - either the Hauptbeitrag or one of the further Beitraege
 * of the same Sendung - with its Claude lead already looked up.
 */
export interface ResolvedBeitrag {
  headline: string
  lead: string | null
  startSeconds: number | null
  endSeconds: number | null
}

/**
 * Maps the whole episode's transcript + its resolved Beitraege (Hauptbeitrag
 * first, the rest as `extra_topics`) + the resolved telebasel.ch episode onto the
 * `punkt6_editions` collection's fields - one row per Sendung, mirroring how
 * dossiers/edition-fields.ts maps one Regionaljournal story plus its extra topics.
 * Never sets `dossier`/`headline`/`broadcast_date` - those are the identifying key
 * used to find an existing row and are set by the caller.
 */
export function punkt6EditionFields(
  wholeTranscript: Paragraph[],
  main: ResolvedBeitrag,
  extraBeitraege: ResolvedBeitrag[],
  episode: TelebaselEpisode | null,
  resolutionError: string | null
): Omit<
  Punkt6Edition,
  | 'id'
  | 'dossier'
  | 'headline'
  | 'broadcast_date'
  | 'date_created'
  | 'date_updated'
> {
  return {
    lead: main.lead,
    transcript: wholeTranscript,
    main_start_seconds: main.startSeconds,
    main_end_seconds: main.endSeconds,
    extra_topics: extraBeitraege.map(toExtraTopic),
    video_url: episode?.videoUrl ?? null,
    episode_url: episode?.url ?? null,
    resolution_error: resolutionError
  }
}

function toExtraTopic(beitrag: ResolvedBeitrag): Punkt6ExtraTopic {
  return {
    headline: beitrag.headline,
    summary: beitrag.lead,
    // Only the Hauptbeitrag can be missing timing (the whole-episode fallback
    // when telebasel.ch resolution fails, see process-punkt6-dossier.ts) - a
    // secondary Beitrag only ever exists once telebasel.ch's segments already
    // resolved it, so its own timing is always present here.
    startSeconds: beitrag.startSeconds ?? 0,
    endSeconds: beitrag.endSeconds ?? 0
  }
}
