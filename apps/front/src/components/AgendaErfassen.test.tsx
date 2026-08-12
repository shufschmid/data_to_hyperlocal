import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgendaErfassen } from './AgendaErfassen'

function zeige(ueber: Partial<Parameters<typeof AgendaErfassen>[0]> = {}) {
  const props = {
    quartale: ['3. Quartal: Juli–September', '4. Quartal: Oktober–Dezember'],
    onAnlegen: jest.fn().mockResolvedValue(undefined),
    ...ueber
  }
  render(<AgendaErfassen {...props} />)
  return props
}

async function oeffne() {
  await userEvent.click(screen.getByRole('button', { name: 'Eintrag von Hand erfassen' }))
}

describe('AgendaErfassen', () => {
  it('bleibt zugeklappt, bis man es braucht', () => {
    zeige()
    expect(screen.queryByRole('textbox', { name: /Titel/ })).not.toBeInTheDocument()
  })

  // Mit Datum ist die Statistik draussen, ohne Datum nur fuer ein Quartal
  // angekuendigt — genau der Unterschied, den die Agenda ausmacht.
  it('macht aus einem Datum einen publizierten Eintrag', async () => {
    const { onAnlegen } = zeige()
    await oeffne()

    await userEvent.type(screen.getByRole('textbox', { name: /Titel/ }), 'Bau- und Wohnbaustatistik 2025')
    await userEvent.type(screen.getByLabelText(/Publiziert am/), '2026-08-13')
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }))

    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({
        titel: 'Bau- und Wohnbaustatistik 2025',
        status: 'publiziert',
        datum: '2026-08-13'
      })
    )
  })

  it('macht ohne Datum einen angekuendigten Eintrag', async () => {
    const { onAnlegen } = zeige()
    await oeffne()

    await userEvent.type(screen.getByRole('textbox', { name: /Titel/ }), 'Leerstandserhebung 2026')
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }))

    expect(onAnlegen).toHaveBeenCalledWith(expect.objectContaining({ status: 'geplant', datum: null }))
  })

  it('gibt den Link weiter, wenn einer da ist', async () => {
    const { onAnlegen } = zeige()
    await oeffne()

    await userEvent.type(screen.getByRole('textbox', { name: /Titel/ }), 'Hotellerie 2026')
    await userEvent.type(screen.getByRole('textbox', { name: /Link/ }), 'https://www.baselland.ch/hotellerie')
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }))

    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({ link: 'https://www.baselland.ch/hotellerie' })
    )
  })

  it('nimmt keinen leeren Titel an', async () => {
    zeige()
    await oeffne()

    expect(screen.getByRole('button', { name: 'Erfassen' })).toBeDisabled()
  })

  it('bestaetigt, was erfasst wurde', async () => {
    zeige()
    await oeffne()

    await userEvent.type(screen.getByRole('textbox', { name: /Titel/ }), 'Haushalte 2025')
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }))

    expect(await screen.findByText(/„Haushalte 2025“ erfasst/)).toBeInTheDocument()
  })
})
