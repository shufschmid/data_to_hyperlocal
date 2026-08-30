'use client'

import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import type { VereinFelder } from '@/graphql/redaktion'

// Erfassen und Bearbeiten eines Vereins — ein Formular fuer beides.
//
// Die Quellenwahl ist der Teil, der Aufmerksamkeit verdient: drei der fuenf
// Quellen haben einen Leser, und zwei davon fragen PRO MANNSCHAFT genau die
// hinterlegte Adresse ab. Fehlt sie dort, ueberspringt der Morgenlauf den
// Verein mit einer Logzeile, die niemand liest — der Verein sieht erfasst aus
// und bleibt fuer immer still. Deshalb sagt das Formular es hier, und der
// Endpoint prueft es noch einmal.

const SPORTARTEN = [
  'Fussball',
  'Handball',
  'Volleyball',
  'Basketball',
  'Unihockey',
  'Eishockey',
  'Schwimmen',
  'Leichtathletik',
  'Turnen',
  'Schach',
  'Schwingen',
  'Anderer'
]

const QUELLEN: { wert: string; text: string }[] = [
  { wert: 'manuell', text: 'manuell — keine automatischen Resultate' },
  { wert: 'fvnws', text: 'fvnws (Fussball) — eine Seite für alle Vereine' },
  { wert: 'swissvolley', text: 'swissvolley — Adresse pro Mannschaft nötig' },
  { wert: 'handball', text: 'handball — Adresse pro Mannschaft nötig' },
  { wert: 'swissunihockey', text: 'swissunihockey — noch kein Leser' }
]

const BRAUCHT_URL = new Set(['swissvolley', 'handball'])

export interface VereinFormular {
  name: string
  sportart: string
  bedeutung: string
  quelle: string
  ergebnis_url: string
  liga: string
  spielort: string
  notiz: string
  aktiv: boolean
}

const LEER: VereinFormular = {
  name: '',
  sportart: 'Fussball',
  bedeutung: 'breitensport',
  quelle: 'manuell',
  ergebnis_url: '',
  liga: '',
  spielort: '',
  notiz: '',
  aktiv: true
}

export interface VereinDialogProps {
  offen: boolean
  gemeindeName: string
  /** Gesetzt beim Bearbeiten, null beim Erfassen. */
  verein?: VereinFelder | null
  laeuft?: boolean
  onSchliessen: () => void
  onSpeichern: (eingabe: VereinFormular, vereinId: string | null) => Promise<void>
}

export function VereinDialog({
  offen,
  gemeindeName,
  verein = null,
  laeuft = false,
  onSchliessen,
  onSpeichern
}: VereinDialogProps) {
  const [werte, setWerte] = useState<VereinFormular>(LEER)

  useEffect(() => {
    if (!offen) return
    setWerte(
      verein === null
        ? LEER
        : {
            name: verein.name,
            sportart: verein.sportart,
            bedeutung: verein.bedeutung,
            quelle: verein.quelle ?? 'manuell',
            ergebnis_url: verein.ergebnis_url ?? '',
            liga: verein.liga ?? '',
            spielort: verein.spielort ?? '',
            notiz: verein.notiz ?? '',
            aktiv: verein.aktiv
          }
    )
  }, [offen, verein])

  function setze<K extends keyof VereinFormular>(feld: K, wert: VereinFormular[K]): void {
    setWerte((alt) => ({ ...alt, [feld]: wert }))
  }

  const urlFehlt = BRAUCHT_URL.has(werte.quelle) && werte.ergebnis_url.trim() === ''
  const bereit = werte.name.trim() !== '' && !urlFehlt

  return (
    <Dialog open={offen} onClose={onSchliessen} fullWidth maxWidth="sm">
      <DialogTitle>
        {verein === null ? `Verein erfassen — ${gemeindeName}` : `${verein.name} bearbeiten`}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Name"
            size="small"
            value={werte.name}
            onChange={(e) => setze('name', e.target.value)}
          />

          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Sportart"
              size="small"
              value={werte.sportart}
              onChange={(e) => setze('sportart', e.target.value)}
              sx={{ flex: 1 }}
            >
              {SPORTARTEN.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Bedeutung"
              size="small"
              value={werte.bedeutung}
              onChange={(e) => setze('bedeutung', e.target.value)}
              helperText="Aushängeschild trägt über die Gemeinde hinaus"
              sx={{ flex: 1 }}
            >
              <MenuItem value="aushaengeschild">Aushängeschild</MenuItem>
              <MenuItem value="breitensport">Breitensport</MenuItem>
            </TextField>
          </Stack>

          <TextField
            select
            label="Resultat-Quelle"
            size="small"
            value={werte.quelle}
            onChange={(e) => setze('quelle', e.target.value)}
          >
            {QUELLEN.map((q) => (
              <MenuItem key={q.wert} value={q.wert}>
                {q.text}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Ergebnis-Adresse"
            size="small"
            value={werte.ergebnis_url}
            onChange={(e) => setze('ergebnis_url', e.target.value)}
            placeholder="https://…"
            error={urlFehlt}
            helperText={
              urlFehlt
                ? 'Diese Quelle wird pro Mannschaft abgefragt — ohne Adresse bleibt der Verein still.'
                : 'Bei fvnws optional: nur nötig, um ein fehlendes Resultat nachzutragen.'
            }
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label="Liga"
              size="small"
              value={werte.liga}
              onChange={(e) => setze('liga', e.target.value)}
              helperText="Momentaufnahme, wechselt je Saison"
              sx={{ flex: 1 }}
            />
            <TextField
              label="Spielort"
              size="small"
              value={werte.spielort}
              onChange={(e) => setze('spielort', e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>

          <TextField
            label="Notiz für die Redaktion"
            size="small"
            multiline
            minRows={2}
            value={werte.notiz}
            onChange={(e) => setze('notiz', e.target.value)}
            helperText="Warum der Verein für die Gemeinde zählt — fliesst in die Spielberichte ein."
          />

          <FormControlLabel
            control={
              <Switch size="small" checked={werte.aktiv} onChange={(e) => setze('aktiv', e.target.checked)} />
            }
            label="Wird bespielt"
          />

          {werte.quelle === 'swissunihockey' && (
            <Alert severity="info">
              Für diese Quelle gibt es noch keinen Leser — der Verein wird erfasst, aber es werden keine
              Resultate geholt.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onSchliessen}>Abbrechen</Button>
        <Button
          variant="contained"
          disabled={laeuft || !bereit}
          onClick={() => void onSpeichern(werte, verein?.id ?? null)}
        >
          {verein === null ? 'Erfassen' : 'Speichern'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
