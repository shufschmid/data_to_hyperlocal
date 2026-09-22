import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TerminZeile } from './TerminZeile'

const termin = { ideal: '2026-10-17', ende: '2026-10-17', auftritte: ['2026-10-17'] }

describe('TerminZeile', () => {
  it('zeigt den Termin in einer Zeile und den Vorschlag, wenn die Redaktion abwich', () => {
    render(
      <TerminZeile
        termin={termin}
        terminVorschlag={termin}
        wichtig={true}
        wichtigVorschlag={false}
        onSpeichern={jest.fn()}
      />
    )
    expect(
      screen.getByText(/Termin 17\.10\.2026 · wichtig: Auftritte sofort nach Publikation/)
    ).toBeInTheDocument()
    expect(screen.getByText(/^Vorschlag: /)).toBeInTheDocument()
  })

  it('sagt, was ohne Termin gilt', () => {
    render(
      <TerminZeile
        termin={null}
        terminVorschlag={null}
        wichtig={null}
        wichtigVorschlag={null}
        onSpeichern={jest.fn()}
      />
    )
    expect(screen.getByText(/Kein Termin/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Termin setzen' })).toBeInTheDocument()
  })

  // Der Wichtig-Schalter ist das Lernsignal — und beim Einschalten wird der
  // Termin selbst zum Auftritt, damit „sofort, dann der Termin" ohne Tippen
  // zustande kommt.
  it('schickt die Eingabe der Redaktion — mit dem Termin als Auftritt, sobald wichtig', async () => {
    const onSpeichern = jest.fn().mockResolvedValue(undefined)
    render(
      <TerminZeile
        termin={{ ...termin, auftritte: [] }}
        terminVorschlag={{ ...termin, auftritte: [] }}
        wichtig={false}
        wichtigVorschlag={false}
        onSpeichern={onSpeichern}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Termin ändern' }))
    await userEvent.click(screen.getByRole('switch'))
    await userEvent.click(screen.getByRole('button', { name: 'Termin speichern' }))

    expect(onSpeichern).toHaveBeenCalledWith({
      ideal: '2026-10-17',
      ende: '2026-10-17',
      auftritte: ['2026-10-17'],
      wichtig: true
    })
  })

  it('haelt eine Eingabe zurueck, die der Endpunkt ablehnen wuerde', async () => {
    const onSpeichern = jest.fn()
    render(
      <TerminZeile
        termin={termin}
        terminVorschlag={termin}
        wichtig={false}
        wichtigVorschlag={false}
        onSpeichern={onSpeichern}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Termin ändern' }))
    await userEvent.clear(screen.getByLabelText('Ende'))
    await userEvent.type(screen.getByLabelText('Ende'), '2026-10-10')
    await userEvent.click(screen.getByRole('button', { name: 'Termin speichern' }))

    expect(screen.getByText('Das Ende liegt vor dem Termin.')).toBeInTheDocument()
    expect(onSpeichern).not.toHaveBeenCalled()
  })
})
