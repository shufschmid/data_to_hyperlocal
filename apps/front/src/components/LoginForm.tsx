'use client'

import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { setzeMarke, sitzungsFetch } from '@/lib/marke.client'

export interface LoginFormProps {
  onSuccess: () => void | Promise<void>
}

// Signs in against Directus through /api/auth/login. The credentials are posted
// once and never kept in the browser — the session lives in httpOnly cookies.
export function LoginForm({ onSuccess }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem(null)

    try {
      const response = await sitzungsFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })

      const payload = (await response.json().catch(() => null)) as {
        errors?: { message?: string }[]
        data?: { marke?: string }
      } | null

      if (!response.ok) {
        throw new Error(payload?.errors?.[0]?.message ?? 'Anmeldung fehlgeschlagen.')
      }

      // In the editor's frame the answer carries the sealed session instead of
      // a cookie the browser would refuse to keep. Into the page's memory, and
      // nowhere else — see lib/marke.client.ts.
      if (typeof payload?.data?.marke === 'string') setzeMarke(payload.data.marke)

      await onSuccess()
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Anmeldung fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper component="form" onSubmit={submit} sx={{ p: 3, maxWidth: 420, mx: 'auto', mt: 6 }}>
      <Typography variant="h1" gutterBottom>
        Anmelden
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Mit dem Directus-Konto. Lokal: admin@wepublish.ch / admin123
      </Typography>

      <Stack spacing={2} sx={{ mt: 2 }}>
        {problem !== null && <Alert severity="error">{problem}</Alert>}
        <TextField
          label="E-Mail"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          required
          fullWidth
          size="small"
        />
        <TextField
          label="Passwort"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          fullWidth
          size="small"
        />
        <Button type="submit" variant="contained" disabled={busy || email === '' || password === ''}>
          {busy ? 'Anmelden …' : 'Anmelden'}
        </Button>
      </Stack>
    </Paper>
  )
}
