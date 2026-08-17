import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SpielFelder } from '@/graphql/redaktion'
import { Sportresultate } from './Sportresultate'

function spiel(ueber: Partial<SpielFelder>): SpielFelder {
  return {
    id: 's',
    spielnummer: '1',
    datum: '2026-08-21T18:00:00Z',
    heim: 'FC A',
    gast: 'FC B',
    tore_heim: null,
    tore_gast: null,
    wettbewerb: 'Meisterschaft - 5. Liga',
    ort: null,
    status: null,
    sportart: 'Fussball',
    gemeinde: { id: 'g1', name: 'Pratteln' },
    verein: { id: 'v1', name: 'FC Pratteln' },
    ...ueber
  }
}

// Fixed clock so "past" and "coming" do not drift with the wall clock. Passed
// in rather than faked globally: userEvent drives its own timers, and freezing
// them deadlocks every click.
const JETZT = new Date('2026-08-20T12:00:00Z')

const spiele = [
  spiel({
    id: 'a',
    datum: '2026-08-19T18:00:00Z',
    heim: 'FC Reinach',
    gast: 'FC Amicitia Riehen',
    tore_heim: 1,
    tore_gast: 3,
    gemeinde: { id: 'g2', name: 'Riehen' },
    verein: { id: 'v2', name: 'FC Amicitia Riehen' }
  }),
  spiel({
    id: 'b',
    datum: '2026-08-21T18:00:00Z',
    heim: 'FC Möhlin',
    gast: 'FC Pratteln'
  }),
  spiel({
    id: 'c',
    datum: '2026-08-22T16:00:00Z',
    heim: "Sm'Aesch Pfeffingen",
    gast: 'Volley Düdingen',
    sportart: 'Volleyball',
    gemeinde: { id: 'g3', name: 'Aesch' },
    verein: { id: 'v3', name: "Sm'Aesch Pfeffingen" }
  })
]

describe('Sportresultate', () => {
  it('trennt gespielte von kommenden Begegnungen', () => {
    render(<Sportresultate spiele={spiele} jetzt={JETZT} />)

    const resultate = screen.getByRole('heading', { name: 'Resultate' }).closest('div')
      ?.parentElement as HTMLElement
    expect(within(resultate).getByText(/FC Reinach — FC Amicitia Riehen/)).toBeInTheDocument()

    const kommend = screen.getByRole('heading', { name: 'Kommende Begegnungen' }).closest('div')
      ?.parentElement as HTMLElement
    expect(within(kommend).getByText(/FC Möhlin — FC Pratteln/)).toBeInTheDocument()
  })

  it('zeigt das Resultat in Spielrichtung', () => {
    render(<Sportresultate spiele={spiele} jetzt={JETZT} />)
    expect(screen.getByText('1:3')).toBeInTheDocument()
  })

  // Two fixtures are still to be played, so both show a placeholder.
  it('laesst offene Begegnungen ohne Resultat', () => {
    render(<Sportresultate spiele={spiele} jetzt={JETZT} />)
    expect(screen.getAllByText('–')).toHaveLength(2)
  })

  it('filtert nach Gemeinde', async () => {
    render(<Sportresultate spiele={spiele} jetzt={JETZT} />)

    await userEvent.click(screen.getByRole('combobox', { name: 'Gemeinde' }))
    await userEvent.click(screen.getByRole('option', { name: 'Riehen' }))

    expect(screen.getByText(/FC Reinach — FC Amicitia Riehen/)).toBeInTheDocument()
    expect(screen.queryByText(/FC Möhlin — FC Pratteln/)).not.toBeInTheDocument()
  })

  it('filtert nach Sportart', async () => {
    render(<Sportresultate spiele={spiele} jetzt={JETZT} />)

    await userEvent.click(screen.getByRole('combobox', { name: 'Sportart' }))
    await userEvent.click(screen.getByRole('option', { name: 'Volleyball' }))

    expect(screen.getByText(/Sm'Aesch Pfeffingen — Volley Düdingen/)).toBeInTheDocument()
    expect(screen.queryByText(/FC Möhlin — FC Pratteln/)).not.toBeInTheDocument()
  })

  it('bietet nur Sportarten an, die auch vorkommen', async () => {
    render(<Sportresultate spiele={spiele} jetzt={JETZT} />)

    await userEvent.click(screen.getByRole('combobox', { name: 'Sportart' }))
    expect(screen.getByRole('option', { name: 'Fussball' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Volleyball' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Handball' })).not.toBeInTheDocument()
  })

  it('kennzeichnet einen Vermerk der Quelle', () => {
    render(<Sportresultate spiele={[spiel({ id: 'd', status: 'verschoben' })]} />)
    expect(screen.getByText('verschoben')).toBeInTheDocument()
  })

  // An empty table is normal at the start of a season, not a fault.
  it('erklaert eine leere Liste, statt sie kommentarlos zu zeigen', () => {
    render(<Sportresultate spiele={[]} />)
    expect(screen.getByText(/Noch keine Spiele erfasst/)).toBeInTheDocument()
  })
})
