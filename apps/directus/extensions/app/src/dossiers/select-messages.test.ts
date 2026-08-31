import { describe, expect, it } from 'vitest'
import { selectDossierMessages, type MessageSummary } from './select-messages'

function msg(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    uid: 1,
    subject: 'Dossier vom 17.08.2026',
    hasPdfAttachment: true,
    ...overrides
  }
}

const NONE = new Set<string>()

describe('selectDossierMessages', () => {
  it('only selects messages with a PDF attachment', () => {
    const summaries = [
      msg({ uid: 1 }),
      msg({ uid: 2, hasPdfAttachment: false })
    ]
    expect(
      selectDossierMessages(summaries, {
        limit: 5,
        subjectFilter: null,
        knownSubjects: NONE
      })
    ).toEqual([msg({ uid: 1 })])
  })

  it('applies a case-insensitive subject filter when configured', () => {
    const summaries = [
      msg({ uid: 1, subject: 'Dossier SRF' }),
      msg({ uid: 2, subject: 'Newsletter' })
    ]
    expect(
      selectDossierMessages(summaries, {
        limit: 5,
        subjectFilter: 'dossier',
        knownSubjects: NONE
      })
    ).toEqual([msg({ uid: 1, subject: 'Dossier SRF' })])
  })

  it('skips a subject already known to this Directus instance', () => {
    const summaries = [
      msg({ uid: 1, subject: 'Already ingested' }),
      msg({ uid: 2, subject: 'New one' })
    ]
    const known = new Set(['Already ingested'])
    expect(
      selectDossierMessages(summaries, {
        limit: 5,
        subjectFilter: null,
        knownSubjects: known
      })
    ).toEqual([msg({ uid: 2, subject: 'New one' })])
  })

  it('sorts most recent (highest uid) first', () => {
    const summaries = [msg({ uid: 1 }), msg({ uid: 3 }), msg({ uid: 2 })]
    expect(
      selectDossierMessages(summaries, {
        limit: 5,
        subjectFilter: null,
        knownSubjects: NONE
      }).map((m) => m.uid)
    ).toEqual([3, 2, 1])
  })

  it('caps the batch at the limit, falling back to 5 for an invalid one', () => {
    const summaries = [msg({ uid: 1 }), msg({ uid: 2 }), msg({ uid: 3 })]
    expect(
      selectDossierMessages(summaries, {
        limit: 2,
        subjectFilter: null,
        knownSubjects: NONE
      })
    ).toHaveLength(2)
    expect(
      selectDossierMessages(summaries, {
        limit: 0,
        subjectFilter: null,
        knownSubjects: NONE
      })
    ).toHaveLength(3)
    expect(
      selectDossierMessages(summaries, {
        limit: NaN,
        subjectFilter: null,
        knownSubjects: NONE
      })
    ).toHaveLength(3)
  })

  it('treats an empty/whitespace subject filter as no filter', () => {
    const summaries = [msg({ uid: 1, subject: 'Anything' })]
    expect(
      selectDossierMessages(summaries, {
        limit: 5,
        subjectFilter: '  ',
        knownSubjects: NONE
      })
    ).toEqual(summaries)
  })
})
