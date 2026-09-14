'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { RecherchehinweisFelder, WissenFelder } from '@/graphql/redaktion'
import {
  automatikBilanz,
  automatikText,
  BEREICHE,
  geltungText,
  gruppiereRegeln,
  herkunftText,
  STUFEN,
  stufeText
} from '@/lib/gelerntes'

// The newsroom's memory, made visible and switchable.
//
// Every rule the system learned — from a chat instruction, from a comment on
// a decision, from decisions that repeated — sits here with its evidence, a
// switch, and (for Sichtung rules) a second switch that arms the automatic
// hand-up to the Chefredaktion. Nothing here is hidden: a rule the editor
// disagrees with is one switch away, and a rule she wants is one dialog away.

export interface NeueRegel {
  bereich: string
  stufe: string
  regel: string
  wirkung: string
}

export interface GelerntesProps {
  regeln: readonly WissenFelder[]
  /** All leads — the automation's track record is read off the ones a rule made. */
  hinweise?: readonly RecherchehinweisFelder[]
  laeuft?: boolean
  onAktiv: (id: string, aktiv: boolean) => Promise<void>
  onWirkung: (id: string, wirkung: 'hinweis' | 'weiterreichen') => Promise<void>
  onAnlegen: (regel: NeueRegel) => Promise<void>
}

