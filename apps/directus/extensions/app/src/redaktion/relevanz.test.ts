import { describe, expect, it } from 'vitest'
import type { OdsDataset } from '../shared/ods'
import {
  bewertungText,
  buildRelevanzPrompt,
  keineGemeindedatenText,
  parseRelevanz
} from './relevanz'

const DATENSATZ: OdsDataset = {
  datasetId: '12060',
  titel: 'Abfallmengen nach Kategorie, Gemeinde und Jahr (seit 2017)',
  beschreibung: 'Spezifische Abfallmengen in Kilogramm pro Einwohnerin.',
  modified: '2026-07-21T07:54:14.247000+00:00',
  dataProcessed: '2026-07-21T07:54:14.247000+00:00',
  recordsCount: 12384,
  rhythmus: 'annual',
  fields: [
    { name: 'jahr', type: 'date', label: 'Jahr', description: null },
    {
      name: 'bfs_gemeindenummer',
      type: 'text',
      label: 'BFS-Gemeindenummer',
      description: null
    },
    { name: 'kategorie', type: 'text', label: 'Kategorie', description: null },
    { name: 'wert', type: 'double', label: 'Wert', description: null }
  ]
}

const GEMEINDEFELDER = { bfsField: 'bfs_gemeindenummer', nameField: 'gemeinde' }

describe('buildRelevanzPrompt', () => {
  it('gives the model the title, the description and the real field list', () => {
    const prompt = buildRelevanzPrompt(DATENSATZ, GEMEINDEFELDER)

    expect(prompt).toContain('Abfallmengen nach Kategorie')
    expect(prompt).toContain('Kilogramm pro Einwohnerin')
    expect(prompt).toContain('jahr (date)')
    expect(prompt).toContain('wert (double)')
    expect(prompt).toContain('12384')
  })

  it('survives a dataset with no description and no fields', () => {
    const kahl: OdsDataset = {
      ...DATENSATZ,
      beschreibung: null,
      recordsCount: null,
      fields: []
    }
    const prompt = buildRelevanzPrompt(kahl, GEMEINDEFELDER)

    expect(prompt).toContain('(keine)')
    expect(prompt).toContain('(keine Feldangaben)')
    expect(prompt).toContain('unbekannt')
  })
})

describe('parseRelevanz', () => {
  it('accepts a well-formed judgement', () => {
    const urteil = parseRelevanz(
      {
        relevant: true,
        begruendung: 'Abfallgebuehren betreffen jeden Haushalt direkt.',
        periodenfeld: 'jahr',
        themen: ['Abfall', 'Umwelt']
      },
      DATENSATZ
    )

    expect(urteil).toEqual({
      relevant: true,
      begruendung: 'Abfallgebuehren betreffen jeden Haushalt direkt.',
      periodenfeld: 'jahr',
      themen: ['abfall', 'umwelt']
    })
  })

  // A hallucinated column name would be carried into the run and produce a
  // query that matches nothing — with a 200 and an empty list, not an error.
  it('drops a period field the dataset does not have', () => {
    const urteil = parseRelevanz(
      {
        relevant: true,
        begruendung: 'Grund',
        periodenfeld: 'erfundenes_feld',
        themen: []
      },
      DATENSATZ
    )

    expect(urteil.periodenfeld).toBeNull()
  })

  it('caps the number of topics', () => {
    const urteil = parseRelevanz(
      {
        relevant: true,
        begruendung: 'Grund',
        themen: ['a', 'b', 'c', 'd', 'e']
      },
      DATENSATZ
    )

    expect(urteil.themen).toEqual(['a', 'b', 'c'])
  })

  it('ignores topics that are not strings', () => {
    const urteil = parseRelevanz(
      { relevant: false, begruendung: 'Grund', themen: [1, null, 'gut', {}] },
      DATENSATZ
    )

    expect(urteil.themen).toEqual(['gut'])
  })

  it('rejects a missing verdict rather than guessing one', () => {
    expect(() => parseRelevanz({ begruendung: 'Grund' }, DATENSATZ)).toThrow(
      /relevant/
    )
  })

  it('rejects a verdict that is a string instead of a boolean', () => {
    expect(() =>
      parseRelevanz({ relevant: 'ja', begruendung: 'Grund' }, DATENSATZ)
    ).toThrow(/relevant/)
  })

  it('rejects an empty justification', () => {
    expect(() =>
      parseRelevanz({ relevant: true, begruendung: '   ' }, DATENSATZ)
    ).toThrow(/Begruendung/)
  })

  it('rejects an answer that is not an object', () => {
    expect(() => parseRelevanz('ja klar', DATENSATZ)).toThrow()
    expect(() => parseRelevanz(null, DATENSATZ)).toThrow()
  })

  it('truncates an over-long justification instead of storing it whole', () => {
    const urteil = parseRelevanz(
      { relevant: true, begruendung: 'x'.repeat(900) },
      DATENSATZ
    )

    expect(urteil.begruendung.length).toBe(400)
  })
})

describe('bewertungText', () => {
  it('reads as a sentence with the topics appended', () => {
    expect(
      bewertungText({
        relevant: true,
        begruendung: 'Betrifft jeden Haushalt.',
        periodenfeld: 'jahr',
        themen: ['abfall']
      })
    ).toBe('Relevant: Betrifft jeden Haushalt. [abfall]')
  })

  it('omits the bracket when there are no topics', () => {
    expect(
      bewertungText({
        relevant: false,
        begruendung: 'Reines Verwaltungsregister.',
        periodenfeld: null,
        themen: []
      })
    ).toBe('Nicht relevant: Reines Verwaltungsregister.')
  })

  // The two rejection reasons should read alike in the admin UI, so an editor
  // can see at a glance which datasets were dismissed for free.
  it('phrases the free rejection like the model-based one', () => {
    expect(keineGemeindedatenText()).toMatch(/^Nicht relevant: /)
  })
})
