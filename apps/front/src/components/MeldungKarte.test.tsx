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
    publiziert_durch: null,
    revision_hinweis: null,
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

describe('das Pruefsiegel auf der Karte', () => {
  it('steht auf der publizierten Karte und nennt die Unterschrift', () => {
    render(
      <MeldungKarte
        meldung={meldung({
          status: 'publiziert',
          publiziert_am: '2026-09-15T10:00:00.000Z',
          publiziert_durch: 'redaktion'
        })}
        onChat={jest.fn()}
        onAktion={jest.fn()}
      />
    )
    expect(screen.getByText('publiziert von der Redaktion, keine Warnung')).toBeInTheDocument()
  })

  it('bleibt weg, solange nichts publiziert ist', () => {
    render(<MeldungKarte meldung={meldung()} onChat={jest.fn()} onAktion={jest.fn()} />)
    expect(screen.queryByText(/publiziert von/)).not.toBeInTheDocument()
  })
})

describe('der Revisionsbefund auf der Karte', () => {
  it('zeigt Fahne und Wortlaut, wenn die Quelle revidiert hat', () => {
    render(
      <MeldungKarte
        meldung={meldung({
          status: 'publiziert',
          publiziert_am: '2026-09-15T10:00:00.000Z',
          publiziert_durch: 'redaktion',
          revision_hinweis:
            'Die Quelle hat ihre Zahlen revidiert. Diese Angaben im Text sind im neuen Stand nicht mehr belegt: 31 Prozent.'
        })}
        onChat={jest.fn()}
        onAktion={jest.fn()}
      />
    )
    expect(screen.getByText('Zahlen revidiert')).toBeInTheDocument()
    expect(screen.getByText(/31 Prozent/)).toBeInTheDocument()
  })

  it('bleibt weg, wo kein Befund steht', () => {
    render(
      <MeldungKarte
        meldung={meldung({ status: 'publiziert', publiziert_am: '2026-09-15T10:00:00.000Z' })}
        onChat={jest.fn()}
        onAktion={jest.fn()}
      />
    )
    expect(screen.queryByText('Zahlen revidiert')).not.toBeInTheDocument()
  })
})
