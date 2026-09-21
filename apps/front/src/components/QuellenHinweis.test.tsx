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
    konfiguration: null,
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

  // Der Satz „Bis das wieder geht, erfaehrst du von hier nichts Neues" ist
  // weg: die Redaktion weiss, was ein Ausfall bedeutet, und er kostete eine
  // Zeile pro gestoerter Quelle.
  it('erklaert nicht, was ein Ausfall bedeutet', () => {
    render(<QuellenHinweis quellen={[blockiert]} onErfassen={jest.fn()} />)
    expect(screen.queryByText(/nichts Neues/)).not.toBeInTheDocument()
  })

  // Gemessen am 21. September 2026: die Zeile des EuroAirports sagte zweimal
  // dasselbe und lief dreizeilig ueber den Bildschirm.
  it('kuerzt die doppelte Absage auf einen Nachsatz', () => {
    render(
      <QuellenHinweis
        quellen={[
          quelle({
            id: 'ea',
            name: 'EuroAirport',
            typ: 'euroairport',
            letzter_fehler:
              'EuroAirport nicht erreichbar: fetch failed — auch über den Crawler nicht: Crawler nicht erreichbar: fetch failed'
          })
        ]}
        onErfassen={jest.fn()}
      />
    )
    expect(screen.getByText(/auch nicht über den Crawler/)).toBeInTheDocument()
    expect(screen.queryByText(/Crawler nicht erreichbar/)).not.toBeInTheDocument()
  })

  // Der wichtigste Knopf: eine gestoerte Quelle war bisher eine Sackgasse.
  it('startet genau den Lauf, der diese Quelle liest', async () => {
    const onNochmals = jest.fn().mockResolvedValue(undefined)
    render(
      <QuellenHinweis
        quellen={[quelle({ id: 'ea', typ: 'euroairport', letzter_fehler: 'nicht erreichbar' })]}
        onErfassen={jest.fn()}
        onNochmals={onNochmals}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Nochmals versuchen' }))
    expect(onNochmals).toHaveBeenCalledWith('quellen/lauf')
  })

  it('bietet das Abtippen nur dort an, wo es etwas zum Abtippen gibt', () => {
    const { rerender } = render(
      <QuellenHinweis quellen={[blockiert]} onErfassen={jest.fn()} onNochmals={jest.fn()} />
    )
    expect(screen.getByRole('button', { name: 'Von Hand' })).toBeInTheDocument()

    rerender(
      <QuellenHinweis
        quellen={[quelle({ id: 'ea', typ: 'euroairport', letzter_fehler: 'nicht erreichbar' })]}
        onErfassen={jest.fn()}
        onNochmals={jest.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Von Hand' })).not.toBeInTheDocument()
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

    await userEvent.click(screen.getByRole('button', { name: 'Von Hand' }))

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
