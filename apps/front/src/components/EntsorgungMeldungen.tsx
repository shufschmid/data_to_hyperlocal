'use client'

import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { AlleMeldungFelder, MeldungFelder } from '@/graphql/redaktion'
import { MeldungKarte, type MeldungAktion } from './MeldungKarte'
import {
  erinnerungenNachMonat,
  faelligUnfreigegeben,
  langesDatum,
  naechsteErinnerungen
} from '@/lib/entsorgung'

// The reminders that need a decision now — and the year behind them.
//
// A confirmed calendar writes a whole year in one go, seventy-odd articles, and
// listing them all buried the two that were actually due. So the desk shows
// what is next and folds the rest away; nothing is deleted, because a year is
// exactly what the editor asked the calendar to produce.
//
// The rest stays grouped by the newsletter day rather than by the collection
// date, because that is what the editor is deciding about: which edition this
// text goes into. Everything else — review, chat, counter-check — is the same
// card as everywhere else in this workspace, deliberately: a reminder is an
// ordinary article that happens to know its publication day.

export interface EntsorgungMeldungenProps {
  meldungen: readonly AlleMeldungFelder[]
  onChat: (id: string, anweisung: string) => Promise<void>
  onAktion: (id: string, aktion: MeldungAktion) => Promise<void>
  laeuft?: boolean
  /** Injected in tests. */
  jetzt?: Date
}

export function EntsorgungMeldungen({
  meldungen,
  onChat,
  onAktion,
  laeuft = false,
  jetzt
}: EntsorgungMeldungenProps) {
  const [alleZeigen, setAlleZeigen] = useState(false)
  const { naechste, weitere } = naechsteErinnerungen(meldungen, jetzt ?? new Date())
  const gruppen = erinnerungenNachMonat(weitere)
  const faellig = faelligUnfreigegeben(meldungen, jetzt ?? new Date())

  if (naechste.length === 0 && gruppen.length === 0) {
    return (
      <Alert severity="info">
        Noch keine Erinnerungen. „Meldungen fuers Jahr erzeugen“ schreibt sie, sobald die Termine bestaetigt
        sind.
      </Alert>
    )
  }

  return (
    <Stack spacing={2}>
      {faellig.length > 0 && (
        <Alert severity="warning">
          {faellig.length === 1
            ? 'Eine Erinnerung ist noch nicht freigegeben und erscheint in den naechsten Tagen:'
            : `${faellig.length} Erinnerungen sind noch nicht freigegeben und erscheinen in den naechsten Tagen:`}{' '}
          {faellig.map((meldung) => langesDatum(meldung.erscheint_am)).join(' · ')}. Ohne Freigabe werden sie
          nicht publiziert.
        </Alert>
      )}

      {naechste.length > 0 && (
        <Stack spacing={1}>
          <Paper sx={{ px: 2, py: 1, borderLeft: 4, borderColor: 'primary.main' }}>
            <Typography variant="subtitle2">
              Als Naechstes dran{' '}
              <Typography component="span" variant="caption" color="text.secondary">
                — erscheint {naechste.map((m) => langesDatum(m.erscheint_am)).join(' und ')}
              </Typography>
            </Typography>
          </Paper>
          {naechste.map((meldung) => (
            <MeldungKarte
              key={meldung.id}
              meldung={meldung as unknown as MeldungFelder}
              erscheintAm={meldung.erscheint_am}
              sofortPublizierbar
              onChat={onChat}
              onAktion={onAktion}
              laeuft={laeuft}
            />
          ))}
        </Stack>
      )}

      {gruppen.length > 0 && (
        <Box>
          <Button size="small" onClick={() => setAlleZeigen((a) => !a)} sx={{ px: 0 }}>
            {alleZeigen
              ? 'Uebrige Erinnerungen verbergen'
              : `Uebrige ${weitere.length} Erinnerungen des Jahres anzeigen`}
          </Button>
        </Box>
      )}

      <Collapse in={alleZeigen} unmountOnExit>
        <Stack spacing={2}>
          {gruppen.map((gruppe) => (
            <Stack key={gruppe.monat} spacing={1}>
              <Paper sx={{ px: 2, py: 1 }}>
                <Typography variant="subtitle2">
                  {gruppe.monat}{' '}
                  <Typography component="span" variant="caption" color="text.secondary">
                    — {gruppe.eintraege.length}{' '}
                    {gruppe.eintraege.length === 1 ? 'Erinnerung' : 'Erinnerungen'}
                  </Typography>
                </Typography>
              </Paper>
              {gruppe.eintraege.map((meldung) => (
                <MeldungKarte
                  key={meldung.id}
                  meldung={meldung as unknown as MeldungFelder}
                  erscheintAm={meldung.erscheint_am}
                  onChat={onChat}
                  onAktion={onAktion}
                  laeuft={laeuft}
                />
              ))}
            </Stack>
          ))}
        </Stack>
      </Collapse>
    </Stack>
  )
}
