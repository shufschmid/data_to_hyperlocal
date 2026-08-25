import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuellenLauf } from './QuellenLauf'
import type { QuellenLaufStatus } from '@/lib/redaktion'

function status(ueber: Partial<QuellenLaufStatus>): QuellenLaufStatus {
  return {
    laeuft: false,
    gestartet_um: null,
    beendet_um: null,
    quellen: null,
    sport: null,
    fehler: null,
    ...ueber
  }
}

describe('QuellenLauf', () => {
  it('startet den Lauf auf Knopfdruck', async () => {
    const onStarten = jest.fn().mockResolvedValue(undefined)
    render(<QuellenLauf status={status({})} onStarten={onStarten} />)

    await userEvent.click(screen.getByRole('button', { name: 'Alle Quellen jetzt abrufen' }))

    expect(onStarten).toHaveBeenCalled()
  })

  it('sperrt den Knopf, solange ein Lauf unterwegs ist', () => {
    render(
      <QuellenLauf
        status={status({ laeuft: true, gestartet_um: '2026-08-25T06:00:00Z' })}
        onStarten={jest.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Lauf ist unterwegs/ })).toBeDisabled()
    expect(screen.getByText(/dauert einige Minuten/)).toBeInTheDocument()
  })

  it('fasst den letzten Lauf zusammen', () => {
    render(
      <QuellenLauf
        status={status({
          beendet_um: '2026-08-25T06:05:00Z',
          quellen: { neu: 2, geaendert: 1, bewertet: 5, fehler: [] },
          sport: { neu: 4, aktualisiert: 3 }
        })}
        onStarten={jest.fn()}
      />
    )

    expect(screen.getByText(/Datenquellen: 2 neu, 1 geändert, 5 bewertet/)).toBeInTheDocument()
    expect(screen.getByText(/Sport: 4 neu, 3 aktualisiert/)).toBeInTheDocument()
  })

  it('zeigt einen fehlgeschlagenen Lauf an, statt ihn zu verstecken', () => {
    render(
      <QuellenLauf
        status={status({ beendet_um: '2026-08-25T06:05:00Z', fehler: 'Portal nicht erreichbar' })}
        onStarten={jest.fn()}
      />
    )

    expect(screen.getByText(/Portal nicht erreichbar/)).toBeInTheDocument()
  })
})
