import { describe, expect, it } from 'vitest'
import { sliceTranscriptBySegments } from './segment-slicer'

function paragraph(seconds: number, text: string) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0')
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const s = String(seconds % 60).padStart(2, '0')
  return { timestamp: `${h}:${m}:${s}`, seconds, text }
}

describe('sliceTranscriptBySegments', () => {
  it('assigns each paragraph to the segment whose [start, end) interval contains it', () => {
    const paragraphs = [
      paragraph(10, 'vor dem ersten Segment'),
      paragraph(49, 'im ersten Segment'),
      paragraph(120, 'noch im ersten Segment'),
      paragraph(126, 'im zweiten Segment'),
      paragraph(300, 'auch im zweiten Segment')
    ]
    const segments = [
      { name: 'Erstes Thema', startSeconds: 49, endSeconds: 126 },
      { name: 'Zweites Thema', startSeconds: 126, endSeconds: 400 }
    ]

    const sliced = sliceTranscriptBySegments(paragraphs, segments)

    expect(sliced).toHaveLength(2)
    expect(sliced[0]).toMatchObject({
      headline: 'Erstes Thema',
      startSeconds: 49,
      endSeconds: 126
    })
    expect(sliced[0]!.paragraphs.map((p) => p.text)).toEqual([
      'im ersten Segment',
      'noch im ersten Segment'
    ])
    expect(sliced[1]!.paragraphs.map((p) => p.text)).toEqual([
      'im zweiten Segment',
      'auch im zweiten Segment'
    ])
  })

  it('returns an empty paragraph list for a segment with no matching transcript text', () => {
    const sliced = sliceTranscriptBySegments(
      [paragraph(500, 'weit dahinter')],
      [{ name: 'Leeres Thema', startSeconds: 0, endSeconds: 100 }]
    )
    expect(sliced[0]!.paragraphs).toEqual([])
  })

  it('returns one entry per segment, in segment order, even with an empty transcript', () => {
    const sliced = sliceTranscriptBySegments(
      [],
      [
        { name: 'A', startSeconds: 0, endSeconds: 10 },
        { name: 'B', startSeconds: 10, endSeconds: 20 }
      ]
    )
    expect(sliced.map((s) => s.headline)).toEqual(['A', 'B'])
  })
})
