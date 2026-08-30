import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GemeindeBlogs } from './GemeindeBlogs'
import type { AlleMeldungFelder } from '@/graphql/redaktion'
import type { GemeindeBlog } from '@/lib/redaktion'

function beitrag(ueber: Partial<AlleMeldungFelder>): AlleMeldungFelder {
  return {
    id: 'm-1',
    titel: 'In Aesch stehen 42 Wohnungen leer',
    lead: 'Die Leerwohnungsziffer steigt.',
    text: 'Ein Absatz.',
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: null,
    fehler: null,
    publiziert_am: null,
    erscheint_am: null,
    date_created: '2026-08-30T08:00:00Z',
    gemeinde: { id: 'g-1', name: 'Aesch', bezirk: 'Arlesheim' },
    lauf: { id: 'l-1' },
    spiel: null,
    kandidat: null,
    perle: null,
    ...ueber
  }
}

function blog(beitraege: AlleMeldungFelder[]): GemeindeBlog<AlleMeldungFelder>[] {
  return [{ gemeinde: { id: 'g-1', name: 'Aesch' }, beitraege }]
}

describe('GemeindeBlogs', () => {
  it('zeigt den Beitrag mit Status und Herkunft', () => {
    render(<GemeindeBlogs blogs={blog([beitrag({})])} />)

    expect(screen.getByText('In Aesch stehen 42 Wohnungen leer')).toBeInTheDocument()
    expect(screen.getByText('Entwurf')).toBeInTheDocument()
    expect(screen.getByText('Statistik')).toBeInTheDocument()
  })

  // Der zweite Weg zum selben Ziel: publizieren, wo man liest.
  it('stellt einen Entwurf direkt aus dem Blog scharf', async () => {
    const onPublizieren = jest.fn().mockResolvedValue(undefined)
    render(<GemeindeBlogs blogs={blog([beitrag({})])} onPublizieren={onPublizieren} />)

    await userEvent.click(screen.getByRole('button', { name: 'Publizieren' }))
    expect(onPublizieren).toHaveBeenCalledWith('m-1')
  })

  it('bietet das Publizieren nur an, wo es erlaubt ist', () => {
    const onPublizieren = jest.fn()
    const { rerender } = render(
      <GemeindeBlogs blogs={blog([beitrag({ status: 'publiziert' })])} onPublizieren={onPublizieren} />
    )
    expect(screen.queryByRole('button', { name: 'Publizieren' })).not.toBeInTheDocument()

    // In Gegenpruefung gehoert die Meldung den Pruefenden.
    rerender(
      <GemeindeBlogs blogs={blog([beitrag({ status: 'in_pruefung' })])} onPublizieren={onPublizieren} />
    )
    expect(screen.queryByRole('button', { name: 'Publizieren' })).not.toBeInTheDocument()

    // Freigegeben schon.
    rerender(
      <GemeindeBlogs blogs={blog([beitrag({ status: 'freigegeben' })])} onPublizieren={onPublizieren} />
    )
    expect(screen.getByRole('button', { name: 'Publizieren' })).toBeInTheDocument()
  })

  it('zeigt ohne Aktion gar keinen Knopf — die oeffentliche Lesart', () => {
    render(<GemeindeBlogs blogs={blog([beitrag({})])} />)
    expect(screen.queryByRole('button', { name: 'Publizieren' })).not.toBeInTheDocument()
  })
})
