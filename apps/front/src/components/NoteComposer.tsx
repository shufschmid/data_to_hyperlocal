'use client'

import { useState } from 'react'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

export interface NoteComposerProps {
  busy: boolean
  onCreate: (note: { title: string; body: string }) => Promise<void>
}

export function NoteComposer({ busy, onCreate }: NoteComposerProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const canSubmit = title.trim() !== '' && !busy

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    await onCreate({ title: title.trim(), body: body.trim() })
    setTitle('')
    setBody('')
  }

  return (
    <Paper component="form" onSubmit={submit} sx={{ p: 2 }}>
      <Typography variant="h2" component="h2" gutterBottom>
        Neue Notiz
      </Typography>
      <Stack spacing={2}>
        <TextField
          label="Titel"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          fullWidth
          size="small"
        />
        <TextField
          label="Text"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          multiline
          minRows={3}
          fullWidth
          size="small"
        />
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button type="submit" variant="contained" disabled={!canSubmit}>
            Speichern
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}
