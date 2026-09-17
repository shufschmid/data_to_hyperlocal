import { describe, expect, it } from 'vitest'
import { redaktionsbilanz, tischVon, type BilanzZeile } from './bilanz'

const JETZT = '2026-09-17T10:00:00.000Z'

function zeile(teil: Partial<BilanzZeile> = {}): BilanzZeile {
  return {
    status: 'entwurf',
    lauf: null,
    spiel: null,
    kandidat: null,
    amtsblattmeldung: null,
    gemeindemitteilung: null,
    sendungskandidat: null,
    erscheint_am: null,
    date_created: '2026-09-15T08:00:00.000Z',
    freigegeben_am: null,
    publiziert_am: null,
    zurueckgezogen_am: null,
    ...teil
  }
}

describe('tischVon', () => {
  it('names the desk an article came from', () => {
    expect(tischVon(zeile({ lauf: 'a' }))).toBe('statistik')
    expect(tischVon(zeile({ spiel: 'a' }))).toBe('sport')
    expect(tischVon(zeile({ kandidat: 'a' }))).toBe('presseschau')
    expect(tischVon(zeile({ amtsblattmeldung: 'a' }))).toBe('amtsblatt')
    expect(tischVon(zeile({ gemeindemitteilung: 'a' }))).toBe('gemeindeseite')
    expect(tischVon(zeile({ sendungskandidat: 'a' }))).toBe('sendung')
    expect(tischVon(zeile({ erscheint_am: '2026-09-18' }))).toBe('entsorgung')
  })

  it('has no desk for an article somebody wrote freehand', () => {
    // Not an error and not hidden: a Meldung without an origin row is a
    // legitimate article, and folding it into a desk would make that desk's
    // number wrong.
    expect(tischVon(zeile())).toBe('ohne')
  })

  it('reads the origin row before the date', () => {
    // `erscheint_am` is the weakest marker of the seven: it is a plain date, and
    // the schema only promises that waste reminders carry it. A row that has
    // both belongs to the desk that owns a row, not to the one that owns a date.
    expect(tischVon(zeile({ spiel: 'a', erscheint_am: '2026-09-18' }))).toBe(
      'sport'
    )
  })
})

