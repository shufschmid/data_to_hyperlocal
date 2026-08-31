import type { Paragraph } from '../shared/pdf-text'
import type { TelebaselSegment } from './telebasel-client'

// Replaces, for Punkt6, what topics-prompt.ts needs Claude for in the
// Regionaljournal pipeline (matching a headline to a transcript timestamp):
// telebasel.ch already hands over exact, pre-computed segment boundaries (see
// telebasel-client.ts), so slicing the transcript by them is a pure lookup, no
// model call and no heuristic required.

export interface SlicedSegment {
  headline: string
  startSeconds: number
  endSeconds: number
  paragraphs: Paragraph[]
}

export function sliceTranscriptBySegments(
  paragraphs: readonly Paragraph[],
  segments: readonly TelebaselSegment[]
): SlicedSegment[] {
  return segments.map((segment) => ({
    headline: segment.name,
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    paragraphs: paragraphs.filter(
      (p) => p.seconds >= segment.startSeconds && p.seconds < segment.endSeconds
    )
  }))
}
