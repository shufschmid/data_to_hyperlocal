import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MeldungKarte } from './MeldungKarte'
import type { MeldungFelder } from '@/graphql/redaktion'

function meldung(ueber: Partial<MeldungFelder> = {}): MeldungFelder {
  return {
    id: 'm-1',
    titel: 'Papierabfuhr am Mittwoch',
    lead: 'Ein Lead.',
    text: 'Ein Text.',
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: null,
    fehler: null,
    publiziert_am: null,
    gemeinde: { id: 'g-1', name: 'Binningen', bezirk: 'Arlesheim' },
    ...ueber
  }
}

describe('MeldungKarte', () => {
  // Verwerfen war der eine Entscheid ohne Kanal fuers Warum: eine als Prosa
  // verworfene Meldung ist eine Lehre fuer den Tisch, von dem sie kam.
  it('fragt beim Verwerfen nach dem Warum und reicht es mit', async () => {
    const onAktion = jest.fn().mockResolvedValue(undefined)
    render(<MeldungKarte meldung={meldung()} onChat={jest.fn()} onAktion={onAktion} />)

    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))
    await userEvent.type(screen.getByLabelText('Warum? (optional, hilft dem Lernen)'), 'zu duenn')
    // Solange der Dialog offen ist, ist nur SEIN Knopf erreichbar — der auf der
    // Karte liegt hinter aria-hidden.
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))

    expect(onAktion).toHaveBeenCalledWith('m-1', 'verwerfen', { kommentar: 'zu duenn' })
  })

  it('verwirft ohne Text ohne Koerper — das Warum bleibt freiwillig', async () => {
    const onAktion = jest.fn().mockResolvedValue(undefined)
    render(<MeldungKarte meldung={meldung()} onChat={jest.fn()} onAktion={onAktion} />)

    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))

    expect(onAktion).toHaveBeenCalledWith('m-1', 'verwerfen', undefined)
  })

  it('verwirft mit Enter im Textfeld', async () => {
    const onAktion = jest.fn().mockResolvedValue(undefined)
    render(<MeldungKarte meldung={meldung()} onChat={jest.fn()} onAktion={onAktion} />)

    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))
    await userEvent.type(screen.getByLabelText('Warum? (optional, hilft dem Lernen)'), 'doppelt{enter}')

    expect(onAktion).toHaveBeenCalledWith('m-1', 'verwerfen', { kommentar: 'doppelt' })
  })
})
