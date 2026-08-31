import { describe, expect, it } from 'vitest'
import { selectPendingDossiers } from './pending'

describe('selectPendingDossiers', () => {
  const candidates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('caps the batch at the given limit', () => {
    expect(selectPendingDossiers(candidates, 2)).toEqual([
      { id: 'a' },
      { id: 'b' }
    ])
  })

  it('falls back to a default of 5 for a non-finite, zero or negative limit', () => {
    expect(selectPendingDossiers(candidates, NaN)).toHaveLength(3) // all 3 fit under the fallback of 5
    expect(selectPendingDossiers(candidates, 0)).toHaveLength(3)
    expect(selectPendingDossiers(candidates, -1)).toHaveLength(3)
  })

  it('floors a fractional limit', () => {
    expect(selectPendingDossiers(candidates, 1.9)).toEqual([{ id: 'a' }])
  })
})
