'use client'

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { quellenLaufText, type QuellenLaufStatus } from '@/lib/redaktion'

// The hand crank for the two scheduled scrapes.
//
// Data sources (portal, agenda, data.bl.ch catalogue) and sport results are
// normally fetched by their nightly Flows; this button runs exactly the same
// code now. Waste calendars are deliberately not part of it — those are
// registered one PDF at a time by an editor.

export interface QuellenLaufProps {
  status: QuellenLaufStatus | null
  onStarten: () => Promise<void>
  laeuft?: boolean
}

export function QuellenLauf({ status, onStarten, laeuft = false }: QuellenLaufProps) {
  const unterwegs = status?.laeuft === true
  const text = status === null ? null : quellenLaufText(status)

  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => void onStarten()}
            disabled={laeuft || unterwegs}
            startIcon={unterwegs ? <CircularProgress size={16} /> : undefined}
          >
            {unterwegs ? 'Lauf ist unterwegs …' : 'Alle Quellen jetzt abrufen'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            Startet die beiden täglichen Abrufe von Hand: Datenquellen (Portal, Agenda, data.bl.ch) und
            Sportresultate. Abfuhrkalender werden separat als PDF erfasst.
          </Typography>
        </Stack>

        {status?.fehler != null && (
          <Alert severity="error">Der letzte Lauf ist fehlgeschlagen: {status.fehler}</Alert>
        )}
        {text !== null && (
          <Typography variant="body2" color="text.secondary">
            {text}
          </Typography>
        )}
      </Stack>
    </Paper>
  )
}
