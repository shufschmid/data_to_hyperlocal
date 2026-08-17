import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GemeindeFelder, VereinFelder } from '@/graphql/redaktion'
import { GemeindenAuswahl } from './GemeindenAuswahl'

function gemeinde(ueber: Partial<GemeindeFelder>): GemeindeFelder {
  return { id: 'g', name: 'Ort', bezirk: 'Liestal', bfs_nummer: 1, aktiv: false, ...ueber }
}

function verein(ueber: Partial<VereinFelder>): VereinFelder {
  return {
    id: 'v',
    name: 'FC Ort',
    sportart: 'Fussball',
    bedeutung: 'breitensport',
    liga: null,
    spielort: null,
    zuordnung_geprueft: true,
    aktiv: true,
    gemeinde: { id: 'g' },
    ...ueber
  }
}

const drei = [
  gemeinde({ id: 'a', name: 'Aesch', bezirk: 'Arlesheim', bfs_nummer: 2761, aktiv: true }),
  gemeinde({ id: 'b', name: 'Therwil', bezirk: 'Arlesheim', bfs_nummer: 2775, aktiv: false }),
  gemeinde({ id: 'c', name: 'Riehen', bezirk: 'Basel-Stadt', bfs_nummer: 2703, aktiv: true })
]

describe('GemeindenAuswahl', () => {
  it('nennt die Zahl der aktiven Gemeinden und die Folge', () => {
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} />)

    expect(screen.getByText(/2 von 3 Gemeinden/)).toBeInTheDocument()
    expect(screen.getByText(/eine weitere Meldung pro Lauf/)).toBeInTheDocument()
  })

  // Ein Lauf ohne aktive Gemeinde erzeugt nichts — das darf nicht wie ein
  // Fehler im Lauf aussehen.
  it('warnt, wenn keine Gemeinde aktiv ist', () => {
    render(
      <GemeindenAuswahl gemeinden={drei.map((g) => ({ ...g, aktiv: false }))} onUmschalten={jest.fn()} />
    )

    expect(screen.getByText(/keine Meldung erzeugen/i)).toBeInTheDocument()
  })

  it('meldet den Schalter einer einzelnen Gemeinde', async () => {
    const onUmschalten = jest.fn().mockResolvedValue(undefined)
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={onUmschalten} />)

    await userEvent.click(screen.getByRole('switch', { name: /Therwil/ }))

    expect(onUmschalten).toHaveBeenCalledWith('b', true)
  })

  // Riehen liegt ausserhalb der fuenf BL-Bezirke. In der Bezirks-Gliederung war
  // es eine eigene, zugeklappte Ein-Element-Gruppe und schlicht zu uebersehen.
  it('zeigt jede Gemeinde ohne Aufklappen, auch ausserhalb der BL-Bezirke', () => {
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} />)

    expect(screen.getByRole('switch', { name: /Riehen/ })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /Aesch/ })).toBeInTheDocument()
  })

  it('filtert ueber die Suche, auch ohne Umlaut', async () => {
    render(
      <GemeindenAuswahl
        gemeinden={[...drei, gemeinde({ id: 'd', name: 'Münchenstein', bfs_nummer: 2769 })]}
        onUmschalten={jest.fn()}
      />
    )

    await userEvent.type(screen.getByLabelText('Suche'), 'munchenstein')

    expect(screen.getByRole('switch', { name: /Münchenstein/ })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /Aesch/ })).not.toBeInTheDocument()
  })

  it('blendet auf Wunsch die inaktiven Gemeinden aus', async () => {
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} />)

    await userEvent.click(screen.getByRole('switch', { name: 'Nur aktive' }))

    expect(screen.queryByRole('switch', { name: /Therwil/ })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /Aesch/ })).toBeInTheDocument()
  })

  it('zeigt die Vereine einer aktiven Gemeinde, Aushaengeschild zuerst', () => {
    render(
      <GemeindenAuswahl
        gemeinden={drei}
        vereine={[
          verein({ id: 'v1', name: 'FC Aesch', gemeinde: { id: 'a' } }),
          verein({
            id: 'v2',
            name: "Sm'Aesch Pfeffingen",
            sportart: 'Volleyball',
            bedeutung: 'aushaengeschild',
            liga: 'Nationalliga A',
            gemeinde: { id: 'a' }
          })
        ]}
        onUmschalten={jest.fn()}
      />
    )

    const namen = screen.getAllByText(/FC Aesch|Sm'Aesch Pfeffingen/).map((n) => n.textContent)
    expect(namen.at(0)).toContain("Sm'Aesch Pfeffingen")
    expect(screen.getByText(/Nationalliga A/)).toBeInTheDocument()
  })

  // Eine inaktive Gemeinde kann keine Meldung erzeugen — ihre Vereine sind hier
  // nur Rauschen.
  it('zeigt keine Vereine einer inaktiven Gemeinde', () => {
    render(
      <GemeindenAuswahl
        gemeinden={drei}
        vereine={[verein({ id: 'v3', name: 'FC Therwil', gemeinde: { id: 'b' } })]}
        onUmschalten={jest.fn()}
      />
    )

    expect(screen.queryByText(/FC Therwil/)).not.toBeInTheDocument()
  })

  it('kennzeichnet einen unbestaetigten Verein als Vorschlag', () => {
    render(
      <GemeindenAuswahl
        gemeinden={drei}
        vereine={[
          verein({
            id: 'v4',
            name: 'FC Amicitia Riehen',
            zuordnung_geprueft: false,
            gemeinde: { id: 'c' }
          })
        ]}
        onUmschalten={jest.fn()}
      />
    )

    expect(screen.getByText('vorgeschlagen')).toBeInTheDocument()
  })

  it('sperrt die Schalter, solange geschrieben wird', () => {
    render(<GemeindenAuswahl gemeinden={drei} laeuft onUmschalten={jest.fn()} />)

    expect(screen.getByRole('switch', { name: /Riehen/ })).toBeDisabled()
  })
})
