'use client'

import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  auftritteBeimUmschalten,
  eingabeAus,
  kurzesDatum,
  pruefeEingabe,
  terminSatz,
  weichtAb,
  type Termin,
  type TerminEingabe
} from '@/lib/termin'

// Der Termin einer Meldung — eine Zeile, aufklappbar zum Aendern.
//
// Der Lauf schlaegt ihn vor, die Redaktion setzt ihn (22. September 2026):
// wann die Meldung zaehlt, ob der Anlass wichtig genug ist, frueh angekuendigt
// zu werden, und an welchen Tagen der Dorfkoenig sie bringen soll. Im Text
// erscheint davon nichts — es ist eine Angabe an die Schnittstelle. Der
// Vorschlag bleibt sichtbar, wenn die Redaktion davon abweicht: das ist das
// Signal, aus dem die naechsten Artikel lernen.

export interface TerminZeileProps {
  termin: Termin | null
  terminVorschlag: Termin | null
  wichtig: boolean | null
  wichtigVorschlag: boolean | null
  disabled?: boolean
  onSpeichern: (eingabe: TerminEingabe) => Promise<void>
}

export function TerminZeile({
  termin,
  terminVorschlag,
  wichtig,
  wichtigVorschlag,
  disabled = false,
  onSpeichern
}: TerminZeileProps) {
  const [offen, setOffen] = useState(false)
  const [eingabe, setEingabe] = useState<TerminEingabe>(() => eingabeAus(termin, wichtig))
  const [neuerTag, setNeuerTag] = useState('')
  const [sendet, setSendet] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  const abweichend = weichtAb(termin, terminVorschlag, wichtig, wichtigVorschlag)

  function oeffnen() {
    setEingabe(eingabeAus(termin, wichtig))
    setNeuerTag('')
    setFehler(null)
    setOffen(true)
  }

  function tagHinzufuegen() {
    if (neuerTag === '' || eingabe.auftritte.includes(neuerTag)) return
    setEingabe({ ...eingabe, auftritte: [...eingabe.auftritte, neuerTag].sort() })
    setNeuerTag('')
  }

  async function speichern() {
    const problem = pruefeEingabe(eingabe)
    if (problem !== null) {
      setFehler(problem)
      return
    }
    setSendet(true)
    try {
      await onSpeichern({
        ideal: eingabe.ideal === '' ? null : eingabe.ideal,
        ende: eingabe.ende === '' ? null : eingabe.ende,
        auftritte: eingabe.auftritte,
        wichtig: eingabe.wichtig
      })
      setOffen(false)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Der Termin konnte nicht gespeichert werden.')
    } finally {
      setSendet(false)
    }
  }

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {terminSatz(termin, wichtig)}
        </Typography>
        {abweichend && (
          <Chip
            size="small"
            variant="outlined"
            label={`Vorschlag: ${terminSatz(terminVorschlag, wichtigVorschlag)}`}
          />
        )}
        {!offen && (
          <Button size="small" onClick={oeffnen} disabled={disabled}>
            {termin === null ? 'Termin setzen' : 'Termin ändern'}
          </Button>
        )}
      </Stack>

      {offen && (
        <Stack spacing={1} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <TextField
              label="Termin"
              type="date"
              size="small"
              value={eingabe.ideal ?? ''}
              onChange={(e) => setEingabe({ ...eingabe, ideal: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText="Anmeldeschluss, erster Tag oder Tag der Sperrung"
            />
            <TextField
              label="Ende"
              type="date"
              size="small"
              value={eingabe.ende ?? ''}
              onChange={(e) => setEingabe({ ...eingabe, ende: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText="Letzter Tag, an dem die Meldung noch Sinn hat"
            />
          </Stack>
          <FormControlLabel
            control={
              <Switch
                checked={eingabe.wichtig}
                onChange={(_, an) =>
                  setEingabe({
                    ...eingabe,
                    wichtig: an,
                    auftritte: auftritteBeimUmschalten(eingabe.auftritte, an, eingabe.ideal)
                  })
                }
              />
            }
            label="Wichtiger Anlass — früh ankündigen (erster Auftritt sofort nach der Publikation)"
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Typography variant="body2">Weitere Auftritte:</Typography>
            {eingabe.auftritte.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                keine — der Dorfkönig bringt die Meldung am Werktag vor dem Termin
              </Typography>
            )}
            {eingabe.auftritte.map((tag) => (
              <Chip
                key={tag}
                size="small"
                label={kurzesDatum(tag)}
                onDelete={() =>
                  setEingabe({ ...eingabe, auftritte: eingabe.auftritte.filter((t) => t !== tag) })
                }
              />
            ))}
            <TextField
              type="date"
              size="small"
              value={neuerTag}
              onChange={(e) => setNeuerTag(e.target.value)}
              slotProps={{ htmlInput: { 'aria-label': 'Auftritt hinzufügen' } }}
            />
            <Button size="small" onClick={tagHinzufuegen} disabled={neuerTag === ''}>
              Tag hinzufügen
            </Button>
          </Stack>
          {fehler !== null && <Alert severity="warning">{fehler}</Alert>}
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={() => void speichern()} disabled={sendet}>
              Termin speichern
            </Button>
            <Button size="small" onClick={() => setOffen(false)} disabled={sendet}>
              Abbrechen
            </Button>
          </Stack>
        </Stack>
      )}
    </Stack>
  )
}
