'use client'

import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { AlleMeldungFelder } from '@/graphql/redaktion'
import { formatiereDatum } from '@/lib/redaktion'
import { AUTO_SICHTBAR_TAGE, automatischPublizierte, type AutoTisch } from '@/lib/tische'
import { Artikeltext } from './Artikeltext'

// Was der Lauf eines Tischs von sich aus publiziert hat. Ein publizierter
// Artikel verlaesst sonst den Tisch — hier bleibt er vierzehn Tage stehen,
// lesbar und mit einem Griff zurueckzuziehen: Auto-Publish nimmt der
// Redaktion den Klick ab, nicht den Blick.
//
// Praesentational: Props hinein, Rueckruf hinaus. Zurueckziehen ist dasselbe
// «verwerfen» wie auf jeder Karte; der Statuswaechter stempelt den Rueckzug,
// und die oeffentliche API meldet ihn unter /korrekturen.

export interface AutoPubliziertProps {
  tisch: AutoTisch
  meldungen: readonly AlleMeldungFelder[]
  /** JJJJ-MM-TT */
  heute: string
  /** Ob Auto-Publish fuer diesen Tisch eingeschaltet ist. */
  eingeschaltet: boolean
  laeuft?: boolean
  onZurueckziehen: (id: string, kommentar?: string) => Promise<void>
}

export function AutoPubliziert({
  tisch,
  meldungen,
  heute,
  eingeschaltet,
  laeuft = false,
  onZurueckziehen
}: AutoPubliziertProps) {
  const liste = useMemo(() => automatischPublizierte(meldungen, tisch, heute), [meldungen, tisch, heute])
  const [offen, setOffen] = useState<Set<string>>(new Set())
  const [rueckzug, setRueckzug] = useState<string | null>(null)
  const [grund, setGrund] = useState('')

  // Ausgeschaltet und nichts draussen: der Tisch braucht keinen leeren Kasten.
  if (!eingeschaltet && liste.length === 0) return null

  function schalte(id: string) {
    setOffen((menge) => {
      const kopie = new Set(menge)
      if (kopie.has(id)) kopie.delete(id)
      else kopie.add(id)
      return kopie
    })
  }

  async function bestaetigen() {
    if (rueckzug === null) return
    const id = rueckzug
    const kommentar = grund.trim()
    setRueckzug(null)
    setGrund('')
    await onZurueckziehen(id, kommentar === '' ? undefined : kommentar)
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
          <Typography variant="subtitle2">Automatisch publiziert</Typography>
          <Chip
            size="small"
            color={eingeschaltet ? 'success' : 'default'}
            variant="outlined"
            label={eingeschaltet ? 'Auto-Publish ein' : 'Auto-Publish aus'}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {eingeschaltet
            ? `Der Lauf publiziert die Entwürfe, die er zu Vorschlägen selbst schreibt — nur ohne Warnung. Hier stehen sie ${AUTO_SICHTBAR_TAGE} Tage lang; zurückziehen kannst du jede.`
            : `Auto-Publish ist ausgeschaltet. Was vorher automatisch hinausging, steht noch ${AUTO_SICHTBAR_TAGE} Tage hier.`}
        </Typography>
        {liste.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            In den letzten {AUTO_SICHTBAR_TAGE} Tagen wurde nichts automatisch publiziert.
          </Typography>
        )}
        {liste.map((m) => (
          <Box key={m.id} sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1, minWidth: 200 }}>
                {m.titel ?? 'Ohne Titel'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {m.gemeinde?.name ?? 'Ohne Gemeinde'} · {formatiereDatum(m.publiziert_am)}
              </Typography>
              <Button size="small" onClick={() => schalte(m.id)}>
                {offen.has(m.id) ? 'Zuklappen' : 'Lesen'}
              </Button>
              <Button size="small" color="warning" disabled={laeuft} onClick={() => setRueckzug(m.id)}>
                Zurückziehen
              </Button>
            </Stack>
            <Collapse in={offen.has(m.id)} unmountOnExit>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {m.lead !== null && m.lead.trim() !== '' && (
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {m.lead}
                  </Typography>
                )}
                <Artikeltext text={m.text} abstand={0} />
              </Stack>
            </Collapse>
          </Box>
        ))}
      </Stack>

      <Dialog open={rueckzug !== null} onClose={() => setRueckzug(null)} fullWidth maxWidth="xs">
        <DialogTitle>Meldung zurückziehen</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Die Meldung wird verworfen und nicht mehr ausgeliefert; der Dorfkönig erfährt den Rückzug.
            </Typography>
            <TextField
              label="Warum? (optional, hilft dem Lernen)"
              size="small"
              multiline
              minRows={2}
              autoFocus
              value={grund}
              onChange={(e) => setGrund(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRueckzug(null)}>Abbrechen</Button>
          <Button variant="contained" color="warning" onClick={() => void bestaetigen()}>
            Zurückziehen
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
