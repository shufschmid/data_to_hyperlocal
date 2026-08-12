import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QuelleFelder } from '@/graphql/redaktion'
import { QuellenHinweis } from './QuellenHinweis'

function quelle(ueber: Partial<QuelleFelder>): QuelleFelder {
  return {
    id: 'q1',
    name: 'Publikationsagenda Statistik BL',
    typ: 'agenda',
    basis_url: 'https://www.baselland.ch/agenda-2026/',
    letzte_pruefung: '2026-08-12T06:00:00Z',
    letzter_fehler: null,
    ...ueber
  }
}

const blockiert = quelle({
  letzter_fehler:
    'Bot-Pruefung nach 3 Versuchen. Bitte die Agenda von Hand oeffnen und neue Eintraege unter "Ankuendigungen" erfassen: https://www.baselland.ch/agenda-2026/'
})

describe('QuellenHinweis', () => {
  // Eine Quelle, die nicht gelesen werden konnte, sah bisher aus wie eine
  // Quelle, in der nichts Neues steht. Genau das soll der Hinweis beenden.
  it('nennt die Quelle, den Grund und das Datum des letzten Versuchs', () => {
    render(<QuellenHinweis quellen={[blockiert]} onErfassen={jest.fn()} />)

    expect(
      screen.getByText(/Publikationsagenda Statistik BL konnte nicht gelesen werden/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Bot-Pruefung nach 3 Versuchen/)).toBeInTheDocument()
    expect(screen.getByText(/12\.08\.2026/)).toBeInTheDocument()
  })

  it('sagt, dass ein Ausbleiben jetzt nichts mehr bedeutet', () => {
    render(<QuellenHinweis quellen={[blockiert]} onErfassen={jest.fn()} />)
    expect(screen.getByText(/nichts Neues/)).toBeInTheDocument()
  })

  it('führt zur Seite, damit du selbst nachsehen kannst', () => {
    render(<QuellenHinweis quellen={[blockiert]} onErfassen={jest.fn()} />)

    const link = screen.getByRole('link', { name: 'Seite öffnen' })
    expect(link).toHaveAttribute('href', 'https://www.baselland.ch/agenda-2026/')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('führt zum Erfassen von Hand', async () => {
    const onErfassen = jest.fn()
    render(<QuellenHinweis quellen={[blockiert]} onErfassen={onErfassen} />)

    await userEvent.click(screen.getByRole('button', { name: 'Eintrag von Hand erfassen' }))

    expect(onErfassen).toHaveBeenCalled()
  })

  // Kein Balken, wenn alles läuft — sonst gewöhnt man sich an ihn und übersieht
  // ihn genau dann, wenn er etwas bedeutet.
  it('bleibt still, solange jede Quelle gelesen werden konnte', () => {
    const { container } = render(
      <QuellenHinweis quellen={[quelle({}), quelle({ id: 'q2', typ: 'ods' })]} onErfassen={jest.fn()} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('zeigt jede gestörte Quelle einzeln', () => {
    render(
      <QuellenHinweis
        quellen={[
          blockiert,
          quelle({ id: 'q2', name: 'data.bl.ch', typ: 'ods', letzter_fehler: '503: nicht erreichbar' })
        ]}
        onErfassen={jest.fn()}
      />
    )

    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })
})
