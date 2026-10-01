import { describe, expect, it } from 'vitest'
import { einstellungAus } from './index'

// Der genaue Zweck schlaegt den Tisch, der Tisch schlaegt nichts.
describe('einstellungAus', () => {
  const zeilen = new Map([
    [
      'amtsblatt',
      {
        zweck: 'amtsblatt',
        modell: 'claude-haiku-4-5-20251001',
        max_tokens: null
      }
    ],
    [
      'amtsblatt:plaene',
      { zweck: 'amtsblatt:plaene', modell: null, max_tokens: 6000 }
    ]
  ])

  it('findet Zweck vor Tisch und gibt null, wo nichts eingestellt ist', () => {
    expect(einstellungAus(zeilen, 'amtsblatt:plaene')).toEqual({
      modell: null,
      max_tokens: 6000
    })
    expect(einstellungAus(zeilen, 'amtsblatt:sichtung')).toEqual({
      modell: 'claude-haiku-4-5-20251001',
      max_tokens: null
    })
    expect(einstellungAus(zeilen, 'kanton:sichtung')).toBeNull()
  })
})
