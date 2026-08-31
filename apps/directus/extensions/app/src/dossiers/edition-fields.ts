import type { Segment } from './pdf-parser'
import type { ResolvedExtraTopic } from './topics-prompt'
import type { SrgssrEpisode } from './srgssr-client'
import type { Edition, EditionLabel } from '../types/schema'

/**
 * Maps a parsed segment + its (possibly absent) resolved SRGSSR episode + its
 * (possibly all-unmatched) extra topics onto the `editions` collection's fields -
 * one place, shared by process-dossier.ts's create and update paths, so they
 * cannot drift apart. Never sets `dossier`/`headline`/`broadcast_date` - those are
 * the identifying key used to find an existing row and are set by the caller.
 */
export function editionFields(
  segment: Segment,
  episode: SrgssrEpisode | null,
  extraTopics: ResolvedExtraTopic[],
  resolutionError: string | null
): Omit<
  Edition,
  | 'id'
  | 'dossier'
  | 'headline'
  | 'broadcast_date'
  | 'date_created'
  | 'date_updated'
> {
  return {
    broadcast_at: episode?.date ?? null,
    edition_label: episode ? editionLabelFromIsoDate(episode.date) : null,
    lead: episode?.lead ?? segment.teaserBlocks[0] ?? null,
    teaser_blocks: segment.teaserBlocks,
    audio_url: episode?.podcastHdUrl ?? episode?.podcastSdUrl ?? null,
    srgssr_urn: episode?.urn ?? null,
    transcript: segment.paragraphs,
    extra_topics: extraTopics,
    resolution_error: resolutionError
  }
}

/**
 * Derived from the hour of the SRGSSR episode's own `date` (already in Swiss
 * local time, offset included in the ISO string) - not from parsing the
 * transcript text. Calibrated against the real sample data: 06:31 -> Morgen,
 * 12:03 -> Mittag, 17:30 -> Abend.
 */
export function editionLabelFromIsoDate(isoDate: string): EditionLabel {
  const hour = Number(isoDate.slice(11, 13))
  if (hour < 11) return 'Morgen'
  if (hour < 16) return 'Mittag'
  return 'Abend'
}
