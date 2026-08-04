import { describe, expect, it } from 'vitest'
import { normalizeNotePayload } from './normalize'

describe('normalizeNotePayload', () => {
  it('trims the title', () => {
    expect(normalizeNotePayload({ title: '  Sitzung  ' }).title).toBe('Sitzung')
  })

  it('clears every summary field when the body changes', () => {
    const next = normalizeNotePayload({ body: 'neuer Text' })

    expect(next.ai_summary).toBeNull()
    expect(next.ai_summary_tags).toBeNull()
    expect(next.ai_summary_generated_at).toBeNull()
  })

  it('keeps the summary when the write is the summary itself', () => {
    const next = normalizeNotePayload({
      ai_summary: 'Kurz.',
      ai_summary_tags: ['protokoll'],
      ai_summary_generated_at: '2026-07-29T10:00:00Z'
    })

    expect(next.ai_summary).toBe('Kurz.')
    expect(next.ai_summary_tags).toEqual(['protokoll'])
    expect(next.ai_summary_generated_at).toBe('2026-07-29T10:00:00Z')
  })

  it('does not clear the summary on unrelated writes', () => {
    expect(normalizeNotePayload({ status: 'published' })).toEqual({
      status: 'published'
    })
  })

  it('does not clear a summary written together with the body', () => {
    const next = normalizeNotePayload({
      body: 'neuer Text',
      ai_summary: 'passend'
    })

    expect(next.ai_summary).toBe('passend')
  })

  it('leaves the incoming payload untouched', () => {
    const payload = { body: 'neuer Text' }

    normalizeNotePayload(payload)

    expect(payload).toEqual({ body: 'neuer Text' })
  })
})
