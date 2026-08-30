'use client'

import { useCallback, useEffect, useState } from 'react'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { LoginForm } from './LoginForm'
import { RedaktionPanel } from './RedaktionPanel'

interface SessionUser {
  email: string
  first_name: string | null
}

type State = { status: 'loading' } | { status: 'anonymous' } | { status: 'signed-in'; user: SessionUser }

// Decides between the login form and the app.
//
// The session check runs in the browser, which also means no Apollo query is ever
// issued during server rendering — the queries live below this gate, and the gate
// starts out in `loading`.
export function AppShell() {
  const [state, setState] = useState<State>({ status: 'loading' })

  const check = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' })

      if (!response.ok) {
        setState({ status: 'anonymous' })
        return
      }

      const payload = (await response.json()) as { data?: SessionUser }
      setState(payload.data ? { status: 'signed-in', user: payload.data } : { status: 'anonymous' })
    } catch {
      setState({ status: 'anonymous' })
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setState({ status: 'anonymous' })
  }

  if (state.status === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (state.status === 'anonymous') {
    return (
      <Container maxWidth="sm">
        <LoginForm onSuccess={check} />
      </Container>
    )
  }

  return (
    <>
      <AppBar
        position="static"
        color="default"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar>
          <Typography variant="h1" component="h1" sx={{ flexGrow: 1, fontSize: '1.25rem' }}>
            Die Redaktion
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mr: 2, display: { xs: 'none', sm: 'block' } }}
          >
            {state.user.first_name ?? state.user.email}
          </Typography>
          <Button size="small" onClick={signOut}>
            Abmelden
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        {/* Stirbt die Sitzung im Betrieb, prueft die Huelle neu und zeigt das
            Anmeldeformular — statt angemeldet auszusehen, waehrend nichts mehr
            laedt. */}
        <RedaktionPanel onSitzungEnde={check} />
      </Container>
    </>
  )
}
