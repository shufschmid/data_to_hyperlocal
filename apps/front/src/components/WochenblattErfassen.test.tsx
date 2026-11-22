import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GemeindeFelder } from '@/graphql/redaktion'
import { WochenblattErfassen } from './WochenblattErfassen'

function gemeinde(id: string, name: string): GemeindeFelder {
  return {
    id,
    name,
    bezirk: 'Arlesheim',
    bfs_nummer: 2761,
    plz: [],
    aktiv: true,
    news_url: null,
    news_letzte_pruefung: null,
    news_letzter_fehler: null,
    news_letzter_hinweis: null,
    suedanflug: false
  }
}

describe('WochenblattErfassen', () => {
  it('erfasst ein Blatt mit Gemeinde, Name und Archiv-Adresse', async () => {
    const onAnlegen = jest.fn().mockResolvedValue(undefined)
    render(
      <WochenblattErfassen
        blaetter={[]}
        gemeinden={[gemeinde('g-1', 'Aesch'), gemeinde('g-2', 'Reinach')]}
        onAnlegen={onAnlegen}
      />
    )
    const knopf = screen.getByRole('button', { name: 'Erfassen' })
    expect(knopf).toBeDisabled()

    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(screen.getByRole('option', { name: 'Aesch' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.type(screen.getByLabelText('Name des Blatts'), ' Wochenblatt ')
    await userEvent.type(screen.getByLabelText('Archiv-Adresse'), 'https://example.ch/archiv/')
    expect(knopf).toBeEnabled()
    await userEvent.click(knopf)

    expect(onAnlegen).toHaveBeenCalledWith({
      gemeinden: ['g-1'],
      name: 'Wochenblatt',
      archiv_url: 'https://example.ch/archiv/'
    })
  })

  it('bietet eine Gemeinde nicht an, die schon ein Blatt hat', async () => {
    render(
      <WochenblattErfassen
        blaetter={[
          {
            gemeinde: { id: 'g-1', name: 'Aesch' },
            abdeckungen: [{ id: 'a', gemeinde: { id: 'g-1', name: 'Aesch' } }]
          }
        ]}
        gemeinden={[gemeinde('g-1', 'Aesch'), gemeinde('g-2', 'Reinach')]}
        onAnlegen={jest.fn()}
      />
    )
    await userEvent.click(screen.getByRole('combobox'))
    expect(screen.queryByRole('option', { name: 'Aesch' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Reinach' })).toBeInTheDocument()
  })
})
