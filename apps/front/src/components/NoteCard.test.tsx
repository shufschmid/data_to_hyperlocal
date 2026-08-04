import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NoteFields } from '@/graphql/notes'
import { NoteCard } from './NoteCard'

function note(overrides: Partial<NoteFields> = {}): NoteFields {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Sitzung vom Montag',
    body: 'Wir haben das Vorgehen besprochen.',
    status: 'published',
    ai_summary: null,
    ai_summary_tags: null,
    ai_summary_generated_at: null,
    date_created: '2026-07-29T08:30:00Z',
    ...overrides
  }
}

describe('NoteCard', () => {
  it('shows title, status and body', () => {
    render(<NoteCard note={note()} busy={false} onSummarize={jest.fn()} onDelete={jest.fn()} />)

    expect(screen.getByText('Sitzung vom Montag')).toBeInTheDocument()
    expect(screen.getByText(/Veroeffentlicht/)).toBeInTheDocument()
    expect(screen.getByText('Wir haben das Vorgehen besprochen.')).toBeInTheDocument()
  })

  it('renders the summary with its tags', () => {
    render(
      <NoteCard
        note={note({
          ai_summary: 'Vorgehen besprochen.',
          ai_summary_tags: ['sitzung', 'team']
        })}
        busy={false}
        onSummarize={jest.fn()}
        onDelete={jest.fn()}
      />
    )

    expect(screen.getByText('Vorgehen besprochen.')).toBeInTheDocument()
    expect(screen.getByText('sitzung')).toBeInTheDocument()
    expect(screen.getByText('team')).toBeInTheDocument()
  })

  it('offers a re-run once a summary exists', () => {
    render(
      <NoteCard
        note={note({ ai_summary: 'Kurz.' })}
        busy={false}
        onSummarize={jest.fn()}
        onDelete={jest.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Neu zusammenfassen' })).toBeInTheDocument()
  })

  it('reports the note id when summarising', async () => {
    const onSummarize = jest.fn()
    render(<NoteCard note={note()} busy={false} onSummarize={onSummarize} onDelete={jest.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Zusammenfassen' }))

    expect(onSummarize).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111')
  })

  it('disables both actions while busy', () => {
    render(<NoteCard note={note()} busy onSummarize={jest.fn()} onDelete={jest.fn()} />)

    expect(screen.getByRole('button', { name: 'Zusammenfassen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /loeschen/ })).toBeDisabled()
  })
})
