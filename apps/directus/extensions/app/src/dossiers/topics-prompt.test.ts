import { describe, expect, it } from 'vitest'
import {
  buildTopicsPrompt,
  NoExtraTopicsError,
  parseExtraTopicHeadlines,
  parseTopicsAnswer,
  type TranscriptParagraphInput
} from './topics-prompt'

describe('parseExtraTopicHeadlines', () => {
  it('parses a single-bullet "Ausserdem:" description', () => {
    const description =
      'Ausserdem: ·\tMehrere Grosseinsätze fordern Rettungskräfte in Basel'
    expect(parseExtraTopicHeadlines(description)).toEqual([
      'Mehrere Grosseinsätze fordern Rettungskräfte in Basel'
    ])
  })

  it('parses a multi-bullet "Ausserdem in der Sendung:" description', () => {
    const description =
      'Ausserdem in der Sendung:\n\n·\tAmbulanz bei Einsatz im Kleinbasel angegriffen\n·\tSilvia Lerch ist neue Gemeindepräsidentin von Pratteln'
    expect(parseExtraTopicHeadlines(description)).toEqual([
      'Ambulanz bei Einsatz im Kleinbasel angegriffen',
      'Silvia Lerch ist neue Gemeindepräsidentin von Pratteln'
    ])
  })

  it('returns an empty list for null or headline-less descriptions', () => {
    expect(parseExtraTopicHeadlines(null)).toEqual([])
    expect(parseExtraTopicHeadlines('no colon here')).toEqual([])
  })
})

describe('buildTopicsPrompt', () => {
  const paragraphs: TranscriptParagraphInput[] = [
    { timestamp: '00:00:00', seconds: 0, text: 'Intro.' },
    {
      timestamp: '00:05:23',
      seconds: 323,
      text: 'An der Uferstrasse im Kleinbasel...'
    }
  ]

  it('includes every paragraph timestamp and every headline', () => {
    const prompt = buildTopicsPrompt(paragraphs, [
      'Ambulanz bei Einsatz im Kleinbasel angegriffen'
    ])
    expect(prompt).toContain('00:00:00: Intro.')
    expect(prompt).toContain('00:05:23: An der Uferstrasse im Kleinbasel...')
    expect(prompt).toContain('Ambulanz bei Einsatz im Kleinbasel angegriffen')
  })

  it('throws NoExtraTopicsError when there are no headlines to match', () => {
    expect(() => buildTopicsPrompt(paragraphs, [])).toThrow(NoExtraTopicsError)
  })
})

describe('parseTopicsAnswer', () => {
  const paragraphs: TranscriptParagraphInput[] = [
    { timestamp: '00:00:00', seconds: 0, text: 'Intro.' },
    {
      timestamp: '00:05:23',
      seconds: 323,
      text: 'An der Uferstrasse im Kleinbasel...'
    },
    {
      timestamp: '00:07:15',
      seconds: 435,
      text: 'Pratteln hat eine neue Gemeindepraesidentin...'
    }
  ]
  const headlines = [
    'Ambulanz bei Einsatz im Kleinbasel angegriffen',
    'Silvia Lerch ist neue Gemeindepraesidentin von Pratteln'
  ]

  it('resolves a well-formed answer to seconds via the known paragraph list', () => {
    const answer = {
      topics: [
        {
          headline: headlines[0],
          timestamp: '00:05:23',
          summary: 'An der Uferstrasse wurden mehrere Personen verletzt.'
        },
        {
          headline: headlines[1],
          timestamp: '00:07:15',
          summary: 'Pratteln hat eine neue Gemeindepraesidentin.'
        }
      ]
    }
    const resolved = parseTopicsAnswer(answer, headlines, paragraphs)
    expect(resolved).toEqual([
      {
        headline: headlines[0],
        paragraphTimestamp: '00:05:23',
        paragraphSeconds: 323,
        summary: 'An der Uferstrasse wurden mehrere Personen verletzt.'
      },
      {
        headline: headlines[1],
        paragraphTimestamp: '00:07:15',
        paragraphSeconds: 435,
        summary: 'Pratteln hat eine neue Gemeindepraesidentin.'
      }
    ])
  })

  it('leaves a topic unmatched when Claude omits it, rather than throwing', () => {
    const answer = {
      topics: [{ headline: headlines[0], timestamp: '00:05:23', summary: 'x' }]
    }
    const resolved = parseTopicsAnswer(answer, headlines, paragraphs)
    expect(resolved[1]).toEqual({
      headline: headlines[1],
      paragraphTimestamp: null,
      paragraphSeconds: null,
      summary: null
    })
  })

  it('does not trust a timestamp that does not correspond to a real paragraph', () => {
    const answer = {
      topics: [
        { headline: headlines[0], timestamp: '00:59:59', summary: 'invented' }
      ]
    }
    const resolved = parseTopicsAnswer(answer, headlines, paragraphs)
    expect(resolved[0]).toEqual({
      headline: headlines[0],
      paragraphTimestamp: null,
      paragraphSeconds: null,
      summary: null
    })
  })

  it('treats an explicit null timestamp as "no dedicated coverage found"', () => {
    const answer = {
      topics: [{ headline: headlines[0], timestamp: null, summary: null }]
    }
    const resolved = parseTopicsAnswer(answer, headlines, paragraphs)
    expect(resolved[0]!.paragraphTimestamp).toBeNull()
    expect(resolved[0]!.summary).toBeNull()
  })

  it('throws when the top-level answer is not an object', () => {
    expect(() =>
      parseTopicsAnswer('not an object', headlines, paragraphs)
    ).toThrow()
    expect(() => parseTopicsAnswer(null, headlines, paragraphs)).toThrow()
  })

  it('treats a non-array topics field as empty rather than throwing', () => {
    const resolved = parseTopicsAnswer(
      { topics: 'oops' },
      headlines,
      paragraphs
    )
    expect(resolved.every((t) => t.paragraphTimestamp === null)).toBe(true)
  })
})