export function Gelerntes({
  regeln,
  hinweise = [],
  laeuft = false,
  onAktiv,
  onWirkung,
  onAnlegen
}: GelerntesProps) {
  const gruppen = useMemo(() => gruppiereRegeln(regeln), [regeln])
  const [offeneBelege, setOffeneBelege] = useState<Set<string>>(new Set())
  const [offeneInaktive, setOffeneInaktive] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState(false)
  const [neu, setNeu] = useState<NeueRegel>({
    bereich: 'presseschau',
    stufe: 'sichtung',
    regel: '',
    wirkung: 'hinweis'
  })

  function schalte(menge: Set<string>, id: string): Set<string> {
    const kopie = new Set(menge)
    if (kopie.has(id)) kopie.delete(id)
    else kopie.add(id)
    return kopie
  }

  async function anlegen() {
    const regel = neu.regel.trim()
    if (regel === '') return
    await onAnlegen({ ...neu, regel })
    setDialog(false)
    setNeu({ bereich: neu.bereich, stufe: neu.stufe, regel: '', wirkung: 'hinweis' })
  }

  function Karte({ regel }: { regel: WissenFelder }) {
    const geltung = geltungText(regel)
    const bilanz = automatikText(automatikBilanz(hinweise, regel.id))
    return (
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
            <Chip size="small" label={stufeText(regel.stufe)} />
            <Chip size="small" variant="outlined" label={herkunftText(regel.herkunft)} />
            {geltung !== null && <Chip size="small" variant="outlined" label={geltung} />}
            {regel.stufe === 'sichtung' && regel.wirkung === 'weiterreichen' && (
              <Chip size="small" color="warning" label="reicht automatisch weiter" />
            )}
            <Box sx={{ flexGrow: 1 }} />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={regel.aktiv}
                  disabled={laeuft}
                  onChange={(e) => void onAktiv(regel.id, e.target.checked)}
                  slotProps={{ input: { 'aria-label': `Regel aktiv: ${regel.regel}` } }}
                />
              }
              label="aktiv"
            />
          </Stack>
          <Typography variant="body2">{regel.regel}</Typography>
          {regel.stufe === 'sichtung' && regel.aktiv && (
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={regel.wirkung === 'weiterreichen'}
                  disabled={laeuft}
                  onChange={(e) => void onWirkung(regel.id, e.target.checked ? 'weiterreichen' : 'hinweis')}
                  slotProps={{ input: { 'aria-label': `Automatisch weiterreichen: ${regel.regel}` } }}
                />
              }
              label={
                <Typography variant="caption">
                  Passende Vorschläge selbst an die Chefredaktion weiterreichen — als Fährte, nie als Meldung
                </Typography>
              }
            />
          )}
          {bilanz !== null && (
            <Typography variant="caption" color="text.secondary">
              {bilanz}
            </Typography>
          )}
          {regel.beleg !== null && regel.beleg !== '' && (
            <Box>
              <Button size="small" onClick={() => setOffeneBelege((m) => schalte(m, regel.id))}>
                {offeneBelege.has(regel.id) ? 'Beleg ausblenden' : 'Beleg anzeigen'}
              </Button>
              <Collapse in={offeneBelege.has(regel.id)} unmountOnExit>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="pre"
                  sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', m: 0, mt: 0.5 }}
                >
                  {regel.beleg}
                </Typography>
              </Collapse>
            </Box>
          )}
        </Stack>
      </Paper>
    )
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          Was die Redaktion dem System beigebracht hat — aus Anweisungen im Chat, aus Kommentaren zu
          Entscheiden und aus Entscheiden, die sich wiederholten. Jede Regel wirkt ab dem nächsten Lauf; eine
          falsche schaltest du hier aus.
        </Typography>
        <Button variant="outlined" onClick={() => setDialog(true)} disabled={laeuft}>
          Regel erfassen
        </Button>
      </Stack>

      {gruppen.length === 0 && <Alert severity="info">Noch nichts gelernt.</Alert>}

      {gruppen.map((gruppe) => (
        <Paper key={gruppe.bereich} sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2">
              {gruppe.text}{' '}
              <Typography component="span" variant="caption" color="text.secondary">
                — {gruppe.aktive.length} aktiv
              </Typography>
            </Typography>
            {gruppe.aktive.map((regel) => (
              <Karte key={regel.id} regel={regel} />
            ))}
            {gruppe.inaktive.length > 0 && (
              <Box>
                <Button size="small" onClick={() => setOffeneInaktive((m) => schalte(m, gruppe.bereich))}>
                  {offeneInaktive.has(gruppe.bereich)
                    ? 'Deaktivierte ausblenden'
                    : `Deaktiviert (${gruppe.inaktive.length}) anzeigen`}
                </Button>
                <Collapse in={offeneInaktive.has(gruppe.bereich)} unmountOnExit>
                  <Stack spacing={1} sx={{ mt: 1 }}>
                    {gruppe.inaktive.map((regel) => (
                      <Karte key={regel.id} regel={regel} />
                    ))}
                  </Stack>
                </Collapse>
              </Box>
            )}
          </Stack>
        </Paper>
      ))}

      {/* The cheapest learning of all: the editor says it once, in her words. */}
      <Dialog open={dialog} onClose={() => setDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Regel erfassen</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Tisch"
              value={neu.bereich}
              onChange={(e) => setNeu((n) => ({ ...n, bereich: e.target.value }))}
            >
              {BEREICHE.map((b) => (
                <MenuItem key={b.wert} value={b.wert}>
                  {b.text}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Gilt für"
              value={neu.stufe}
              onChange={(e) => setNeu((n) => ({ ...n, stufe: e.target.value, wirkung: 'hinweis' }))}
            >
              {STUFEN.map((s) => (
                <MenuItem key={s.wert} value={s.wert}>
                  {s.text}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Regel"
              value={neu.regel}
              onChange={(e) => setNeu((n) => ({ ...n, regel: e.target.value }))}
              multiline
              minRows={2}
              helperText="Als Anweisung formuliert, so wie sie im Prompt stehen soll — zum Beispiel: Vereinsjubiläen ohne besondere Zutaten nicht vorschlagen."
            />
            {neu.stufe === 'sichtung' && (
              <FormControlLabel
                control={
                  <Switch
                    checked={neu.wirkung === 'weiterreichen'}
                    onChange={(e) =>
                      setNeu((n) => ({ ...n, wirkung: e.target.checked ? 'weiterreichen' : 'hinweis' }))
                    }
                  />
                }
                label="Passende Vorschläge automatisch an die Chefredaktion weiterreichen"
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(false)}>Abbrechen</Button>
          <Button
            variant="contained"
            onClick={() => void anlegen()}
            disabled={laeuft || neu.regel.trim() === ''}
          >
            Speichern
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
