import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KalenderErfassen } from './KalenderErfassen'
import type { GemeindeFelder } from '@/graphql/redaktion'

const GEMEINDEN: GemeindeFelder[] = [
  { id: 'g-1', name: 'Binningen', bezirk: 'Arlesheim', bfs_nummer: 2765, plz: null, aktiv: true },
  { id: 'g-2', name: 'Aesch', bezirk: 'Arlesheim', bfs_nummer: 2761, plz: null, aktiv: false }
]

const IM_MAERZ = new Date('2026-03-15T12:00:00Z')

async function oeffnen() {
  await userEvent.click(screen.getByRole('button', { name: 'Abfuhrkalender erfassen' }))
}

describe('KalenderErfassen', () => {
  it('bietet nur aktive Gemeinden an', async () => {
    render(<KalenderErfassen gemeinden={GEMEINDEN} onAnlegen={jest.fn()} jetzt={IM_MAERZ} />)
    await oeffnen()

    await userEvent.click(screen.getByRole('combobox', { name: 'Gemeinde' }))

    expect(screen.getByRole('option', { name: 'Binningen' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Aesch' })).not.toBeInTheDocument()
  })

  it('schlaegt das laufende Jahr vor', async () => {
    render(<KalenderErfassen gemeinden={GEMEINDEN} onAnlegen={jest.fn()} jetzt={IM_MAERZ} />)
    await oeffnen()

    expect(screen.getByLabelText('Jahr')).toHaveValue('2026')
  })

  it('schlaegt im Herbst das kommende Jahr vor', async () => {
    // Ab Oktober liegt der Kalender des Folgejahres im Briefkasten.
    render(
      <KalenderErfassen
        gemeinden={GEMEINDEN}
        onAnlegen={jest.fn()}
        jetzt={new Date('2026-10-20T12:00:00Z')}
      />
    )
    await oeffnen()

    expect(screen.getByLabelText('Jahr')).toHaveValue('2027')
  })

  it('reicht Gemeinde, Jahr und Adresse weiter', async () => {
    const onAnlegen = jest.fn().mockResolvedValue(undefined)
    render(<KalenderErfassen gemeinden={GEMEINDEN} onAnlegen={onAnlegen} jetzt={IM_MAERZ} />)
    await oeffnen()

    await userEvent.click(screen.getByRole('combobox', { name: 'Gemeinde' }))
    await userEvent.click(screen.getByRole('option', { name: 'Binningen' }))
    await userEvent.type(screen.getByLabelText('Adresse des PDF'), 'https://www.binningen.ch/kalender.pdf')
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }))

    expect(onAnlegen).toHaveBeenCalledWith({
      gemeinde: 'g-1',
      jahr: 2026,
      url: 'https://www.binningen.ch/kalender.pdf'
    })
  })

  it('reicht Zone und Zonen-Hinweis mit — der Riehen-Fall', async () => {
    // Riehen druckt je Zone ein eigenes PDF; die zweite Registrierung mit
    // anderer Zone ergaenzt denselben Kalender.
    const onAnlegen = jest.fn().mockResolvedValue(undefined)
    render(<KalenderErfassen gemeinden={GEMEINDEN} onAnlegen={onAnlegen} jetzt={IM_MAERZ} />)
    await oeffnen()

    await userEvent.click(screen.getByRole('combobox', { name: 'Gemeinde' }))
    await userEvent.click(screen.getByRole('option', { name: 'Binningen' }))
    await userEvent.type(screen.getByLabelText('Adresse des PDF'), 'https://riehen.ch/zone2.pdf')
    await userEvent.type(screen.getByLabelText('Zone (optional)'), 'Zone 2')
    await userEvent.type(
      screen.getByLabelText('Hinweis zur Zone (optional)'),
      'Umfasst auch die Gemeinde Bettingen (BS).'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }))

    expect(onAnlegen).toHaveBeenCalledWith({
      gemeinde: 'g-1',
      jahr: 2026,
      url: 'https://riehen.ch/zone2.pdf',
      zone: 'Zone 2',
      zusatz: 'Umfasst auch die Gemeinde Bettingen (BS).'
    })
  })

  it('verlangt eine Gemeinde', async () => {
    const onAnlegen = jest.fn()
    render(<KalenderErfassen gemeinden={GEMEINDEN} onAnlegen={onAnlegen} jetzt={IM_MAERZ} />)
    await oeffnen()

    await userEvent.type(screen.getByLabelText('Adresse des PDF'), 'https://x.ch/a.pdf')
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }))

    expect(screen.getByText('Waehlen Sie eine Gemeinde.')).toBeInTheDocument()
    expect(onAnlegen).not.toHaveBeenCalled()
  })

  it('verlangt Link oder Datei', async () => {
    const onAnlegen = jest.fn()
    render(<KalenderErfassen gemeinden={GEMEINDEN} onAnlegen={onAnlegen} jetzt={IM_MAERZ} />)
    await oeffnen()

    await userEvent.click(screen.getByRole('combobox', { name: 'Gemeinde' }))
    await userEvent.click(screen.getByRole('option', { name: 'Binningen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }))

    expect(screen.getByText(/Link oder als Datei/)).toBeInTheDocument()
    expect(onAnlegen).not.toHaveBeenCalled()
  })

  it('meldet ein unplausibles Jahr', async () => {
    const onAnlegen = jest.fn()
    render(<KalenderErfassen gemeinden={GEMEINDEN} onAnlegen={onAnlegen} jetzt={IM_MAERZ} />)
    await oeffnen()

    await userEvent.click(screen.getByRole('combobox', { name: 'Gemeinde' }))
    await userEvent.click(screen.getByRole('option', { name: 'Binningen' }))
    await userEvent.clear(screen.getByLabelText('Jahr'))
    await userEvent.type(screen.getByLabelText('Jahr'), '26')
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }))

    expect(screen.getByText('Das Jahr ist unplausibel.')).toBeInTheDocument()
    expect(onAnlegen).not.toHaveBeenCalled()
  })
})
