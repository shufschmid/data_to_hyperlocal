import { describe, expect, it } from 'vitest'
import { selectPendingNotes, type PendingCandidate } from './pending'

function note(overrides: Partial<PendingCandidate> = {}): PendingCandidate {
  return {
    id: 'n1',
    title: 'Titel',
    body: 'Text',
    ai_summary: null,
    ...overrides
  }
}

describe('selectPendingNotes', () => {
  it('picks notes without a summary', () => {
    const picked = selectPendingNotes(
      [
        note({ id: 'a' }),
        note({ id: 'b', ai_summary: 'schon da' }),
        note({ id: 'c', ai_summary: '   ' })
      ],
      10
    )

    expect(picked.map((n) => n.id)).toEqual(['a', 'c'])
  })

  it('skips notes with neither title nor body', () => {
    const picked = selectPendingNotes(
      [note({ id: 'a', title: '  ', body: '  ' }), note({ id: 'b' })],
      10
    )

    expect(picked.map((n) => n.id)).toEqual(['b'])
  })

  it('honours the limit', () => {
    const picked = selectPendingNotes(
      [note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c' })],
      2
    )

    expect(picked).toHaveLength(2)
  })

  it('falls back to ten when the limit is missing or nonsense', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      note({ id: `n${index}` })
    )

    expect(selectPendingNotes(many, Number.NaN)).toHaveLength(10)
    expect(selectPendingNotes(many, 0)).toHaveLength(10)
    expect(selectPendingNotes(many, -5)).toHaveLength(10)
  })
})
