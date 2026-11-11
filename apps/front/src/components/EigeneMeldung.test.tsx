import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EigeneMeldungKnopf } from './EigeneMeldung'

describe('EigeneMeldungKnopf', () => {
  it('öffnet den Dialog und schickt im Ergänzen-Modus nur die Angaben', async () => {
    const user = userEvent.setup()
    const onAbschicken = jest.fn()
    render(<EigeneMeldungKnopf titel="Turnerobe" onAbschicken={onAbschicken} />)

    await user.click(screen.getByRole('button', { name: 'Mit eigenen Angaben' }))
    expect(screen.getByText('Turnerobe')).toBeInTheDocument()

    await user.type(
      screen.getByLabelText('Ergänzende Angaben'),
      'Die Turnerobe ist die Jahresvorstellung des TV Reinach.'
    )
    await user.click(screen.getByRole('button', { name: 'Meldung schreiben lassen' }))

    expect(onAbschicken).toHaveBeenCalledWith({
      ergaenzung: 'Die Turnerobe ist die Jahresvorstellung des TV Reinach.'
    })
  })

  it('sagt, was fehlt, statt leer abzuschicken', async () => {
    const user = userEvent.setup()
    const onAbschicken = jest.fn()
    render(<EigeneMeldungKnopf titel={null} onAbschicken={onAbschicken} />)

    await user.click(screen.getByRole('button', { name: 'Mit eigenen Angaben' }))
    await user.click(screen.getByRole('button', { name: 'Meldung schreiben lassen' }))

    expect(screen.getByText('Die ergänzenden Angaben fehlen.')).toBeInTheDocument()
    expect(onAbschicken).not.toHaveBeenCalled()
  })

  it('schickt im Selbst-Modus Titel, Lead und Text', async () => {
    const user = userEvent.setup()
    const onAbschicken = jest.fn()
    render(<EigeneMeldungKnopf titel="Turnerobe" onAbschicken={onAbschicken} />)

    await user.click(screen.getByRole('button', { name: 'Mit eigenen Angaben' }))
    await user.click(screen.getByRole('button', { name: 'Selbst schreiben' }))
    // Tippen ist in jsdom langsam — Zeichen fuer Zeichen riss der Test unter
    // der Last der ganzen Suite die Frist. Einfuegen ist ein Ereignis je Feld
    // und geht durch dasselbe onChange.
    await user.click(screen.getByLabelText('Titel'))
    await user.paste('Turnerobe')
    await user.click(screen.getByLabelText('Lead'))
    await user.paste('Jahresshow.')
    await user.click(screen.getByLabelText('Text'))
    await user.paste('Am 21. November 2026.')
    await user.click(screen.getByRole('button', { name: 'Meldung anlegen' }))

    expect(onAbschicken).toHaveBeenCalledWith({
      eigene: {
        titel: 'Turnerobe',
        lead: 'Jahresshow.',
        text: 'Am 21. November 2026.'
      }
    })
  }, 15000)

  it('verlangt im Selbst-Modus den Lead', async () => {
    const user = userEvent.setup()
    const onAbschicken = jest.fn()
    render(<EigeneMeldungKnopf titel={null} onAbschicken={onAbschicken} />)

    await user.click(screen.getByRole('button', { name: 'Mit eigenen Angaben' }))
    await user.click(screen.getByRole('button', { name: 'Selbst schreiben' }))
    await user.type(screen.getByLabelText('Titel'), 'Turnerobe')
    await user.type(screen.getByLabelText('Text'), 'Text.')
    await user.click(screen.getByRole('button', { name: 'Meldung anlegen' }))

    expect(screen.getByText(/Der Lead fehlt/)).toBeInTheDocument()
    expect(onAbschicken).not.toHaveBeenCalled()
  })
})
