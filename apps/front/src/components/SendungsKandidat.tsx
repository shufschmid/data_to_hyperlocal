'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CampaignOutlined from '@mui/icons-material/CampaignOutlined'
import type { AlleMeldungFelder, SendungskandidatFelder } from '@/graphql/redaktion'
import { ABLEHNUNGSGRUENDE, zeitText } from '@/lib/sendungen'
import { MeldungKarte, type MeldungAktion } from './MeldungKarte'

export interface SendungsKandidatProps {
  kandidat: SendungskandidatFelder
  meldung?: AlleMeldungFelder | undefined
  laeuft?: boolean
  onMeldung?: (id: string) => Promise<void> | void
  onAblehnen?: (id: string, grund: string, kommentar: string | null) => Promise<void> | void
  onWeiterreichen?: (id: string, begruendung: string | null) => Promise<void> | void
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion) => Promise<void>
}

/**
 * The municipality half of a broadcast contribution.
 *
 * Deliberately a block ON the contribution's card rather than a desk of its
 * own: not everyone who reviews these shows is responsible for municipality
 * news, so the review stays exactly as it was ported and this sits inside it,
 * visibly marked off. Where a Meldung already exists it is edited right here —
 * the same rule the gazette desk learned the hard way.
 */
export function SendungsKandidat({
  kandidat,
  meldung,
  laeuft = false,
  onMeldung,
  onAblehnen,
  onWeiterreichen,
  onChat,
  onAktion
}: SendungsKandidatProps) {
  const [ablehnung, setAblehnung] = useState(false)
  const [grund, setGrund] = useState('nicht_relevant')
  const [kommentar, setKommentar] = useState('')

  return (
    <Box
      sx={{
        mt: 2,
        p: 2,
        borderRadius: 2,
        // Die farbliche Hervorhebung: der Beitrag sieht sonst aus wie jeder
        // andere, und genau das ist ja der Punkt der Durchsicht.
        border: 2,
        borderColor: 'warning.main',
        bgcolor: 'warning.main',
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.92), rgba(255,255,255,0.92))'
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
        <CampaignOutlined fontSize="small" color="warning" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Vorschlag für {kandidat.gemeinde?.name ?? 'eine Gemeinde'}
        </Typography>
        {kandidat.zeitmarke_sekunden !== null && (
          <Chip size="small" variant="outlined" label={`ab ${zeitText(kandidat.zeitmarke_sekunden)}`} />
        )}
      </Stack>

      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {kandidat.titel}
      </Typography>
      {kandidat.begruendung !== null && (
        <Typography variant="body2" sx={{ fontStyle: 'italic', mb: 1 }}>
          {kandidat.begruendung}
        </Typography>
      )}

      {meldung !== undefined ? (
        <Box sx={{ mt: 1.5 }}>
          <MeldungKarte
            meldung={meldung}
            onChat={onChat ?? (async () => {})}
            onAktion={onAktion ?? (async () => {})}
            laeuft={laeuft}
          />
        </Box>
      ) : (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
          <Button
            size="small"
            variant="contained"
            disabled={laeuft}
            onClick={() => void onMeldung?.(kandidat.id)}
          >
            Meldung schreiben
          </Button>
          <Button size="small" disabled={laeuft} onClick={() => setAblehnung(true)}>
            Ablehnen
          </Button>
          <Button size="small" disabled={laeuft} onClick={() => void onWeiterreichen?.(kandidat.id, null)}>
            An Chefredaktion
          </Button>
        </Stack>
      )}

      <Dialog open={ablehnung} onClose={() => setAblehnung(false)} fullWidth maxWidth="sm">
        <DialogTitle>Vorschlag ablehnen</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {kandidat.titel}
            </Typography>
            {/* Der Grund ist das Lernsignal — „nur am Rand erwähnt" ist der,
                der die nächste Sichtung genau die Unterscheidung lehrt, um die
                der Prompt sie bittet. */}
            <TextField select label="Grund" value={grund} onChange={(e) => setGrund(e.target.value)}>
              {ABLEHNUNGSGRUENDE.map((g) => (
                <MenuItem key={g.wert} value={g.wert}>
                  {g.text}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Kommentar"
              value={kommentar}
              onChange={(e) => setKommentar(e.target.value)}
              multiline
              minRows={2}
              helperText="Wird der nächsten Sichtung als Beispiel mitgegeben."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAblehnung(false)}>Abbrechen</Button>
          <Button
            variant="contained"
            onClick={() => {
              setAblehnung(false)
              void onAblehnen?.(kandidat.id, grund, kommentar.trim() === '' ? null : kommentar.trim())
            }}
          >
            Ablehnen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
