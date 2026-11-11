'use client'

import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import {
  fehlendes,
  koerperAus,
  LEERE_EINGABE,
  MODUS_TEXT,
  type EigeneEingabe,
  type EigeneModus,
  type MeldungErzeugenKoerper
} from '@/lib/eigene'

// Der Knopf „Mit eigenen Angaben" neben „Meldung schreiben" — auf jedem Tisch,
// der eine Meldung aus einer Zeile schreibt — und der Dialog dahinter.
//
// Zwei Wege, die Redaktion waehlt: ANGABEN ERGAENZEN (sie tippt, was die
// Quelle nicht sagt, und die KI schreibt mit beidem) oder SELBST SCHREIBEN
// (Titel, Lead, Text von Hand, kein Modellaufruf). Beides geht an denselben
// Endpunkt wie der gewoehnliche Klick, nur mit Koerper; die Quellenzeile baut
// weiterhin der Code, und auf der Meldung steht, was die Redaktion beitrug.
//
// Ein Knopf samt Dialog in EINER Komponente, damit ein Tisch eine Zeile braucht
// und nicht drei Stuecke Zustand.

export interface EigeneMeldungKnopfProps {
  /** Der Titel der Zeile — damit im Dialog steht, wozu geschrieben wird. */
  titel: string | null
  disabled?: boolean
  /** Dasselbe, was „Meldung schreiben" tut, mit dem Koerper dazu. */
  onAbschicken: (koerper: MeldungErzeugenKoerper) => Promise<void> | void
}

export function EigeneMeldungKnopf({ titel, disabled = false, onAbschicken }: EigeneMeldungKnopfProps) {
  const [offen, setOffen] = useState(false)
  return (
    <>
      <Button size="small" variant="outlined" disabled={disabled} onClick={() => setOffen(true)}>
        Mit eigenen Angaben
      </Button>
      <EigeneMeldungDialog
        offen={offen}
        titel={titel}
        onClose={() => setOffen(false)}
        onAbschicken={async (koerper) => {
          setOffen(false)
          await onAbschicken(koerper)
        }}
      />
    </>
  )
}

export interface EigeneMeldungDialogProps {
  offen: boolean
  titel: string | null
  onClose: () => void
  onAbschicken: (koerper: MeldungErzeugenKoerper) => Promise<void> | void
}

export function EigeneMeldungDialog({ offen, titel, onClose, onAbschicken }: EigeneMeldungDialogProps) {
  const [modus, setModus] = useState<EigeneModus>('ergaenzen')
  const [eingabe, setEingabe] = useState<EigeneEingabe>(LEERE_EINGABE)
  const [versucht, setVersucht] = useState(false)

  const fehlt = fehlendes(modus, eingabe)

  function setze<K extends keyof EigeneEingabe>(feld: K, wert: EigeneEingabe[K]) {
    setEingabe((e) => ({ ...e, [feld]: wert }))
  }

  function abschicken() {
    const koerper = koerperAus(modus, eingabe)
    if (koerper === null) {
      setVersucht(true)
      return
    }
    setVersucht(false)
    setEingabe(LEERE_EINGABE)
    void onAbschicken(koerper)
  }

  return (
    <Dialog open={offen} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Meldung mit eigenen Angaben</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {titel !== null && titel !== '' && (
            <Typography variant="body2" color="text.secondary">
              {titel}
            </Typography>
          )}
          <ToggleButtonGroup
            exclusive
            size="small"
            value={modus}
            onChange={(_e, wert: EigeneModus | null) => {
              if (wert !== null) {
                setModus(wert)
                setVersucht(false)
              }
            }}
            aria-label="Wie die Meldung entsteht"
          >
            <ToggleButton value="ergaenzen">{MODUS_TEXT.ergaenzen}</ToggleButton>
            <ToggleButton value="selbst">{MODUS_TEXT.selbst}</ToggleButton>
          </ToggleButtonGroup>

          {modus === 'ergaenzen' ? (
            <>
              <Typography variant="body2" color="text.secondary">
                Was die Quelle nicht sagt und die Redaktion weiss – zum Beispiel, was eine Turnerobe ist, wer
                sie veranstaltet, was sie kostet. Die KI schreibt die Meldung aus den Angaben der Quelle und
                diesen Zeilen; sie schreibt sie nicht der Quelle zu. Auf der Meldung steht, dass eigene
                Angaben eingeflossen sind.
              </Typography>
              <TextField
                label="Ergänzende Angaben"
                value={eingabe.ergaenzung}
                onChange={(e) => setze('ergaenzung', e.target.value)}
                multiline
                minRows={4}
                autoFocus
                helperText="Fakten, keine Formulierungen – die Meldung entsteht in eigenen Worten."
              />
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                Ohne Modellaufruf. Die Quellenzeile kommt wie immer vom Code unter den Text; Zeitbezüge und
                Links werden geprüft, Zahlen und Wortlaut nicht – das steht dann auf der Meldung.
              </Typography>
              <TextField
                label="Titel"
                value={eingabe.titel}
                onChange={(e) => setze('titel', e.target.value)}
                autoFocus
              />
              <TextField
                label="Lead"
                value={eingabe.lead}
                onChange={(e) => setze('lead', e.target.value)}
                multiline
                minRows={2}
                helperText="Ein Satz – ohne Lead lässt sich die Meldung nicht publizieren."
              />
              <TextField
                label="Text"
                value={eingabe.text}
                onChange={(e) => setze('text', e.target.value)}
                multiline
                minRows={6}
                helperText="Absätze durch eine Leerzeile trennen. Daten absolut schreiben, zum Beispiel «am Samstag, 21. November 2026»."
              />
            </>
          )}

          {versucht && fehlt !== null && <Alert severity="warning">{fehlt}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" onClick={abschicken}>
          {modus === 'ergaenzen' ? 'Meldung schreiben lassen' : 'Meldung anlegen'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
