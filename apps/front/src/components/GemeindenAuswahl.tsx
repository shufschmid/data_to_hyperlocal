'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import type { GemeindeFelder } from '@/graphql/redaktion'
import { nachBezirk } from '@/lib/redaktion'

// Which municipalities get an article.
//
// It lives here rather than only in the Directus admin because it is an
// editorial decision, not a database chore — and because the consequence is
// immediate: one more municipality is one more paid call on every run. The
// count sits next to the switches for exactly that reason.

export interface GemeindenAuswahlProps {
  gemeinden: readonly GemeindeFelder[]
  onUmschalten: (id: string, aktiv: boolean) => Promise<void>
  onBezirk: (ids: readonly string[], aktiv: boolean) => Promise<void>
  laeuft?: boolean
}

export function GemeindenAuswahl({
  gemeinden,
  onUmschalten,
  onBezirk,
  laeuft = false
}: GemeindenAuswahlProps) {
  const [aufgeklappt, setAufgeklappt] = useState<string | null>(null)
  const bezirke = useMemo(() => nachBezirk(gemeinden), [gemeinden])
  const aktiv = gemeinden.filter((g) => g.aktiv).length

  return (
    <Stack spacing={2}>
      <Alert severity={aktiv === 0 ? 'warning' : 'info'}>
        {aktiv === 0
          ? 'Keine Gemeinde ausgewählt — ein Lauf würde keine Meldung erzeugen.'
          : `${aktiv} von ${gemeinden.length} Gemeinden werden bespielt. Jede zusätzliche Gemeinde ist eine weitere Meldung pro Lauf.`}
      </Alert>

      {bezirke.map(({ bezirk, gemeinden: imBezirk }) => {
        const aktivImBezirk = imBezirk.filter((g) => g.aktiv).length
        const offen = aufgeklappt === bezirk

        return (
          <Paper key={bezirk} sx={{ p: 2 }}>
            <Stack spacing={1}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="h3" component="h3" sx={{ fontSize: '1rem' }}>
                    {bezirk}
                  </Typography>
                  <Chip
                    size="small"
                    label={`${aktivImBezirk}/${imBezirk.length}`}
                    color={aktivImBezirk > 0 ? 'primary' : 'default'}
                  />
                </Stack>
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    disabled={laeuft || aktivImBezirk === imBezirk.length}
                    onClick={() =>
                      void onBezirk(
                        imBezirk.filter((g) => !g.aktiv).map((g) => g.id),
                        true
                      )
                    }
                  >
                    Alle
                  </Button>
                  <Button
                    size="small"
                    color="inherit"
                    disabled={laeuft || aktivImBezirk === 0}
                    onClick={() =>
                      void onBezirk(
                        imBezirk.filter((g) => g.aktiv).map((g) => g.id),
                        false
                      )
                    }
                  >
                    Keine
                  </Button>
                  <Button size="small" onClick={() => setAufgeklappt(offen ? null : bezirk)}>
                    {offen ? 'Zuklappen' : 'Zeigen'}
                  </Button>
                </Stack>
              </Stack>

              {offen && (
                <>
                  <Divider />
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '1fr',
                        sm: 'repeat(2, 1fr)',
                        md: 'repeat(3, 1fr)'
                      },
                      gap: 0.5
                    }}
                  >
                    {imBezirk.map((g) => (
                      <FormControlLabel
                        key={g.id}
                        control={
                          <Switch
                            size="small"
                            checked={g.aktiv}
                            disabled={laeuft}
                            onChange={(e) => void onUmschalten(g.id, e.target.checked)}
                          />
                        }
                        label={
                          <Typography variant="body2">
                            {g.name}{' '}
                            <Typography component="span" variant="body2" color="text.secondary">
                              {g.bfs_nummer}
                            </Typography>
                          </Typography>
                        }
                      />
                    ))}
                  </Box>
                </>
              )}
            </Stack>
          </Paper>
        )
      })}
    </Stack>
  )
}
