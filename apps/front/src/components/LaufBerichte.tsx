'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { AlleMeldungFelder, MeldungFelder } from '@/graphql/redaktion'
import { fortschritt, laufStatusText } from '@/lib/redaktion'
import { MeldungKarte, type MeldungAktion } from './MeldungKarte'

// Die Berichte zu einem Datensatz, direkt unter seinem Eintrag.
//
// Sie standen frueher in einem eigenen Reiter, den man erst ansteuern musste,
// um zu sehen, ob ueberhaupt etwas geschrieben wurde. Jetzt sagt die Zeile
// selbst, dass Berichte da sind, und klappt sie auf Wunsch auf — zugeklappt,
// weil ein Lauf sieben Meldungen hat und die Zeitleiste sonst nicht mehr
// lesbar waere.
//
// Beide Ebenen von Eingriffen bleiben erhalten: eine Anweisung an alle Berichte
// desselben Datensatzes, und je Bericht die einzelne Entscheidung.

export interface LaufBerichteProps {
  meldungen: readonly AlleMeldungFelder[]
  /** Status des Laufs, fuer die Fortschrittszeile. */
  laufStatus?: string | null
  laeuft?: boolean
  onStapelChat: (anweisung: string) => Promise<void>
  onStapelAktion: (aktion: 'pruefung' | 'publizieren') => Promise<void>
  onChat: (id: string, anweisung: string) => Promise<void>
  onAktion: (id: string, aktion: MeldungAktion) => Promise<void>
}

export function LaufBerichte({
  meldungen,
  laufStatus = null,
  laeuft = false,
  onStapelChat,
  onStapelAktion,
  onChat,
  onAktion
}: LaufBerichteProps) {
  const [offen, setOffen] = useState(false)
  const [anweisung, setAnweisung] = useState('')

  if (meldungen.length === 0) return null

  // `fortschritt` erwartet die Statistik-Form; die gemeinsame Abfrage liefert
  // dieselben Felder plus zwei weitere.
  const stand = fortschritt(meldungen as unknown as MeldungFelder[])
  const publiziert = meldungen.filter((m) => m.status === 'publiziert').length

  return (
    <Box sx={{ mt: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          size="small"
          onClick={() => setOffen(!offen)}
          startIcon={
            <ExpandMoreIcon
              sx={{ transform: offen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
            />
          }
          aria-expanded={offen}
        >
          {meldungen.length === 1 ? '1 Bericht' : `${meldungen.length} Berichte`}
        </Button>

        {publiziert > 0 && <Chip size="small" color="success" label={`${publiziert} publiziert`} />}
        {laufStatus !== null && laufStatus !== 'bereit' && (
          <Chip size="small" variant="outlined" label={laufStatusText(laufStatus)} />
        )}
        {stand.gesamt > 0 && stand.fertig < stand.gesamt && (
          <Typography variant="caption" color="text.secondary">
            {stand.fertig} von {stand.gesamt} fertig
          </Typography>
        )}
      </Stack>

      {/* Kein <Collapse>: der misst seine Hoehe im Grid der Zeitleisten-Zeile
          falsch und clippt den Inhalt auf die eingeklappte Hoehe — der Text
          wirkte abgeschnitten. Bedingtes Rendern kann nicht clippen. */}
      {offen && (
        <Stack spacing={2} sx={{ pt: 1, pl: 1, borderLeft: 3, borderColor: 'divider' }}>
          <Stack spacing={1}>
            <TextField
              label="Anweisung an alle Berichte dieses Datensatzes"
              size="small"
              multiline
              minRows={2}
              value={anweisung}
              onChange={(e) => setAnweisung(e.target.value)}
              disabled={laeuft}
            />
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Button
                variant="contained"
                size="small"
                disabled={laeuft || anweisung.trim() === ''}
                onClick={() => void onStapelChat(anweisung.trim()).then(() => setAnweisung(''))}
              >
                Auf alle anwenden
              </Button>
              <Button size="small" disabled={laeuft} onClick={() => void onStapelAktion('pruefung')}>
                Alle gegenlesen lassen
              </Button>
              <Button size="small" disabled={laeuft} onClick={() => void onStapelAktion('publizieren')}>
                Alle publizieren
              </Button>
            </Stack>
          </Stack>

          <Divider />

          {meldungen.map((m) => (
            <MeldungKarte
              key={m.id}
              meldung={m as unknown as MeldungFelder}
              laeuft={laeuft}
              onChat={onChat}
              onAktion={onAktion}
            />
          ))}
        </Stack>
      )}
    </Box>
  )
}
