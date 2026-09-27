import { describe, expect, it } from 'vitest'
import { tagBereit } from './api'

const stand = [
  { bfs: '2765', ausgezaehlt: true },
  { bfs: '2761', ausgezaehlt: true },
  { bfs: '2999', ausgezaehlt: false }
]

describe('tagBereit — wann der Lauf die Meldungen schreibt', () => {
  it('wartet, solange eine bespielte Gemeinde auszaehlt', () => {
    expect(tagBereit({ unsereBfs: ['2765', '2999'], stand })).toBe(false)
  })

  it('schreibt, sobald alle bespielten ausgezaehlt sind — ohne auf den Bund zu warten', () => {
    expect(tagBereit({ unsereBfs: ['2765', '2761'], stand })).toBe(true)
  })

  it('schreibt nichts ohne eine einzige bespielte Gemeinde', () => {
    expect(tagBereit({ unsereBfs: [], stand })).toBe(false)
  })
})
