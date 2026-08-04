'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import {
  CREATE_NOTE_MUTATION,
  DELETE_NOTE_MUTATION,
  NOTES_QUERY,
  type CreateNoteResult,
  type DeleteNoteResult,
  type NotesQueryResult
} from '@/graphql/notes'
import { LIVE_FETCH_POLICY } from '@/lib/apollo'
import { NoteCard } from './NoteCard'
import { NoteComposer } from './NoteComposer'

// The one component that fetches. Reads and writes to collections go through
// GraphQL; anything that needs server-side logic (here: the Claude summary) is a
// POST to a route handler that forwards to the Directus extension.
export function NotesPanel() {
  const { data, loading, error, refetch } = useQuery<NotesQueryResult>(NOTES_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const [createNote, createState] = useMutation<CreateNoteResult>(CREATE_NOTE_MUTATION)
  const [deleteNote] = useMutation<DeleteNoteResult>(DELETE_NOTE_MUTATION)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  async function handleCreate(note: { title: string; body: string }) {
    setProblem(null)
    try {
      await createNote({ variables: { title: note.title, body: note.body, status: 'published' } })
      await refetch()
    } catch (cause) {
      setProblem(messageOf(cause, 'Die Notiz konnte nicht gespeichert werden.'))
    }
  }

  async function handleSummarize(id: string) {
    setProblem(null)
    setBusyId(id)
    try {
      const response = await fetch(`/api/notes/${id}/summary`, { method: 'POST' })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          errors?: { message?: string }[]
        } | null
        throw new Error(payload?.errors?.[0]?.message ?? `Fehler ${response.status}`)
      }

      await refetch()
    } catch (cause) {
      setProblem(messageOf(cause, 'Die Zusammenfassung konnte nicht erzeugt werden.'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id: string) {
    setProblem(null)
    setBusyId(id)
    try {
      await deleteNote({ variables: { id } })
      await refetch()
    } catch (cause) {
      setProblem(messageOf(cause, 'Die Notiz konnte nicht geloescht werden.'))
    } finally {
      setBusyId(null)
    }
  }

  const notes = data?.notes ?? []

  return (
    <Stack spacing={2}>
      <NoteComposer busy={createState.loading} onCreate={handleCreate} />

      {problem !== null && (
        <Alert severity="error" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      )}

      {error !== undefined && (
        <Alert severity="error">Notizen konnten nicht geladen werden: {error.message}</Alert>
      )}

      {loading && notes.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && notes.length === 0 && error === undefined && (
        <Typography color="text.secondary">Noch keine Notizen. Legen Sie oben die erste an.</Typography>
      )}

      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          busy={busyId === note.id}
          onSummarize={handleSummarize}
          onDelete={handleDelete}
        />
      ))}
    </Stack>
  )
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : fallback
}
