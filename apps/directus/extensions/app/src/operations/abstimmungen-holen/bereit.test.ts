import { describe, expect, it } from 'vitest'
import { tagBereit } from './api'

const stand = [
  { bfs: '2765', ausgezaehlt: true },
  { bfs: '2761', ausgezaehlt: true },
  { bfs: '2999', ausgezaehlt: false }
]

describe('tagBereit — wann der Lauf die Meldungen schreibt', () => {
  it('wartet, solange eine bespielte Gemeinde auszaehlt', () => {
    expect(
      tagBereit({
        unsereBfs: ['2765', '2999'],
        stand,
        bundOffen: 0,
        letzterLauf: true
      })
    ).toBe(false)
  })

  it('schreibt, wenn alle bespielten ausgezaehlt sind und der Bund final ist', () => {
    expect(
      tagBereit({
        unsereBfs: ['2765', '2761'],
        stand,
        bundOffen: 0,
        letzterLauf: false
      })
    ).toBe(true)
  })

  it('wartet auf den Bund, ausser im letzten Lauf des Abends', () => {
    expect(
      tagBereit({
        unsereBfs: ['2765'],
        stand,
        bundOffen: 1,
        letzterLauf: false
      })
    ).toBe(false)
    expect(
      tagBereit({ unsereBfs: ['2765'], stand, bundOffen: 1, letzterLauf: true })
    ).toBe(true)
  })

  it('schreibt nichts ohne eine einzige bespielte Gemeinde', () => {
    expect(
      tagBereit({ unsereBfs: [], stand, bundOffen: 0, letzterLauf: true })
    ).toBe(false)
  })
})
