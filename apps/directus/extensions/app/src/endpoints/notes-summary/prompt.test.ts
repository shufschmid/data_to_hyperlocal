import { describe, expect, it } from 'vitest'
import {
  buildSummaryPrompt,
  EmptyNoteError,
  parseSummary,
  summaryFields
} from './prompt'

describe('buildSummaryPrompt', () => {
  it('includes title and body', () => {
    const prompt = buildSummaryPrompt({
      title: 'Sitzung',
      body: 'Wir haben entschieden ...'
    })

    expect(prompt).toContain('Titel: Sitzung')
    expect(prompt).toContain('Wir haben entschieden ...')
  })

  it('works with a title only', () => {
    expect(buildSummaryPrompt({ title: 'Nur Titel', body: null })).toContain(
      '(kein Text)'
    )
  })

  it('refuses a note with neither title nor body', () => {
    expect(() => buildSummaryPrompt({ title: '  ', body: '  ' })).toThrow(
      EmptyNoteError
    )
  })
})

describe('parseSummary', () => {
  it('accepts a well-formed answer', () => {
    expect(
      parseSummary({ summary: 'Kurz.', tags: ['Protokoll', 'TEAM'] })
    ).toEqual({
      summary: 'Kurz.',
      tags: ['protokoll', 'team']
    })
  })

  it('defaults to no tags when the field is missing or wrong', () => {
    expect(parseSummary({ summary: 'Kurz.' }).tags).toEqual([])
    expect(parseSummary({ summary: 'Kurz.', tags: 'protokoll' }).tags).toEqual(
      []
    )
  })

  it('drops non-string and blank tags and caps at five', () => {
    const parsed = parseSummary({
      summary: 'Kurz.',
      tags: ['a', 2, '', 'b', 'c', 'd', 'e', 'f']
    })

    expect(parsed.tags).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('truncates an over-long summary instead of storing it', () => {
    const parsed = parseSummary({ summary: 'x'.repeat(400), tags: [] })

    expect(parsed.summary).toHaveLength(240)
  })

  it('rejects answers without a usable summary', () => {
    expect(() => parseSummary(null)).toThrow()
    expect(() => parseSummary('kurz')).toThrow()
    expect(() => parseSummary({ summary: '   ' })).toThrow()
  })
})

describe('summaryFields', () => {
  const generatedAt = new Date('2026-07-29T10:00:00.000Z')

  it('writes summary, tags and timestamp to their own fields', () => {
    expect(
      summaryFields({ summary: 'Kurz.', tags: ['a', 'b'] }, generatedAt)
    ).toEqual({
      ai_summary: 'Kurz.',
      ai_summary_tags: ['a', 'b'],
      ai_summary_generated_at: '2026-07-29T10:00:00.000Z'
    })
  })

  it('keeps the tag list empty rather than absent', () => {
    expect(
      summaryFields({ summary: 'Kurz.', tags: [] }, generatedAt).ai_summary_tags
    ).toEqual([])
  })
})
