import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { liesIcmsTabelle, liesIcs } from './kalenderleser'

// Both fixtures are real answers, fetched on 18 August 2026 and carried over
// from Dorfkoenig 3.0, where these two readers have been running against five
// municipalities since. A waste calendar names collection days and nothing
// else: neither file contains a person, an address or a mailbox.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

async function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), 'utf-8')
}

describe('liesIcs', () => {
  it('reads Riehens real calendar, series unfolded', async () => {
    const termine = liesIcs(await fixture('riehen_zone1.ics'))

    // The same numbers the Python reader produces on this file. They are here
    // as numbers, not as "some", because a port that silently loses half a
    // year still looks like it works.
    expect(termine).toHaveLength(129)
    const jeArt = termine.reduce<Record<string, number>>((zaehler, t) => {
      zaehler[t.art] = (zaehler[t.art] ?? 0) + 1
      return zaehler
    }, {})
    expect(jeArt).toEqual({
      kehricht: 52,
      gruengut: 47,
      papier: 26,
      christbaum: 4
    })
    expect(termine[0]).toEqual({
      datum: '2026-01-06',
      art: 'kehricht',
      artRoh: 'Schwarzkehricht',
      zone: '',
      stumm: true
    })
    expect(termine[termine.length - 1]?.datum).toBe('2026-12-31')
  })

  it('honours EXDATE — a holiday is not a collection day', async () => {
    const termine = liesIcs(await fixture('riehen_zone1.ics'))
    const tage = new Set(termine.map((t) => t.datum))

    // The expensive kind of error: without EXDATE a person puts the container
    // out on Easter Monday for nothing, and does it again next time.
    expect(tage.has('2026-04-06')).toBe(false)
    expect(tage.has('2026-05-14')).toBe(false)
    expect(tage.has('2026-12-24')).toBe(false)
  })

  it('counts the rule, not the surviving dates', () => {
    // COUNT counts repetitions of the RULE: a day struck by EXDATE uses up its
    // repetition. Topping the series back up to COUNT after striking hangs one
    // extra date on the end per holiday — measured in Dorfkoenig, Riehens
    // Altpapier ran into January 2027 instead of stopping in December.
    const kalender = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260105',
      'EXDATE;VALUE=DATE:20260119',
      'RRULE:FREQ=WEEKLY;COUNT=4;INTERVAL=1;BYDAY=MO',
      'SUMMARY:Altpapier',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    expect(liesIcs(kalender).map((t) => t.datum)).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-26'
    ])
  })

  it('unfolds the line breaks RFC 5545 puts into long lines', () => {
    // The fold is an arbitrary octet boundary, and unfolding removes the CRLF
    // AND the space that marks it. A fixture that folds after a word instead
    // would glue the two words together — which is what the reader must not
    // invent a space for.
    const kalender = [
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260105',
      'SUMMARY:Papier- und K',
      ' artonsammlung',
      'END:VEVENT'
    ].join('\r\n')

    expect(liesIcs(kalender)[0]).toMatchObject({
      art: 'papier_karton',
      artRoh: 'Papier- und Kartonsammlung'
    })
  })

  it('keeps the start day and says so when a frequency is unknown', () => {
    // A general RRULE engine would be code for cases no source presents. An
    // unknown frequency yields the start day alone rather than a guessed series.
    const kalender = [
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260105',
      'RRULE:FREQ=MONTHLY;COUNT=6',
      'SUMMARY:Sonderabfall',
      'END:VEVENT'
    ].join('\r\n')

    expect(liesIcs(kalender).map((t) => t.datum)).toEqual(['2026-01-05'])
  })

  it('takes an empty calendar as an answer, not as a failure', () => {
    expect(liesIcs('')).toEqual([])
    expect(liesIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toEqual([])
  })
})

describe('liesIcmsTabelle', () => {
  it('reads Aeschs real widget table', async () => {
    const termine = liesIcmsTabelle(await fixture('aesch_abfalldaten.html'))

    expect(termine).toHaveLength(18)
    const jeArt = termine.reduce<Record<string, number>>((zaehler, t) => {
      zaehler[t.art] = (zaehler[t.art] ?? 0) + 1
      return zaehler
    }, {})
    expect(jeArt).toEqual({
      gruengut: 9,
      papier_karton: 4,
      haecksel: 3,
      sperrgut: 2
    })
    expect(termine[0]).toEqual({
      datum: '2026-08-24',
      art: 'gruengut',
      artRoh: 'Grünabfuhr',
      zone: '',
      stumm: true
    })
  })

  it('reads a row naming two kinds as one collection', async () => {
    const termine = liesIcmsTabelle(await fixture('aesch_abfalldaten.html'))
    const sammlung = termine.filter(
      (t) => t.artRoh === 'Papier- und Kartonsammlung'
    )

    // One row, one collection. Filed as paper AND as cardboard it would be
    // announced twice.
    expect(sammlung).toHaveLength(4)
    expect(new Set(sammlung.map((t) => t.art))).toEqual(
      new Set(['papier_karton'])
    )
  })

  it('takes a page without the widget as an answer, not as a failure', () => {
    // A municipality that rebuilds its site has no widget for a while. That is
    // "nothing today", and the run says so; it is not an exception.
    expect(liesIcmsTabelle('<html><body>Keine Tabelle</body></html>')).toEqual(
      []
    )
    expect(liesIcmsTabelle('')).toEqual([])
  })

  it('takes a widget with unreadable JSON as empty rather than crashing', () => {
    expect(liesIcmsTabelle('<div data-entities="{kaputt"></div>')).toEqual([])
  })
})
