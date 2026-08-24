'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputAdornment from '@mui/material/InputAdornment'
import Paper from '@mui/material/Paper'
import SearchIcon from '@mui/icons-material/Search'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { GemeindeFelder, VereinFelder } from '@/graphql/redaktion'
import { filterGemeinden, vereineNachGemeinde } from '@/lib/redaktion'

// Which municipalities get an article, and which clubs speak for them.
//
// It lives here rather than only in the Directus admin because it is an
// editorial decision, not a database chore — and because the consequence is
// immediate: one more municipality is one more paid call on every run. The
// count sits next to the switches for exactly that reason.
//
// Clubs are read-only here on purpose. Adding one is still a Directus admin
// job: once a connector starts proposing clubs, what this list needs is a
// confirm/reject affordance rather than a blank form, and building the form
// twice would be waste.

export interface GemeindenAuswahlProps {
  gemeinden: readonly GemeindeFelder[]
  vereine?: readonly VereinFelder[]
  onUmschalten: (id: string, aktiv: boolean) => Promise<void>
  laeuft?: boolean
}

export function GemeindenAuswahl({
  gemeinden,
  vereine = [],
  onUmschalten,
  laeuft = false
}: GemeindenAuswahlProps) {
  const [suche, setSuche] = useState('')
  const [nurAktive, setNurAktive] = useState(false)

  const sichtbar = useMemo(() => filterGemeinden(gemeinden, suche, nurAktive), [gemeinden, suche, nurAktive])
  const nachGemeinde = useMemo(() => vereineNachGemeinde(vereine), [vereine])
  const aktiv = gemeinden.filter((g) => g.aktiv).length

  return (
    <Stack spacing={2}>
      <Alert severity={aktiv === 0 ? 'warning' : 'info'}>
        {aktiv === 0
          ? 'Keine Gemeinde ausgewählt — ein Lauf würde keine Meldung erzeugen.'
          : `${aktiv} von ${gemeinden.length} Gemeinden werden bespielt. Jede zusätzliche Gemeinde ist eine weitere Meldung pro Lauf.`}
      </Alert>

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          size="small"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder="Gemeinde, Bezirk oder BFS-Nummer"
          label="Suche"
          sx={{ flex: '1 1 260px' }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              )
            }
          }}
        />
        <FormControlLabel
          control={
            <Switch size="small" checked={nurAktive} onChange={(e) => setNurAktive(e.target.checked)} />
          }
          label="Nur aktive"
        />
      </Stack>

      {sichtbar.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Keine Gemeinde gefunden.
        </Typography>
      ) : (
        <Paper sx={{ p: 1 }}>
          <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
            {sichtbar.map((gemeinde) => {
              const clubs = nachGemeinde.get(gemeinde.id) ?? []

              return (
                <Box key={gemeinde.id} sx={{ py: 0.5, px: 1 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={gemeinde.aktiv}
                          disabled={laeuft}
                          onChange={(e) => void onUmschalten(gemeinde.id, e.target.checked)}
                        />
                      }
                      label={
                        <Typography variant="body2" component="span">
                          {gemeinde.name}{' '}
                          <Typography component="span" variant="body2" color="text.secondary">
                            {gemeinde.bfs_nummer} · {gemeinde.bezirk}
                          </Typography>
                        </Typography>
                      }
                    />
                    {clubs.length > 0 && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${clubs.length} ${clubs.length === 1 ? 'Verein' : 'Vereine'}`}
                      />
                    )}
                  </Stack>

                  {/* Only for municipalities actually covered: an inactive one
                      cannot produce a report, so its clubs are noise here. */}
                  {gemeinde.aktiv && clubs.length > 0 && (
                    <Stack spacing={0.25} sx={{ pl: 6, pb: 0.5 }}>
                      {clubs.map((verein) => (
                        <Stack
                          key={verein.id}
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}
                        >
                          <Typography variant="body2">
                            {verein.bedeutung === 'aushaengeschild' ? '★' : '·'} {verein.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {verein.sportart}
                            {verein.liga === null ? '' : ` · ${verein.liga}`}
                          </Typography>
                          {!verein.zuordnung_geprueft && (
                            <Chip size="small" color="warning" label="vorgeschlagen" />
                          )}
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Box>
              )
            })}
          </Stack>
        </Paper>
      )}
    </Stack>
  )
}