describe('redaktionsbilanz', () => {
  it('counts what waits for a person separately from what waits for the clock', () => {
    // The question of D8 is how much lies on a desk, and `freigegeben` does not:
    // somebody has signed it, the scheduled run puts it out. Counting both as
    // «offen» would hide the signature behind the queue it is supposed to measure.
    const bilanz = redaktionsbilanz(
      [
        zeile({ status: 'entwurf', lauf: 'a' }),
        zeile({ status: 'in_pruefung', lauf: 'b' }),
        zeile({
          status: 'freigegeben',
          lauf: 'c',
          freigegeben_am: '2026-09-16T09:00:00.000Z'
        }),
        zeile({
          status: 'publiziert',
          lauf: 'd',
          publiziert_am: '2026-09-16T09:00:00.000Z'
        })
      ],
      { jetzt: JETZT }
    )

    const statistik = bilanz.tische.find((t) => t.tisch === 'statistik')
    expect(statistik?.offen).toBe(2)
    expect(statistik?.freigegeben).toBe(1)
  })

  it('gives the age of the oldest waiting article in whole days', () => {
    const bilanz = redaktionsbilanz(
      [
        zeile({
          status: 'entwurf',
          spiel: 'a',
          date_created: '2026-09-08T10:00:00.000Z'
        }),
        zeile({
          status: 'entwurf',
          spiel: 'b',
          date_created: '2026-09-16T10:00:00.000Z'
        })
      ],
      { jetzt: JETZT }
    )

    expect(bilanz.tische.find((t) => t.tisch === 'sport')?.aeltester_tage).toBe(
      9
    )
  })

  it('leaves the age empty rather than reporting a zero nobody can read', () => {
    // Zero would say «the oldest is from today», and that is a different world
    // from «there is nothing here».
    const bilanz = redaktionsbilanz([], { jetzt: JETZT })
    expect(bilanz.gesamt.offen).toBe(0)
    expect(bilanz.gesamt.aeltester_tage).toBeNull()
  })

  it('ignores a waiting article without a creation date instead of guessing one', () => {
    const bilanz = redaktionsbilanz(
      [zeile({ status: 'entwurf', lauf: 'a', date_created: null })],
      {
        jetzt: JETZT
      }
    )
    const statistik = bilanz.tische.find((t) => t.tisch === 'statistik')
    expect(statistik?.offen).toBe(1)
    expect(statistik?.aeltester_tage).toBeNull()
  })

  it('counts the window by the stamps that exist, each on its own date', () => {
    const bilanz = redaktionsbilanz(
      [
        // Signed nine days ago, published yesterday: it counts once in the
        // window, and for the publication, not for the signature.
        zeile({
          status: 'publiziert',
          lauf: 'a',
          freigegeben_am: '2026-09-08T09:00:00.000Z',
          publiziert_am: '2026-09-16T09:00:00.000Z'
        }),
        zeile({
          status: 'freigegeben',
          lauf: 'b',
          freigegeben_am: '2026-09-16T09:00:00.000Z'
        }),
        zeile({
          status: 'entwurf',
          lauf: 'c',
          publiziert_am: '2026-09-14T09:00:00.000Z',
          zurueckgezogen_am: '2026-09-15T09:00:00.000Z'
        })
      ],
      { jetzt: JETZT }
    )

    const statistik = bilanz.tische.find((t) => t.tisch === 'statistik')
    // Two, not one: the retracted article WAS published this week, and the week
    // it went out does not change because it came back. Counting a retraction
    // backwards out of the publication figure would make the two numbers
    // describe different weeks.
    expect(statistik?.publiziert_im_fenster).toBe(2)
    expect(statistik?.freigegeben_im_fenster).toBe(1)
    expect(statistik?.zurueckgezogen_im_fenster).toBe(1)
  })

  it('leaves anything older than the window out of it', () => {
    const bilanz = redaktionsbilanz(
      [
        zeile({
          status: 'publiziert',
          lauf: 'a',
          publiziert_am: '2026-09-01T09:00:00.000Z'
        })
      ],
      { jetzt: JETZT }
    )
    expect(bilanz.gesamt.publiziert_im_fenster).toBe(0)
  })

  it('takes the window from the caller, because seven days is a choice', () => {
    const zeilen = [
      zeile({
        status: 'publiziert',
        lauf: 'a',
        publiziert_am: '2026-09-01T09:00:00.000Z'
      })
    ]
    expect(redaktionsbilanz(zeilen, { jetzt: JETZT }).fenster_tage).toBe(7)
    expect(
      redaktionsbilanz(zeilen, { jetzt: JETZT, fensterTage: 30 }).gesamt
        .publiziert_im_fenster
    ).toBe(1)
  })

  it('lists every desk, including the ones with nothing on them', () => {
    // A desk that drops out of the list reads as «does not exist», not as
    // «nothing to do» — the same confusion that let twelve silent sources live
    // for a quarter in the Dorfkönig.
    const bilanz = redaktionsbilanz([], { jetzt: JETZT })
    expect(bilanz.tische.map((t) => t.tisch)).toEqual([
      'statistik',
      'sport',
      'presseschau',
      'amtsblatt',
      'gemeindeseite',
      'sendung',
      'entsorgung',
      'ohne'
    ])
  })

  it('sums the desks into one line, and the sum is computed not repeated', () => {
    const bilanz = redaktionsbilanz(
      [
        zeile({
          status: 'entwurf',
          lauf: 'a',
          date_created: '2026-09-08T10:00:00.000Z'
        }),
        zeile({
          status: 'entwurf',
          spiel: 'b',
          date_created: '2026-09-10T10:00:00.000Z'
        }),
        zeile({ status: 'in_pruefung', kandidat: 'c' })
      ],
      { jetzt: JETZT }
    )
    expect(bilanz.gesamt.offen).toBe(3)
    expect(bilanz.gesamt.aeltester_tage).toBe(9)
    expect(bilanz.gesamt.tisch).toBe('alle')
  })

  it('reports nothing about discarded articles, because nothing records when', () => {
    // `verworfen` has no timestamp of its own. Counting it by `date_updated`
    // would call any later touch a decision, and a number that means «somebody
    // saved this row» must not be read as «somebody decided».
    const bilanz = redaktionsbilanz(
      [zeile({ status: 'verworfen', lauf: 'a' })],
      { jetzt: JETZT }
    )
    expect(Object.keys(bilanz.gesamt)).not.toContain('verworfen_im_fenster')
    expect(bilanz.gesamt.offen).toBe(0)
  })

  it('names the moment it was taken, so a stale answer is recognisable', () => {
    expect(redaktionsbilanz([], { jetzt: JETZT }).stand).toBe(JETZT)
  })
})
