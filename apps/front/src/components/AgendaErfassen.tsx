'use client'

import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

// Entering an agenda entry by hand.
//
// The fallback for a source we cannot read. It exists because the alternative
// is worse than it looks: a blocked agenda produces no error an editor sees,
// only an absence — and an absence is indistinguishable from "nothing was
// published".
//
// Deliberately the same four fields the parser fills, so a hand-typed row and a
// fetched one are the same kind of thing. The key is derived from the title by
// a hook on every write, so if the fetch works again tomorrow it updates this
// row instead of adding a second one.

export interface AgendaErfassenProps {
  /** Quarters already in use, offered as suggestions. */
  quartale: readonly string[]
  laeuft?: boolean
  onAnlegen: (eintrag: {
    titel: string
    status: string
    datum: string | null
    quartal: string | null
    link: string | null
  }) => Promise<void>
}

export function AgendaErfassen({ quartale, laeuft = false, onAnlegen }: AgendaErfassenProps) {
  const [offen, setOffen] = useState(false)
  const [titel, setTitel] = useState('')
  const [datum, setDatum] = useState('')
  const [quartal, setQuartal] = useState('')
  const [link, setLink] = useState('')
  const [fertig, setFertig] = useState<string | null>(null)

  if (!offen) {
    return (
      <Button size="small" onClick={() => setOffen(true)}>
        Eintrag von Hand erfassen
      </Button>
    )
  }

  async function anlegen() {
    const sauber = titel.trim()
    if (sauber === '') return

    // A date means the statistic is out; without one it is only announced for a
    // quarter. That distinction is the whole point of the agenda, so it is
    // derived here rather than asked as a third question.
    await onAnlegen({
      titel: sauber,
      status: datum === '' ? 'geplant' : 'publiziert',
      datum: datum === '' ? null : datum,
      quartal: quartal === '' ? null : quartal,
      link: link.trim() === '' ? null : link.trim()
    })

    setFertig(sauber)
    setTitel('')
    setDatum('')
    setLink('')
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Für den Fall, dass die Agenda nicht gelesen werden konnte: Titel eintragen, wie er auf der Seite
          steht. Mit Datum gilt der Eintrag als publiziert, ohne Datum als angekündigt.
        </Typography>

        {fertig !== null && (
          <Alert severity="success" onClose={() => setFertig(null)}>
            „{fertig}“ erfasst. Der Datensatz dazu lässt sich über „Auftrag …“ zuordnen.
          </Alert>
        )}

        <TextField
          fullWidth
          size="small"
          required
          label="Titel"
          value={titel}
          onChange={(e) => setTitel(e.target.value)}
          placeholder="Bau- und Wohnbaustatistik 2025"
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            size="small"
            type="date"
            label="Publiziert am"
            value={datum}
            onChange={(e) => setDatum(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ minWidth: '12rem' }}
          />
          <TextField
            select
            size="small"
            label="Quartal"
            value={quartal}
            onChange={(e) => setQuartal(e.target.value)}
            sx={{ minWidth: '16rem' }}
          >
            <MenuItem value="">(keines)</MenuItem>
            {quartale.map((q) => (
              <MenuItem key={q} value={q}>
                {q}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <TextField
          fullWidth
          size="small"
          label="Link zur Publikation"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://www.baselland.ch/…"
        />

        <Stack direction="row" spacing={1}>
          <Button variant="contained" disabled={laeuft || titel.trim() === ''} onClick={() => void anlegen()}>
            Erfassen
          </Button>
          <Button color="inherit" onClick={() => setOffen(false)}>
            Schliessen
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}
