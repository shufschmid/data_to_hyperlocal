import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { alsExtraktion, liesQuelle } from './deterministisch'
import type { KalenderTermin } from './kalenderleser'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

async function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), 'utf-8')
}

function termin(
  ueber: Partial<KalenderTermin> & { datum: string }
): KalenderTermin {
  return {
    art: 'papier_karton',
    artRoh: 'Papier- und Kartonsammlung',
    zone: '',
    stumm: false,
    ...ueber
  }
}

describe('liesQuelle', () => {
  it('picks the reader the Lesart names', async () => {
    expect(liesQuelle('ics', await fixture('riehen_zone1.ics'))).toHaveLength(
      129
    )
    expect(
      liesQuelle('icms', await fixture('aesch_abfalldaten.html'))
    ).toHaveLength(18)
  })
})

describe('alsExtraktion', () => {
  it('turns a loud collection into a Termin the desk already understands', () => {
    const extraktion = alsExtraktion([termin({ datum: '2026-09-01' })], {
      jahr: 2026,
      zone: 'Zone 1'
    })

    expect(extraktion.termine).toEqual([
      {
        kategorie: 'Papier- und Kartonsammlung',
        zone: 'Zone 1',
        datum: '2026-09-01',
        // A machine-readable source prints no weekday next to the row, so
        // there is nothing to cross-check and nothing is claimed.
        wochentag_laut_pdf: null,
        bereitstellung: null,
        anmeldung: null,
        anmeldeschluss: null,
        anmeldeschluss_zeit: null
      }
    ])
    expect(extraktion.jahr).toBe(2026)
    expect(extraktion.zonen).toEqual(['Zone 1'])
  })

  it('keeps the weekly routines out of the Termine and names them anyway', () => {
    const extraktion = alsExtraktion(
      [
        termin({ datum: '2026-09-01' }),
        termin({
          datum: '2026-09-02',
          art: 'kehricht',
          artRoh: 'Schwarzkehricht',
          stumm: true
        }),
        termin({
          datum: '2026-09-09',
          art: 'kehricht',
          artRoh: 'Schwarzkehricht',
          stumm: true
        })
      ],
      { jahr: 2026, zone: null }
    )

    // A resident knows their weekly Kehricht day; a reminder every week would
    // teach them to ignore the others. But a whole category that disappeared
    // by mistake must be visible, so it is reported rather than dropped.
    expect(extraktion.termine.map((t) => t.datum)).toEqual(['2026-09-01'])
    expect(extraktion.regelmaessig).toEqual([
      {
        kategorie: 'Schwarzkehricht',
        rhythmus:
          '2 Termine im Kalender, als Routine gefuehrt und nicht erinnert'
      }
    ])
  })

  it('drops what belongs to another year and says how much', () => {
    const extraktion = alsExtraktion(
      [
        termin({ datum: '2026-12-29' }),
        termin({ datum: '2027-01-05' }),
        termin({ datum: '2027-01-12' })
      ],
      { jahr: 2026, zone: null }
    )

    expect(extraktion.termine.map((t) => t.datum)).toEqual(['2026-12-29'])
    expect(extraktion.hinweise).toEqual([
      '2 Termine der Quelle liegen ausserhalb von 2026 und wurden nicht uebernommen.'
    ])
  })

  it('takes the zone from the source when the document names none', () => {
    const extraktion = alsExtraktion(
      [
        termin({ datum: '2026-09-01', zone: 'Kreis A' }),
        termin({ datum: '2026-09-02', zone: 'Kreis B' })
      ],
      { jahr: 2026, zone: null }
    )

    expect(extraktion.termine.map((t) => t.zone)).toEqual([
      'Kreis A',
      'Kreis B'
    ])
    expect(extraktion.zonen).toEqual(['Kreis A', 'Kreis B'])
  })

  it('reads Riehens real year into the desk shape', async () => {
    const termine = liesQuelle('ics', await fixture('riehen_zone1.ics'))
    const extraktion = alsExtraktion(termine, { jahr: 2026, zone: 'Zone 1' })

    // 129 collection days in the calendar, 30 of them worth a reminder: the
    // paper collection and the Christmas trees. The 99 others are the weekly
    // Kehricht and Gruengut, and they are named as routine.
    expect(extraktion.termine).toHaveLength(30)
    expect(extraktion.regelmaessig.map((r) => r.kategorie).sort()).toEqual([
      'Grünabfuhr',
      'Schwarzkehricht'
    ])
    expect(extraktion.hinweise).toEqual([])
  })

  it('puts the calendars own instruction where the desk keeps it', async () => {
    const termine = liesQuelle('ics', await fixture('riehen_zone1.ics'))
    const extraktion = alsExtraktion(termine, { jahr: 2026, zone: 'Zone 1' })

    // Riehen writes "Altpapier" and "Altpapier bis 6 Uhr bereit stellen" for
    // the same collection. One category, and the instruction in the field the
    // model path fills with exactly this.
    expect(new Set(extraktion.termine.map((t) => t.kategorie))).toEqual(
      new Set(['Altpapier', 'Grünabfuhr / Tannenbaum'])
    )
    expect(
      extraktion.termine.some(
        (t) => t.bereitstellung === 'bis 6 Uhr bereit stellen'
      )
    ).toBe(true)
  })

  it('takes an empty source as a year without dates, not as a failure', () => {
    const extraktion = alsExtraktion([], { jahr: 2026, zone: null })

    expect(extraktion.termine).toEqual([])
    expect(extraktion.regelmaessig).toEqual([])
    expect(extraktion.zonen).toEqual([])
  })
})
