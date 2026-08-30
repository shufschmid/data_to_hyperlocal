import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntsorgungMeldungen } from './EntsorgungMeldungen'
import type { AlleMeldungFelder } from '@/graphql/redaktion'

function meldung(ueber: Partial<AlleMeldungFelder>): AlleMeldungFelder {
  return {
    id: 'm-1',
    titel: 'Binningen: Papier und Karton am Freitag (12. Juni 2026)',
    lead: 'Im Ostplateau wird am Freitag Papier abgefuehrt.',
    text: 'Bereitstellen bis 7 Uhr.',
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: null,
    fehler: null,
    publiziert_am: null,
    erscheint_am: '2026-06-11',
    date_created: null,
    gemeinde: { id: 'g-1', name: 'Binningen', bezirk: 'Arlesheim' },
    lauf: null,
    spiel: null,
    kandidat: null,
    perle: null,
    ...ueber
  }
}

const JETZT = new Date('2026-06-01T12:00:00Z')

describe('EntsorgungMeldungen', () => {
  it('zeigt nur die naechsten zwei und klappt den Rest weg', async () => {
    // Ein bestaetigter Kalender schreibt ein ganzes Jahr auf einmal. Alle zu
    // zeigen begrub die zwei, die tatsaechlich anstehen.
    render(
      <EntsorgungMeldungen
        meldungen={[
          meldung({ id: 'a', erscheint_am: '2026-06-11' }),
          meldung({ id: 'b', erscheint_am: '2026-07-02' }),
          meldung({ id: 'c', erscheint_am: '2026-09-03' })
        ]}
        onChat={jest.fn()}
        onAktion={jest.fn()}
        jetzt={JETZT}
      />
    )

    expect(screen.getByText(/Als Naechstes dran/)).toBeInTheDocument()
    expect(screen.queryByText(/^September 2026$/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Uebrige 1 Erinnerungen/ }))

    // Die Monatsueberschrift traegt die Zahl der Erinnerungen — daran ist sie
    // von den Datumsangaben in den Karten zu unterscheiden.
    expect(screen.getByText(/^September 2026$/)).toBeInTheDocument()
    expect(screen.getAllByText(/— 1 Erinnerung$/)).toHaveLength(1)
  })

  it('bietet Freigeben statt Publizieren an', async () => {
    // Publizieren wuerde die Erinnerung Wochen zu frueh sichtbar machen; der
    // Tageslauf publiziert sie am Vortag ihres Erscheinungstags.
    const onAktion = jest.fn().mockResolvedValue(undefined)
    render(
      <EntsorgungMeldungen
        meldungen={[meldung({ id: 'm-7' })]}
        onChat={jest.fn()}
        onAktion={onAktion}
        jetzt={JETZT}
      />
    )

    expect(screen.queryByRole('button', { name: 'Publizieren' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Freigeben' }))

    expect(onAktion).toHaveBeenCalledWith('m-7', 'freigeben')
  })

  // Fuer die naechsten zwei gibt es zusaetzlich den direkten Weg — die Redaktion
  // will nicht auf den Tageslauf warten muessen.
  it('bietet den anstehenden Erinnerungen „Jetzt publizieren" an', async () => {
    const onAktion = jest.fn().mockResolvedValue(undefined)
    render(
      <EntsorgungMeldungen
        meldungen={[meldung({ id: 'm-9' })]}
        onChat={jest.fn()}
        onAktion={onAktion}
        jetzt={JETZT}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Jetzt publizieren' }))
    expect(onAktion).toHaveBeenCalledWith('m-9', 'publizieren')
  })

  it('nennt den Erscheinungstag an der Karte', () => {
    render(
      <EntsorgungMeldungen
        meldungen={[meldung({ erscheint_am: '2026-06-11' })]}
        onChat={jest.fn()}
        onAktion={jest.fn()}
        jetzt={JETZT}
      />
    )

    expect(screen.getByText(/Erscheint am Donnerstag, 11. Juni 2026/)).toBeInTheDocument()
    expect(screen.getByText(/publiziert sie am Vorabend/)).toBeInTheDocument()
  })

  it('warnt vor Entwuerfen, deren Tag naht', () => {
    // Ohne Freigabe erscheint die Erinnerung nie — und zwar lautlos.
    render(
      <EntsorgungMeldungen
        meldungen={[meldung({ erscheint_am: '2026-06-03', status: 'entwurf' })]}
        onChat={jest.fn()}
        onAktion={jest.fn()}
        jetzt={JETZT}
      />
    )

    expect(screen.getByText(/noch nicht freigegeben/)).toBeInTheDocument()
  })

  it('schweigt, wenn alles Nahe freigegeben ist', () => {
    render(
      <EntsorgungMeldungen
        meldungen={[meldung({ erscheint_am: '2026-06-03', status: 'freigegeben' })]}
        onChat={jest.fn()}
        onAktion={jest.fn()}
        jetzt={JETZT}
      />
    )

    expect(screen.queryByText(/noch nicht freigegeben/)).not.toBeInTheDocument()
  })

  it('sagt bei leerer Liste, was sie fuellt', () => {
    render(<EntsorgungMeldungen meldungen={[]} onChat={jest.fn()} onAktion={jest.fn()} jetzt={JETZT} />)

    expect(screen.getByText(/Noch keine Erinnerungen/)).toBeInTheDocument()
  })
})
