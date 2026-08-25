import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntsorgungKalender } from './EntsorgungKalender'
import type { EntsorgungskalenderFelder, EntsorgungsterminFelder } from '@/graphql/redaktion'

function kalender(ueber: Partial<EntsorgungskalenderFelder>): EntsorgungskalenderFelder {
  return {
    id: 'k-1',
    jahr: 2026,
    status: 'extrahiert',
    merkblatt: null,
    gemeinde: { id: 'g-1', name: 'Binningen' },
    dokumente: [
      {
        id: 'd-1',
        zone: null,
        zusatz: null,
        status: 'extrahiert',
        quelle_url: null,
        fehler: null,
        pdf: { id: 'f-1' }
      }
    ],
    ...ueber
  }
}

function termin(ueber: Partial<EntsorgungsterminFelder>): EntsorgungsterminFelder {
  return {
    id: 't-1',
    kategorie: 'Papier, Karton',
    zone: 'Westplateau',
    datum: '2026-01-07',
    anmeldeschluss: null,
    anmeldeschluss_zeit: null,
    bereitstellung: null,
    anmeldung: null,
    warnung: null,
    geprueft: false,
    meldung: null,
    ...ueber
  }
}

const NICHTS = {
  onAuslesen: jest.fn().mockResolvedValue(undefined),
  onBestaetigen: jest.fn().mockResolvedValue(undefined),
  onMeldungen: jest.fn().mockResolvedValue(undefined),
  onFreigeben: jest.fn().mockResolvedValue(undefined)
}

describe('EntsorgungKalender', () => {
  beforeEach(() => {
    for (const f of Object.values(NICHTS)) f.mockClear()
  })

  it('gruppiert die Termine nach Monat', () => {
    render(
      <EntsorgungKalender
        kalender={kalender({})}
        termine={[termin({ id: 'a', datum: '2026-01-07' }), termin({ id: 'b', datum: '2026-03-04' })]}
        {...NICHTS}
      />
    )

    expect(screen.getByText(/Januar 2026/)).toBeInTheDocument()
    expect(screen.getByText(/März 2026/)).toBeInTheDocument()
  })

  it('zeigt die Wochentags-Warnung, statt sie zu schlucken', () => {
    render(
      <EntsorgungKalender
        kalender={kalender({})}
        termine={[
          termin({ warnung: 'Der Kalender nennt "Mittwoch", der 2026-01-08 ist aber ein Donnerstag.' })
        ]}
        {...NICHTS}
      />
    )

    expect(screen.getByText(/Wochentag im PDF nicht zum Datum/)).toBeInTheDocument()
    expect(screen.getByText(/ist aber ein Donnerstag/)).toBeInTheDocument()
  })

  it('nennt die Anmeldefrist am Termin', () => {
    render(
      <EntsorgungKalender
        kalender={kalender({})}
        termine={[
          termin({
            datum: '2026-03-04',
            anmeldeschluss: '2026-03-02',
            anmeldeschluss_zeit: '11:30'
          })
        ]}
        {...NICHTS}
      />
    )

    // Die Uhrzeit gehoert dazu: sie entscheidet, ob die Erinnerung noch am
    // Fristtag selbst erscheint.
    expect(screen.getByText(/Anmeldung bis Montag, 2. März 2026, 11.30 Uhr/)).toBeInTheDocument()
  })

  it('erlaubt Meldungen erst, wenn der Kalender geprueft ist', () => {
    const { rerender } = render(
      <EntsorgungKalender kalender={kalender({ status: 'extrahiert' })} termine={[termin({})]} {...NICHTS} />
    )
    expect(screen.getByRole('button', { name: /Meldungen fuers Jahr/ })).toBeDisabled()

    rerender(
      <EntsorgungKalender
        kalender={kalender({ status: 'geprueft' })}
        termine={[termin({ geprueft: true })]}
        {...NICHTS}
      />
    )
    expect(screen.getByRole('button', { name: /Meldungen fuers Jahr/ })).toBeEnabled()
  })

  it('bestaetigt einen einzelnen Termin', async () => {
    render(<EntsorgungKalender kalender={kalender({})} termine={[termin({ id: 't-9' })]} {...NICHTS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Bestaetigen' }))

    expect(NICHTS.onBestaetigen).toHaveBeenCalledWith(['t-9'])
  })

  it('zaehlt die offenen Bestaetigungen im Knopf', () => {
    render(
      <EntsorgungKalender
        kalender={kalender({})}
        termine={[termin({ id: 'a' }), termin({ id: 'b' }), termin({ id: 'c', geprueft: true })]}
        {...NICHTS}
      />
    )

    expect(screen.getByRole('button', { name: '2 Termine bestaetigen' })).toBeInTheDocument()
  })

  it('zeigt den Fehler des Auslesens an, statt ihn zu verstecken', () => {
    render(
      <EntsorgungKalender
        kalender={kalender({
          status: 'fehler',
          dokumente: [
            {
              id: 'd-1',
              zone: 'Zone 1',
              zusatz: null,
              status: 'fehler',
              quelle_url: null,
              fehler: 'Das PDF ist eine Bilddatei.',
              pdf: { id: 'f-1' }
            }
          ]
        })}
        termine={[]}
        {...NICHTS}
      />
    )

    // Der Fehler steht mit seiner Zone da — bei mehreren PDFs muss klar sein,
    // welches nicht lesbar war.
    expect(
      screen.getByText((_, element) => element?.textContent === 'Zone 1: Das PDF ist eine Bilddatei.')
    ).toBeInTheDocument()
  })

  it('sperrt waehrend des Auslesens jede Aktion und sagt warum', () => {
    render(<EntsorgungKalender kalender={kalender({ status: 'liest' })} termine={[termin({})]} {...NICHTS} />)

    // Der Lauf ist vom Request geloest und dauert Minuten — jeder Schreibzugriff
    // wuerde gegen den laufenden Abgleich rennen.
    expect(screen.getByText(/dauert einige Minuten/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Wird ausgelesen …' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Termine bestaetigen/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bestaetigen' })).toBeDisabled()
  })

  it('sagt bei leerem Kalender, was als Naechstes zu tun ist', () => {
    render(<EntsorgungKalender kalender={kalender({})} termine={[]} {...NICHTS} />)

    expect(screen.getByRole('button', { name: 'PDF auslesen' })).toBeInTheDocument()
    expect(screen.getByText(/Kehrichtabfuhr bleibt bewusst aussen vor/)).toBeInTheDocument()
  })
})
