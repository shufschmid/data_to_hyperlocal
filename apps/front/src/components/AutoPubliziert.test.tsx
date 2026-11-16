import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AlleMeldungFelder } from '@/graphql/redaktion'
import { AutoPubliziert } from './AutoPubliziert'

const meldung = (ueber: Partial<AlleMeldungFelder> = {}): AlleMeldungFelder =>
  ({
    id: 'm1',
    titel: 'Aesch saniert den Kindergarten',
    lead: 'Wie die Gemeinde Aesch mitteilt, wird saniert.',
    text: 'Der Gemeinderat hat die Sanierung beschlossen.',
    status: 'publiziert',
    verarbeitung: 'idle',
    zeit_warnungen: null,
    publiziert_am: '2026-11-15T12:00:00.000Z',
    publiziert_durch: 'automatik',
    gemeinde: { id: 'g1', name: 'Aesch', bezirk: 'Arlesheim' },
    gemeindemitteilung: { id: 'x' },
    ...ueber
  }) as AlleMeldungFelder

describe('AutoPubliziert', () => {
  it('bleibt weg, wenn der Schalter aus ist und nichts hinausging', () => {
    const { container } = render(
      <AutoPubliziert
        tisch="gemeinde"
        meldungen={[]}
        heute="2026-11-16"
        eingeschaltet={false}
        onZurueckziehen={jest.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('sagt eingeschaltet auch dann, was gilt, wenn noch nichts hinausging', () => {
    render(
      <AutoPubliziert
        tisch="gemeinde"
        meldungen={[]}
        heute="2026-11-16"
        eingeschaltet
        onZurueckziehen={jest.fn()}
      />
    )
    expect(screen.getByText('Auto-Publish ein')).toBeInTheDocument()
    expect(screen.getByText(/nichts automatisch publiziert/)).toBeInTheDocument()
  })

  it('zeigt nur, was der Lauf dieses Tischs publizierte, und laesst es lesen', () => {
    render(
      <AutoPubliziert
        tisch="gemeinde"
        meldungen={[
          meldung(),
          meldung({ id: 'm2', titel: 'Von Hand publiziert', publiziert_durch: 'redaktion' }),
          meldung({ id: 'm3', titel: 'Vom Kanton', gemeindemitteilung: null, kantonsmitteilung: { id: 'k' } })
        ]}
        heute="2026-11-16"
        eingeschaltet
        onZurueckziehen={jest.fn()}
      />
    )
    expect(screen.getByText('Aesch saniert den Kindergarten')).toBeInTheDocument()
    expect(screen.queryByText('Von Hand publiziert')).not.toBeInTheDocument()
    expect(screen.queryByText('Vom Kanton')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lesen' }))
    expect(screen.getByText(/Der Gemeinderat hat die Sanierung beschlossen/)).toBeInTheDocument()
  })

  it('zieht erst nach der Bestaetigung zurueck und gibt den Grund mit', async () => {
    const onZurueckziehen = jest.fn().mockResolvedValue(undefined)
    render(
      <AutoPubliziert
        tisch="gemeinde"
        meldungen={[meldung()]}
        heute="2026-11-16"
        eingeschaltet={false}
        onZurueckziehen={onZurueckziehen}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Zurückziehen' }))
    expect(onZurueckziehen).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/Warum/), { target: { value: 'Falscher Termin' } })
    const knoepfe = screen.getAllByRole('button', { name: 'Zurückziehen' })
    fireEvent.click(knoepfe[knoepfe.length - 1]!)
    await waitFor(() => expect(onZurueckziehen).toHaveBeenCalledWith('m1', 'Falscher Termin'))
  })
})
