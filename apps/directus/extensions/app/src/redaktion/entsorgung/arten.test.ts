import { describe, expect, it } from 'vitest'
import { istStumm, normalisiereArt } from './arten'

describe('normalisiereArt', () => {
  it('reads the municipalities into one vocabulary', () => {
    expect(normalisiereArt('Grünabfuhr')).toBe('gruengut')
    expect(normalisiereArt('Altmetall')).toBe('metall')
    expect(normalisiereArt('Häckseldienst')).toBe('haecksel')
    expect(normalisiereArt('Sonderabfall-Sammlung')).toBe('sonderabfall')
    expect(normalisiereArt('Tannenbaumabfuhr')).toBe('christbaum')
  })

  it('reads "Papier- und Kartonsammlung" as one collection, not two', () => {
    // The order of the pairs IS the logic. With "papier" ahead of "papier- und
    // karton", one collection is filed twice — once as paper, once as cardboard
    // — and the newsletter announces both.
    expect(normalisiereArt('Papier- und Kartonsammlung')).toBe('papier_karton')
    expect(normalisiereArt('Altpapier und Karton')).toBe('papier_karton')
    expect(normalisiereArt('Papier/Karton')).toBe('papier_karton')
    expect(normalisiereArt('Altpapier')).toBe('papier')
    expect(normalisiereArt('Kartonsammlung')).toBe('karton')
  })

  it('reads "Kehricht und Sperrgut" as Kehricht, not as Sperrgut', () => {
    // Measured in Dorfkoenig: Arlesheim and Muenchenstein drive the two
    // together and weekly. Read as Sperrgut the collection is not silent, and
    // a weekly routine turns into 105 reminders a year.
    expect(normalisiereArt('Kehricht und Sperrgut')).toBe('kehricht')
    expect(istStumm(normalisiereArt('Kehricht und Sperrgut'))).toBe(true)
    // Sperrgut on its own stays Sperrgut, and stays loud.
    expect(normalisiereArt('Sperrgutabfuhr')).toBe('sperrgut')
    expect(istStumm('sperrgut')).toBe(false)
  })

  it('drops the instruction a calendar prints after the name', () => {
    // Riehen writes both forms in the same calendar, and they are the same
    // collection.
    expect(normalisiereArt('Altpapier bis 6 Uhr bereit stellen')).toBe('papier')
    expect(normalisiereArt('Grüngut bis 6.30 Uhr bereitstellen')).toBe(
      'gruengut'
    )
  })

  it('answers "sonstige" for what it does not know, never nothing', () => {
    // Fail open towards the person: an unknown collection lands on the desk as
    // a proposal instead of disappearing. A superfluous proposal is the cheap
    // mistake, a collection nobody was told about the expensive one.
    expect(normalisiereArt('Kleidersammlung')).toBe('sonstige')
    expect(normalisiereArt('')).toBe('sonstige')
    expect(istStumm('sonstige')).toBe(false)
  })
})

describe('istStumm', () => {
  it('silences the weekly routines and nothing else', () => {
    // A resident knows the fixed weekday of their Kehricht; a reminder every
    // week would teach them to ignore the others.
    expect(istStumm('kehricht')).toBe(true)
    expect(istStumm('gruengut')).toBe(true)
    for (const laut of [
      'papier_karton',
      'papier',
      'karton',
      'sperrgut',
      'metall',
      'haecksel',
      'sonderabfall',
      'christbaum',
      'sonstige'
    ] as const) {
      expect(istStumm(laut)).toBe(false)
    }
  })
})
