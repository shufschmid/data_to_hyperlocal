'use client'

import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { GemeindeFelder } from '@/graphql/redaktion'
import { vorgeschlagenesJahr } from '@/lib/entsorgung'

// Registering a printed waste calendar.
//
// Two ways in, and both are deliberate. The address of the PDF is the better
// one — it stays in the record, becomes the link at the bottom of every
// reminder, and lets the file be fetched again — but plenty of municipalities
// only hand the calendar out on paper or by mail, so the file itself has to be
// possible too. What is NOT possible is the system going looking: 87
// municipalities are 87 unrelated websites, and guessing at them is how a
// newsroom tool turns into a nuisance for the people running those sites.

/** Directus accepts 15 MB; base64 inside JSON is a third larger than the file. */
const MAX_BYTES = 10 * 1024 * 1024

export interface KalenderErfassenProps {
  gemeinden: readonly GemeindeFelder[]
  onAnlegen: (eingabe: {
    gemeinde: string
    jahr: number
    url?: string
    datei?: { name: string; base64: string }
    zone?: string
    zusatz?: string
  }) => Promise<void>
  laeuft?: boolean
  /** Injected in tests; the suggested year depends on the month. */
  jetzt?: Date
}

export function KalenderErfassen({ gemeinden, onAnlegen, laeuft = false, jetzt }: KalenderErfassenProps) {
  const heute = jetzt ?? new Date()
  const [offen, setOffen] = useState(false)
  const [gemeinde, setGemeinde] = useState('')
  const [jahr, setJahr] = useState(String(vorgeschlagenesJahr(heute)))
  const [url, setUrl] = useState('')
  const [datei, setDatei] = useState<{ name: string; base64: string } | null>(null)
  const [zone, setZone] = useState('')
  const [zusatz, setZusatz] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [erfolg, setErfolg] = useState<string | null>(null)
  const [sendet, setSendet] = useState(false)

  const aktive = gemeinden.filter((g) => g.aktiv)

  async function dateiLesen(eingabe: File): Promise<void> {
    setFehler(null)
    if (eingabe.size > MAX_BYTES) {
      setFehler('Die Datei ist groesser als 10 MB. Erfassen Sie das PDF bitte als Link.')
      setDatei(null)
      return
    }
    const roh = await new Promise<string>((fertig, gescheitert) => {
      const leser = new FileReader()
      leser.onload = () => fertig(String(leser.result))
      leser.onerror = () => gescheitert(new Error('Datei nicht lesbar'))
      leser.readAsDataURL(eingabe)
    })
    setDatei({ name: eingabe.name, base64: roh.slice(roh.indexOf(',') + 1) })
  }

  async function absenden(): Promise<void> {
    setFehler(null)
    setErfolg(null)

    if (gemeinde === '') {
      setFehler('Waehlen Sie eine Gemeinde.')
      return
    }
    const jahrZahl = Number(jahr)
    if (!Number.isInteger(jahrZahl) || jahrZahl < 2000 || jahrZahl > 2100) {
      setFehler('Das Jahr ist unplausibel.')
      return
    }
    if (url.trim() === '' && datei === null) {
      setFehler('Erfassen Sie den Kalender als Link oder als Datei.')
      return
    }

    setSendet(true)
    try {
      await onAnlegen({
        gemeinde,
        jahr: jahrZahl,
        ...(url.trim() === '' ? {} : { url: url.trim() }),
        ...(datei === null ? {} : { datei }),
        ...(zone.trim() === '' ? {} : { zone: zone.trim() }),
        ...(zusatz.trim() === '' ? {} : { zusatz: zusatz.trim() })
      })
      const name = aktive.find((g) => g.id === gemeinde)?.name ?? 'Gemeinde'
      setErfolg(`Abfuhrkalender ${jahrZahl} fuer ${name} erfasst.`)
      setUrl('')
      setDatei(null)
    } catch (error) {
      setFehler(error instanceof Error ? error.message : 'Das hat nicht geklappt.')
    } finally {
      setSendet(false)
    }
  }

  if (!offen) {
    return (
      <Box>
        <Button size="small" onClick={() => setOffen(true)}>
          Abfuhrkalender erfassen
        </Button>
      </Box>
    )
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Der gedruckte Kalender gilt. Erfassen Sie die Adresse des PDF, oder laden Sie die Datei hoch, wenn
          es keine gibt. Danach wird das PDF ausgelesen und die Termine werden zur Bestaetigung vorgelegt.
        </Typography>

        {erfolg !== null && (
          <Alert severity="success" onClose={() => setErfolg(null)}>
            {erfolg}
          </Alert>
        )}
        {fehler !== null && (
          <Alert severity="error" onClose={() => setFehler(null)}>
            {fehler}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Gemeinde"
            value={gemeinde}
            onChange={(e) => setGemeinde(e.target.value)}
            size="small"
            sx={{ minWidth: 220 }}
            disabled={sendet}
          >
            {aktive.map((g) => (
              <MenuItem key={g.id} value={g.id}>
                {g.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Jahr"
            value={jahr}
            onChange={(e) => setJahr(e.target.value)}
            size="small"
            sx={{ width: 120 }}
            disabled={sendet}
          />
        </Stack>

        <TextField
          label="Adresse des PDF"
          placeholder="https://www.gemeinde.ch/abfuhrkalender-2026.pdf"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          size="small"
          disabled={sendet}
          helperText="Bevorzugt: die Adresse steht als Quelle unter jeder Erinnerung."
        />

        <Box>
          <Button component="label" size="small" disabled={sendet}>
            {datei === null ? 'Stattdessen Datei waehlen' : `Datei: ${datei.name}`}
            <input
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => {
                const gewaehlt = e.target.files?.[0]
                if (gewaehlt !== undefined) void dateiLesen(gewaehlt)
              }}
            />
          </Button>
        </Box>

        {/* Municipalities like Riehen print one PDF per zone. Registering the
            same Gemeinde and year with another zone joins the existing
            calendar instead of competing with it. */}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Zone (optional)"
            placeholder="Zone 1"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            size="small"
            sx={{ width: 180 }}
            disabled={sendet}
            helperText="Nur wenn die Gemeinde je Zone ein eigenes PDF druckt."
          />
          <TextField
            label="Hinweis zur Zone (optional)"
            placeholder="Umfasst auch die Gemeinde Bettingen (BS)."
            value={zusatz}
            onChange={(e) => setZusatz(e.target.value)}
            size="small"
            sx={{ flexGrow: 1 }}
            disabled={sendet}
            helperText="Steht als Faktum in jeder Erinnerung dieser Zone."
          />
        </Stack>

        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            size="small"
            onClick={() => void absenden()}
            disabled={sendet || laeuft}
          >
            Erfassen
          </Button>
          <Button size="small" onClick={() => setOffen(false)} disabled={sendet}>
            Schliessen
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}
