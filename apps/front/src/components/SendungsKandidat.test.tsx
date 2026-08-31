import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AlleMeldungFelder, SendungskandidatFelder } from '@/graphql/redaktion'
import { SendungsKandidat } from './SendungsKandidat'

function kandidat(ueber: Partial<SendungskandidatFelder> = {}): SendungskandidatFelder {
  return {
    id: 'k1',
    quelle: 'regionaljournal',
    titel: 'Schulhaus wird saniert',
    zusammenfassung: 'Kosten: 4 Millionen.',
    begruendung: 'Betrifft alle Familien im Dorf.',
    zeitmarke_sekunden: 261,
    entscheid: 'offen',
    ablehnungsgrund: null,
    gemeinde: { id: 'g1', name: 'Aesch' },
    edition: { id: 'e1' },
    punkt6_edition: null,
    ...ueber
  }
}

function meldung(ueber: Partial<AlleMeldungFelder> = {}): AlleMeldungFelder {
  return {
    id: 'm1',
    titel: 'Aesch saniert sein Schulhaus',
    lead: 'Vier Millionen Franken.',
    text: 'Text.',
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: null,
    fehler: null,
    publiziert_am: null,
    erscheint_am: null,
    date_created: '2026-08-31',
    gemeinde: { id: 'g1', name: 'Aesch', bezirk: 'Arlesheim' },
    lauf: null,
    spiel: null,
    kandidat: null,
    amtsblattmeldung: null,
    sendungskandidat: { id: 'k1' },
    perle: null,
    ...ueber
  }
}

describe('SendungsKandidat', () => {
  it('nennt Gemeinde, Begruendung und die Stelle in der Sendung', () => {
    render(<SendungsKandidat kandidat={kandidat()} />)

    expect(screen.getByText('Vorschlag für Aesch')).toBeInTheDocument()
    expect(screen.getByText('Betrifft alle Familien im Dorf.')).toBeInTheDocument()
    expect(screen.getByText('ab 4:21')).toBeInTheDocument()
  })

  it('reicht das Schreiben und das Weiterreichen weiter', async () => {
    const onMeldung = jest.fn().mockResolvedValue(undefined)
    const onWeiterreichen = jest.fn().mockResolvedValue(undefined)
    render(<SendungsKandidat kandidat={kandidat()} onMeldung={onMeldung} onWeiterreichen={onWeiterreichen} />)

    await userEvent.click(screen.getByRole('button', { name: 'Meldung schreiben' }))
    expect(onMeldung).toHaveBeenCalledWith('k1')

    await userEvent.click(screen.getByRole('button', { name: 'An Chefredaktion' }))
    expect(onWeiterreichen).toHaveBeenCalledWith('k1', null)
  })

  // Der Grund ist das Lernsignal — „nur am Rand erwähnt" lehrt die nächste
  // Sichtung genau die Unterscheidung, um die der Prompt sie bittet.
  it('fragt beim Ablehnen nach dem Grund', async () => {
    const onAblehnen = jest.fn().mockResolvedValue(undefined)
    render(<SendungsKandidat kandidat={kandidat()} onAblehnen={onAblehnen} />)

    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))
    await userEvent.type(screen.getByLabelText('Kommentar'), 'Kam nur in einer Liste vor.')
    await userEvent.click(screen.getAllByRole('button', { name: 'Ablehnen' }).at(-1)!)

    expect(onAblehnen).toHaveBeenCalledWith('k1', 'nicht_relevant', 'Kam nur in einer Liste vor.')
  })

  // Wie beim Amtsblatt: die Meldung wird dort redigiert, wo sie entstanden ist.
  it('zeigt die Meldung, sobald sie geschrieben ist', () => {
    render(<SendungsKandidat kandidat={kandidat({ entscheid: 'uebernommen' })} meldung={meldung()} />)

    expect(screen.getByText('Aesch saniert sein Schulhaus')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Meldung schreiben' })).not.toBeInTheDocument()
  })
})
