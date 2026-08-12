import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GemeindeFelder } from '@/graphql/redaktion'
import { GemeindenAuswahl } from './GemeindenAuswahl'

function gemeinde(ueber: Partial<GemeindeFelder>): GemeindeFelder {
  return { id: 'g', name: 'Ort', bezirk: 'Liestal', bfs_nummer: 1, aktiv: false, ...ueber }
}

const drei = [
  gemeinde({ id: 'a', name: 'Aesch', bezirk: 'Arlesheim', bfs_nummer: 2761, aktiv: true }),
  gemeinde({ id: 'b', name: 'Therwil', bezirk: 'Arlesheim', bfs_nummer: 2782, aktiv: false }),
  gemeinde({ id: 'c', name: 'Liestal', bezirk: 'Liestal', bfs_nummer: 2829, aktiv: true })
]

function bezirk(name: string) {
  return screen.getByRole('heading', { name }).closest('.MuiPaper-root') as HTMLElement
}

describe('GemeindenAuswahl', () => {
  it('nennt die Zahl der aktiven Gemeinden und die Folge', () => {
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} onBezirk={jest.fn()} />)

    expect(screen.getByText(/2 von 3 Gemeinden/)).toBeInTheDocument()
    expect(screen.getByText(/eine weitere Meldung pro Lauf/)).toBeInTheDocument()
  })

  // Ein Lauf ohne aktive Gemeinde erzeugt nichts — das darf nicht wie ein
  // Fehler im Lauf aussehen.
  it('warnt, wenn keine Gemeinde aktiv ist', () => {
    render(
      <GemeindenAuswahl
        gemeinden={drei.map((g) => ({ ...g, aktiv: false }))}
        onUmschalten={jest.fn()}
        onBezirk={jest.fn()}
      />
    )

    expect(screen.getByText(/keine Meldung erzeugen/i)).toBeInTheDocument()
  })

  it('meldet den Schalter einer einzelnen Gemeinde', async () => {
    const onUmschalten = jest.fn().mockResolvedValue(undefined)
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={onUmschalten} onBezirk={jest.fn()} />)

    await userEvent.click(within(bezirk('Arlesheim')).getByRole('button', { name: 'Zeigen' }))
    await userEvent.click(screen.getByRole('switch', { name: /Therwil/ }))

    expect(onUmschalten).toHaveBeenCalledWith('b', true)
  })

  // «Alle» schickt nur, was noch fehlt: 30 überflüssige Schreibvorgänge sind
  // 30 Gelegenheiten, auf halbem Weg zu scheitern.
  it('schickt bei „Alle“ nur die noch nicht aktiven Gemeinden', async () => {
    const onBezirk = jest.fn().mockResolvedValue(undefined)
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} onBezirk={onBezirk} />)

    await userEvent.click(within(bezirk('Arlesheim')).getByRole('button', { name: 'Alle' }))

    expect(onBezirk).toHaveBeenCalledWith(['b'], true)
  })

  it('schickt bei „Keine“ nur die aktiven Gemeinden des Bezirks', async () => {
    const onBezirk = jest.fn().mockResolvedValue(undefined)
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} onBezirk={onBezirk} />)

    await userEvent.click(within(bezirk('Arlesheim')).getByRole('button', { name: 'Keine' }))

    expect(onBezirk).toHaveBeenCalledWith(['a'], false)
  })

  it('sperrt die Schalter, solange geschrieben wird', async () => {
    render(<GemeindenAuswahl gemeinden={drei} laeuft onUmschalten={jest.fn()} onBezirk={jest.fn()} />)

    await userEvent.click(within(bezirk('Liestal')).getByRole('button', { name: 'Zeigen' }))
    expect(screen.getByRole('switch', { name: /Liestal/ })).toBeDisabled()
  })
})
