import { describe, expect, it } from 'vitest'
import {
  buildSummaryPrompt,
  NoSegmentsError,
  parseSummaryAnswer,
  type SegmentSummaryInput
} from './summary-prompt'

const segments: SegmentSummaryInput[] = [
  {
    headline: 'Erstes Thema',
    paragraphs: [{ timestamp: '00:00:49', text: 'Text zum ersten Thema.' }]
  },
  {
    headline: 'Zweites Thema',
    paragraphs: [{ timestamp: '00:02:06', text: 'Text zum zweiten Thema.' }]
  }
]

describe('buildSummaryPrompt', () => {
  it('includes every headline and its transcript text', () => {
    const prompt = buildSummaryPrompt(segments)
    expect(prompt).toContain('Erstes Thema')
    expect(prompt).toContain('00:00:49: Text zum ersten Thema.')
    expect(prompt).toContain('Zweites Thema')
    expect(prompt).toContain('00:02:06: Text zum zweiten Thema.')
  })

  it('throws NoSegmentsError when there are no segments to summarise', () => {
    expect(() => buildSummaryPrompt([])).toThrow(NoSegmentsError)
  })
})

describe('parseSummaryAnswer', () => {
  it('resolves a well-formed answer by headline, in input order', () => {
    const answer = {
      leads: [
        {
          headline: 'Zweites Thema',
          lead: 'Zusammenfassung zwei.',
          passt: true
        },
        { headline: 'Erstes Thema', lead: 'Zusammenfassung eins.', passt: true }
      ]
    }
    expect(parseSummaryAnswer(answer, segments)).toEqual([
      { headline: 'Erstes Thema', lead: 'Zusammenfassung eins.', passt: true },
      { headline: 'Zweites Thema', lead: 'Zusammenfassung zwei.', passt: true }
    ])
  })

  it('leaves a segment without a lead when Claude omits it, rather than throwing', () => {
    const answer = { leads: [{ headline: 'Erstes Thema', lead: 'x' }] }
    const resolved = parseSummaryAnswer(answer, segments)
    expect(resolved[1]).toEqual({
      headline: 'Zweites Thema',
      lead: null,
      passt: true
    })
  })

  it('carries the coherence verdict, defaulting a missing passt to true', () => {
    const answer = {
      leads: [
        { headline: 'Erstes Thema', lead: null, passt: false },
        { headline: 'Zweites Thema', lead: 'x' }
      ]
    }
    const resolved = parseSummaryAnswer(answer, segments)
    expect(resolved[0]!.passt).toBe(false)
    expect(resolved[1]!.passt).toBe(true)
  })

  it('treats an empty-string lead as null', () => {
    const answer = { leads: [{ headline: 'Erstes Thema', lead: '   ' }] }
    expect(parseSummaryAnswer(answer, segments)[0]!.lead).toBeNull()
  })

  it('throws when the top-level answer is not an object', () => {
    expect(() => parseSummaryAnswer('not an object', segments)).toThrow()
    expect(() => parseSummaryAnswer(null, segments)).toThrow()
  })

  it('treats a non-array leads field as empty rather than throwing', () => {
    const resolved = parseSummaryAnswer({ leads: 'oops' }, segments)
    expect(resolved.every((s) => s.lead === null)).toBe(true)
  })
})
