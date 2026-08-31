import { describe, expect, it } from 'vitest'
import { punkt6EditionFields, type ResolvedBeitrag } from './edition-fields'
import type { Paragraph } from '../shared/pdf-text'
import type { TelebaselEpisode } from './telebasel-client'

const transcript: Paragraph[] = [
  { timestamp: '00:00:49', seconds: 49, text: 'Zur Demo.' },
  { timestamp: '00:02:06', seconds: 126, text: 'Zu Metrobasel.' }
]

const main: ResolvedBeitrag = {
  headline: 'Polizei geht gegen die Demo vor',
  lead: 'Kurze Zusammenfassung.',
  startSeconds: 49,
  endSeconds: 126
}

const episode: TelebaselEpisode = {
  id: '239377',
  url: 'https://telebasel.ch/sendungen/punkt6/239377',
  broadcastDate: '2026-08-25',
  durationSeconds: 816,
  videoUrl:
    'https://simplex-cdn-media.akamaized.net/content/4062/4063/239377/index.m3u8',
  posterUrl: null,
  segments: []
}

describe('punkt6EditionFields', () => {
  it('maps the Hauptbeitrag and the whole transcript onto the edition fields', () => {
    const fields = punkt6EditionFields(transcript, main, [], episode, null)
    expect(fields.lead).toBe('Kurze Zusammenfassung.')
    expect(fields.transcript).toBe(transcript)
    expect(fields.main_start_seconds).toBe(49)
    expect(fields.main_end_seconds).toBe(126)
    expect(fields.video_url).toBe(episode.videoUrl)
    expect(fields.episode_url).toBe(episode.url)
    expect(fields.resolution_error).toBeNull()
  })

  it('maps extra Beitraege to extra_topics with headline/summary/timing', () => {
    const extra: ResolvedBeitrag = {
      headline: 'Metrobasel diskutiert',
      lead: 'Zusammenfassung zwei.',
      startSeconds: 126,
      endSeconds: 313
    }
    const fields = punkt6EditionFields(transcript, main, [extra], episode, null)
    expect(fields.extra_topics).toEqual([
      {
        headline: 'Metrobasel diskutiert',
        summary: 'Zusammenfassung zwei.',
        startSeconds: 126,
        endSeconds: 313
      }
    ])
  })

  it('leaves video/episode url null and records the error when resolution failed', () => {
    const unresolved: ResolvedBeitrag = {
      headline: 'punkt6 vom 25.08.2026',
      lead: null,
      startSeconds: null,
      endSeconds: null
    }
    const fields = punkt6EditionFields(
      transcript,
      unresolved,
      [],
      null,
      'No episode found.'
    )
    expect(fields.video_url).toBeNull()
    expect(fields.episode_url).toBeNull()
    expect(fields.main_start_seconds).toBeNull()
    expect(fields.resolution_error).toBe('No episode found.')
  })
})
