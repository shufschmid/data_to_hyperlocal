'use client'

import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { MeldungFelder } from '@/graphql/redaktion'
import { absaetze, statusFarbe, statusText, warnungen } from '@/lib/redaktion'
import { langesDatum } from '@/lib/entsorgung'

// One article. Presentational: props in, callbacks out, so it can be tested
// without a network or a router.

export type MeldungAktion = 'publizieren' | 'pruefung' | 'verwerfen' | 'freigeben'

export interface MeldungKarteProps {
  meldung: MeldungFelder
  onChat: (id: string, anweisung: string) => Promise<void>
  onAktion: (id: string, aktion: MeldungAktion) => Promise<void>
  laeuft?: boolean
  /**
   * The newsletter day of a waste-collection reminder.
   *
   * When set, the card approves instead of publishing: the reminder is written
   * weeks ahead and has to go out on one specific day, so the scheduled run
   * publishes it the evening before. Publishing it by hand now would put "am
   * Freitag ist Papierabfuhr" in front of readers in September.
   */
  erscheintAm?: string | null
  /**
   * Publishing a press review is also the Perle decision. When set, the card
   * offers both ways out — "als Perle" for the curious story the city wants
   * too, plain publishing otherwise. Unpublished stays no Perle, always.
   */
  onPerlePublizieren?: (id: string, perle: boolean) => Promise<void>
}

export function MeldungKarte({
  meldung,
  onChat,
  onAktion,
  laeuft = false,
  erscheintAm = null,
  onPerlePublizieren
}: MeldungKarteProps) {
  const [anweisung, setAnweisung] = useState('')
  const [offen, setOffen] = useState(false)
  const [sendet, setSendet] = useState(false)

  const beschaeftigt = laeuft || meldung.verarbeitung === 'geplant' || meldung.verarbeitung === 'laeuft'
  const hinweise = warnungen(meldung)

  async function schicken() {
    if (anweisung.trim() === '') return
    setSendet(true)
    try {
      await onChat(meldung.id, anweisung.trim())
      setAnweisung('')
      setOffen(false)
    } finally {
      setSendet(false)
    }
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h2" component="h2" sx={{ fontSize: '1.1rem' }}>
            {meldung.gemeinde?.name ?? 'Ohne Gemeinde'}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {beschaeftigt && <CircularProgress size={16} />}
            <Chip size="small" label={statusText(meldung.status)} color={statusFarbe(meldung.status)} />
          </Stack>
        </Stack>

        {/* Warnings sit above the text, because the point of them is to be seen
            before the article is judged. */}
        {hinweise.length > 0 && (
          <Alert severity="warning">
            {hinweise.map((h, i) => (
              <Box key={i}>{h}</Box>
            ))}
          </Alert>
        )}

        {meldung.titel === null ? (
          <Typography variant="body2" color="text.secondary">
            Wird geschrieben …
          </Typography>
        ) : (
          <>
            <Typography variant="h3" component="h3" sx={{ fontSize: '1rem', fontWeight: 700 }}>
              {meldung.titel}
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 500 }}>
              {meldung.lead}
            </Typography>
            {absaetze(meldung.text).map((a, i) => (
              <Typography key={i} variant="body2">
                {a}
              </Typography>
            ))}
          </>
        )}

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button size="small" onClick={() => setOffen((o) => !o)} disabled={beschaeftigt}>
            Überarbeiten
          </Button>
          <Button
            size="small"
            onClick={() => void onAktion(meldung.id, 'pruefung')}
            disabled={beschaeftigt || meldung.titel === null}
          >
            Gegenlesen lassen
          </Button>
          {erscheintAm === null ? (
            onPerlePublizieren !== undefined ? (
              <>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => void onPerlePublizieren(meldung.id, true)}
                  disabled={beschaeftigt || meldung.titel === null}
                >
                  Als Perle publizieren
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="inherit"
                  onClick={() => void onPerlePublizieren(meldung.id, false)}
                  disabled={beschaeftigt || meldung.titel === null}
                >
                  Publizieren
                </Button>
              </>
            ) : (
              <Button
                size="small"
                variant="contained"
                onClick={() => void onAktion(meldung.id, 'publizieren')}
                disabled={beschaeftigt || meldung.titel === null}
              >
                Publizieren
              </Button>
            )
          ) : (
            <Button
              size="small"
              variant="contained"
              onClick={() => void onAktion(meldung.id, 'freigeben')}
              disabled={beschaeftigt || meldung.titel === null}
            >
              Freigeben
            </Button>
          )}
          <Button
            size="small"
            color="inherit"
            onClick={() => void onAktion(meldung.id, 'verwerfen')}
            disabled={beschaeftigt}
          >
            Verwerfen
          </Button>
        </Stack>

        {erscheintAm !== null && (
          <Typography variant="caption" color="text.secondary">
            Erscheint am {langesDatum(erscheintAm)} · wird am Vortag automatisch publiziert
          </Typography>
        )}

        {offen && (
          <Stack spacing={1}>
            <TextField
              label="Was soll anders werden?"
              multiline
              minRows={2}
              size="small"
              value={anweisung}
              onChange={(e) => setAnweisung(e.target.value)}
              disabled={sendet}
            />
            <Box>
              <Button
                size="small"
                variant="contained"
                onClick={() => void schicken()}
                disabled={sendet || anweisung.trim() === ''}
              >
                Anweisung schicken
              </Button>
            </Box>
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}
