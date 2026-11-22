'use client'

import { useMemo, useState } from 'react'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { GemeindeFelder, WochenblattFelder } from '@/graphql/redaktion'

// Ein Wochenblatt erfassen — Einstellung, nicht Tischarbeit.
//
// Bis zum 22. November 2026 stand dieses Formular zuoberst auf dem
// Wochenblätter-Tisch. Ein Blatt wird einmal erfasst und dann jeden Morgen
// gelesen; auf dem Tisch nahm es jeden Tag Platz weg. Es liegt darum hinter
// dem Zahnrad bei den Gemeinden, wo auch die Zuordnung eines Blatts zu seinen
// Gemeinden geändert wird. «Auf neue Ausgaben prüfen» bleibt auf dem Tisch.

export interface WochenblattErfassenProps {
  blaetter: readonly Pick<WochenblattFelder, 'gemeinde' | 'abdeckungen'>[]
  gemeinden: readonly GemeindeFelder[]
  laeuft?: boolean
  onAnlegen: (eingabe: { gemeinden: string[]; name: string; archiv_url: string }) => Promise<void>
}

export function WochenblattErfassen({
  blaetter,
  gemeinden,
  laeuft = false,
  onAnlegen
}: WochenblattErfassenProps) {
  const [gewaehlteGemeinden, setGewaehlteGemeinden] = useState<string[]>([])
  const [name, setName] = useState('')
  const [archivUrl, setArchivUrl] = useState('')

  // A municipality already covered by some paper is not offered again.
  const freieGemeinden = useMemo(() => {
    const belegt = new Set<string | undefined>()
    for (const blatt of blaetter) {
      belegt.add(blatt.gemeinde?.id)
      for (const a of blatt.abdeckungen) belegt.add(a.gemeinde?.id)
    }
    return gemeinden.filter((g) => !belegt.has(g.id))
  }, [blaetter, gemeinden])

  async function anlegen() {
    await onAnlegen({
      gemeinden: gewaehlteGemeinden,
      name: name.trim(),
      archiv_url: archivUrl.trim()
    })
    setGewaehlteGemeinden([])
    setName('')
    setArchivUrl('')
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="subtitle2">Wochenblatt erfassen</Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <TextField
            select
            label="Gemeinden"
            size="small"
            value={gewaehlteGemeinden}
            onChange={(e) => {
              const wert = e.target.value
              setGewaehlteGemeinden(Array.isArray(wert) ? wert : [wert])
            }}
            helperText="Mehrfachwahl: der Anzeiger zweier Gemeinden traegt beide."
            slotProps={{ select: { multiple: true } }}
            sx={{ minWidth: 200 }}
          >
            {freieGemeinden.map((g) => (
              <MenuItem key={g.id} value={g.id}>
                {g.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Name des Blatts"
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ minWidth: 220 }}
          />
          <TextField
            label="Archiv-Adresse"
            size="small"
            value={archivUrl}
            onChange={(e) => setArchivUrl(e.target.value)}
            placeholder="https://…/archiv/"
            sx={{ minWidth: 280, flexGrow: 1 }}
          />
          <Button
            variant="contained"
            size="small"
            onClick={() => void anlegen()}
            disabled={
              laeuft ||
              gewaehlteGemeinden.length === 0 ||
              name.trim() === '' ||
              !/^https?:\/\//.test(archivUrl.trim())
            }
          >
            Erfassen
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Beim Erfassen wird die aktuellste Ausgabe geholt, alles Ältere bleibt liegen. Danach liest der Lauf
          das Blatt täglich um 9 Uhr; die Kandidaten stehen auf dem Tisch «Wochenblätter».
        </Typography>
      </Stack>
    </Paper>
  )
}
