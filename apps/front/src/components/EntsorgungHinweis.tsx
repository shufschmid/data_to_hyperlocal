'use client'

import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import type { EntsorgungskalenderFelder, GemeindeFelder } from '@/graphql/redaktion'
import { fehlendeKalender } from '@/lib/entsorgung'

// The January banner.
//
// The reminders of a new year cannot be written before the calendar for it
// exists, and nothing about that gap announces itself: no source failed, no
// request was refused — the tab is simply empty for that municipality, which
// looks exactly like a quiet month. This is the one place that says so, and it
// says it in January only, when it is actually actionable.

export interface EntsorgungHinweisProps {
  gemeinden: readonly GemeindeFelder[]
  kalender: readonly EntsorgungskalenderFelder[]
  onErfassen: () => void
  /** Injected in tests. */
  jetzt?: Date
}

export function EntsorgungHinweis({ gemeinden, kalender, onErfassen, jetzt }: EntsorgungHinweisProps) {
  const heute = jetzt ?? new Date()
  const fehlend = fehlendeKalender(gemeinden, kalender, heute)

  if (fehlend.length === 0) return null

  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" size="small" onClick={onErfassen}>
          Kalender erfassen
        </Button>
      }
    >
      <AlertTitle>Abfuhrkalender {heute.getFullYear()} fehlt</AlertTitle>
      <Box>
        Fuer {fehlend.length === 1 ? 'diese Gemeinde' : 'diese Gemeinden'} ist noch kein Kalender erfasst:{' '}
        {fehlend.map((gemeinde) => gemeinde.name).join(', ')}. Ohne ihn entstehen dieses Jahr keine
        Entsorgungserinnerungen.
      </Box>
    </Alert>
  )
}
