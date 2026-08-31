import { describe, expect, it } from 'vitest'
import { editionFields, editionLabelFromIsoDate } from './edition-fields'
import type { Segment } from './pdf-parser'
import type { SrgssrEpisode } from './srgssr-client'

describe('editionLabelFromIsoDate', () => {
  it('matches the real calibration data', () => {
    expect(editionLabelFromIsoDate('2026-08-17T06:31:00+02:00')).toBe('Morgen')
    expect(editionLabelFromIsoDate('2026-08-17T10:59:00+02:00')).toBe('Morgen')
    expect(editionLabelFromIsoDate('2026-08-17T12:03:00+02:00')).toBe('Mittag')
    expect(editionLabelFromIsoDate('2026-08-17T15:59:00+02:00')).toBe('Mittag')
    expect(editionLabelFromIsoDate('2026-08-16T17:30:00+02:00')).toBe('Abend')
  })
})

describe('editionFields', () => {
  const segment: Segment = {
    broadcastDate: '2026-08-17',
    headline: 'Ziefen wehrt sich gegen Bachem-Parkplatz',
    teaserBlocks: [
      'Der Pharmazulieferer Bachem wollte in Ziefen einen Parkplatz bauen.'
    ],
    paragraphs: [{ timestamp: '00:00:00', seconds: 0, text: 'Text.' }]
  }

  const episode: SrgssrEpisode = {
    urn: 'urn:srf:audio:abc',
    title: segment.headline,
    date: '2026-08-17T12:03:00+02:00',
    lead: 'API lead text.',
    description: null,
    podcastHdUrl: 'https://example.com/a.mp3',
    podcastSdUrl: null
  }

  it('maps a resolved episode onto the edition fields', () => {
    const fields = editionFields(segment, episode, [], null)
    expect(fields.audio_url).toBe('https://example.com/a.mp3')
    expect(fields.srgssr_urn).toBe('urn:srf:audio:abc')
    expect(fields.edition_label).toBe('Mittag')
    expect(fields.broadcast_at).toBe('2026-08-17T12:03:00+02:00')
    expect(fields.lead).toBe('API lead text.')
    expect(fields.transcript).toEqual(segment.paragraphs)
    expect(fields.resolution_error).toBeNull()
  })

  it('falls back to the SD podcast url when no HD url is present', () => {
    const fields = editionFields(
      segment,
      {
        ...episode,
        podcastHdUrl: null,
        podcastSdUrl: 'https://example.com/sd.mp3'
      },
      [],
      null
    )
    expect(fields.audio_url).toBe('https://example.com/sd.mp3')
  })

  it('falls back to the first teaser block for lead when the episode has none', () => {
    const fields = editionFields(segment, { ...episode, lead: null }, [], null)
    expect(fields.lead).toBe(segment.teaserBlocks[0])
  })

  it('leaves audio/urn/edition_label null and records the error when resolution failed', () => {
    const fields = editionFields(segment, null, [], 'No episode found.')
    expect(fields.audio_url).toBeNull()
    expect(fields.srgssr_urn).toBeNull()
    expect(fields.edition_label).toBeNull()
    expect(fields.broadcast_at).toBeNull()
    expect(fields.resolution_error).toBe('No episode found.')
    // still falls back to the PDF's own teaser when there's no episode to take a lead from
    expect(fields.lead).toBe(segment.teaserBlocks[0])
  })

  it('passes the extra topics through unchanged', () => {
    const topics = [
      {
        headline: 'X',
        paragraphTimestamp: '00:00:05',
        paragraphSeconds: 5,
        summary: 'Y'
      }
    ]
    const fields = editionFields(segment, episode, topics, null)
    expect(fields.extra_topics).toBe(topics)
  })
})
