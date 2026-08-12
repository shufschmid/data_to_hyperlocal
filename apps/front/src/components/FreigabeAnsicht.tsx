'use client'

import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

// What the person counter-checking an article sees.
//
// Two explicit buttons and nothing that decides by itself. Loading the page
// records nothing — that is the whole reason the decision is a POST — so a link
// scanner, a preview generator or a curious click costs nothing.

interface Meldung {
  gueltig: boolean
  hinweis: string
  gemeinde: string | null
  titel: string | null
  lead: string | null
  text: string | null
}

type Zustand =
  | { art: 'laedt' }
  | { art: 'bereit'; meldung: Meldung }
  | { art: 'ungueltig'; hinweis: string }
  | { art: 'entschieden'; hinweis: string }

export function FreigabeAnsicht({ token }: { token: string }) {
  const [zustand, setZustand] = useState<Zustand>({ art: 'laedt' })
  const [kommentar, setKommentar] = useState('')
  const [sendet, setSendet] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  useEffect(() => {
    // The token is in the address bar until this runs. Replacing it keeps it out
    // of the browser history and out of any Referer the page might later send.
    window.history.replaceState(null, '', '/freigabe')
  }, [])

  const laden = useCallback(async () => {
    try {
      const antwort = await fetch(`/api/freigabe/${token}`, { cache: 'no-store' })
      const inhalt = (await antwort.json()) as {
        data?: Meldung
        errors?: { message: string }[]
      }

      if (!antwort.ok || inhalt.data === undefined) {
        setZustand({
          art: 'ungueltig',
          hinweis: inhalt.errors?.[0]?.message ?? 'Dieser Link ist nicht gueltig.'
        })
        return
      }
      if (!inhalt.data.gueltig) {
        setZustand({ art: 'ungueltig', hinweis: inhalt.data.hinweis })
        return
      }

      setZustand({ art: 'bereit', meldung: inhalt.data })
    } catch {
      setZustand({
        art: 'ungueltig',
        hinweis: 'Die Meldung konnte nicht geladen werden.'
      })
    }
  }, [token])

  useEffect(() => {
    void laden()
  }, [laden])

  async function entscheiden(entscheidung: 'ja' | 'nein') {
    setSendet(true)
    setFehler(null)

    try {
      const antwort = await fetch('/api/freigabe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, entscheidung, kommentar: kommentar || null })
      })
      const inhalt = (await antwort.json()) as {
        data?: { hinweis: string }
        errors?: { message: string }[]
      }

      if (!antwort.ok || inhalt.data === undefined) {
        setFehler(inhalt.errors?.[0]?.message ?? 'Das hat nicht geklappt.')
        return
      }

      setZustand({ art: 'entschieden', hinweis: inhalt.data.hinweis })
    } catch {
      setFehler('Das hat nicht geklappt. Bitte noch einmal versuchen.')
    } finally {
      setSendet(false)
    }
  }

  if (zustand.art === 'laedt') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (zustand.art === 'ungueltig') {
    return <Alert severity="warning">{zustand.hinweis}</Alert>
  }

  if (zustand.art === 'entschieden') {
    return <Alert severity="success">{zustand.hinweis}</Alert>
  }

  const { meldung } = zustand

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="body2" color="text.secondary">
          Gegenlesen{meldung.gemeinde === null ? '' : ` — ${meldung.gemeinde}`}
        </Typography>
        <Typography variant="h1" component="h1" sx={{ fontSize: '1.5rem', mt: 1 }}>
          {meldung.titel}
        </Typography>
      </Box>

      <Typography variant="body1" sx={{ fontWeight: 500 }}>
        {meldung.lead}
      </Typography>

      <Paper sx={{ p: 3 }}>
        {(meldung.text ?? '').split(/\n{2,}/).map((absatz, i) => (
          <Typography key={i} variant="body1" sx={{ mb: 2, '&:last-child': { mb: 0 } }}>
            {absatz}
          </Typography>
        ))}
      </Paper>

      <TextField
        label="Anmerkung (freiwillig)"
        multiline
        minRows={2}
        value={kommentar}
        onChange={(e) => setKommentar(e.target.value)}
        disabled={sendet}
      />

      {fehler !== null && <Alert severity="error">{fehler}</Alert>}

      {/* Two explicit buttons. Nothing here decides on its own — opening the
          page must never count as an answer. */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Button variant="contained" disabled={sendet} onClick={() => void entscheiden('ja')}>
          Freigeben
        </Button>
        <Button variant="outlined" color="inherit" disabled={sendet} onClick={() => void entscheiden('nein')}>
          Nicht freigeben
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        Ihre Entscheidung wird erst mit einem Klick erfasst. Dieser Link laesst sich nur einmal verwenden.
      </Typography>
    </Stack>
  )
}
