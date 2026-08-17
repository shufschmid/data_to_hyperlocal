'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SpielFelder } from '@/graphql/redaktion'
import { formatiereZeitpunkt, resultat, teileSpiele } from '@/lib/redaktion'

// Results and fixtures of the clubs the newsroom follows.
//
// The counterpart to the statistics feed: same idea, a source that publishes on
// its own schedule, watched daily. What differs is the shape — a statistic
// arrives once a year for every municipality at once, a match arrives every
// weekend for one club.
//
// Read-only. The connector writes these rows; nothing here edits them.

const ALLE = '__alle__'

export interface SportresultateProps {
  spiele: readonly SpielFelder[]
  laedt?: boolean
  /** The clock that separates played from upcoming. Injected by tests. */
  jetzt?: Date
}

export function Sportresultate({ spiele, laedt = false, jetzt }: SportresultateProps) {
  const [gemeinde, setGemeinde] = useState(ALLE)
  const [sportart, setSportart] = useState(ALLE)

  // Options come from the data, not a fixed list: a sport shows up here the
  // moment its first match is recorded.
  const gemeinden = useMemo(() => {
    const namen = new Map<string, string>()
    for (const spiel of spiele) {
      if (spiel.gemeinde !== null) namen.set(spiel.gemeinde.id, spiel.gemeinde.name)
    }
    return [...namen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'de-CH'))
  }, [spiele])

  const sportarten = useMemo(
    () => [...new Set(spiele.map((s) => s.sportart))].sort((a, b) => a.localeCompare(b, 'de-CH')),
    [spiele]
  )

  const gefiltert = useMemo(
    () =>
      spiele.filter(
        (spiel) =>
          (gemeinde === ALLE || spiel.gemeinde?.id === gemeinde) &&
          (sportart === ALLE || spiel.sportart === sportart)
      ),
    [spiele, gemeinde, sportart]
  )

  const { vergangen, kommend } = useMemo(
    () => teileSpiele(gefiltert, jetzt ?? new Date()),
    [gefiltert, jetzt]
  )

  return (
    <Stack spacing={2}>
      {spiele.length === 0 && !laedt && (
        <Alert severity="info">
          Noch keine Spiele erfasst. Der Lauf „Sportresultate holen“ trägt sie ein, sobald der Verband die
          nächsten Begegnungen aufschaltet.
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Gemeinde"
          value={gemeinde}
          onChange={(e) => setGemeinde(e.target.value)}
          sx={{ minWidth: 190 }}
        >
          <MenuItem value={ALLE}>Alle Gemeinden</MenuItem>
          {gemeinden.map(([id, name]) => (
            <MenuItem key={id} value={id}>
              {name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Sportart"
          value={sportart}
          onChange={(e) => setSportart(e.target.value)}
          sx={{ minWidth: 190 }}
        >
          <MenuItem value={ALLE}>Alle Sportarten</MenuItem>
          {sportarten.map((art) => (
            <MenuItem key={art} value={art}>
              {art}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <SpielListe titel="Resultate" spiele={vergangen} leer="Noch keine gespielten Begegnungen." />
      <SpielListe titel="Kommende Begegnungen" spiele={kommend} leer="Zurzeit sind keine Spiele angesetzt." />
    </Stack>
  )
}

function SpielListe({
  titel,
  spiele,
  leer
}: {
  titel: string
  spiele: readonly SpielFelder[]
  leer: string
}) {
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="h3" component="h3" sx={{ fontSize: '1rem' }}>
          {titel}
        </Typography>
        <Chip size="small" label={spiele.length} />
      </Stack>

      {spiele.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {leer}
        </Typography>
      ) : (
        <Paper sx={{ p: 1 }}>
          <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
            {spiele.map((spiel) => (
              <SpielZeile key={spiel.id} spiel={spiel} />
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  )
}

function SpielZeile({ spiel }: { spiel: SpielFelder }) {
  const offen = spiel.tore_heim === null || spiel.tore_gast === null

  return (
    <Box sx={{ py: 0.75, px: 1 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {spiel.heim} — {spiel.gast}
        </Typography>
        <Typography
          variant="body2"
          sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: offen ? 400 : 700 }}
          color={offen ? 'text.secondary' : 'text.primary'}
        >
          {resultat(spiel.tore_heim, spiel.tore_gast)}
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          {formatiereZeitpunkt(spiel.datum)}
          {spiel.gemeinde === null ? '' : ` · ${spiel.gemeinde.name}`} · {spiel.wettbewerb}
          {spiel.ort === null ? '' : ` · ${spiel.ort}`}
        </Typography>
        {spiel.status !== null && <Chip size="small" color="warning" label={spiel.status} />}
      </Stack>
    </Box>
  )
}
