'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { DatensatzWahlFelder } from '@/graphql/redaktion'

// The editor overruling the machine.
//
// Three things happen here, and they belong together because they are one
// decision: which dataset this announcement means, which column identifies the
// municipality when the portal did not say, and what the run should write.
//
// The instruction is the reason this exists. "Landwirtschaft 2025" has no
// dataset of its own — the figures sit inside "Arbeitsstätten und Beschäftigte
// nach Wirtschaftssektor" as sector 1. No automatic match can know that the
// story is the number of farms over twenty years. A person can say it in one
// sentence, and that sentence goes into the briefing and into every article.

/**
 * What the dialog was opened for.
 *
 * Either a row from the agenda or a dataset that changed in the catalogue —
 * only 9 of 188 datasets have an agenda entry, so the second case is the common
 * one. The dialog itself does not care which; it needs a heading, a starting
 * point, and something to link the result to.
 */
export interface AuftragZiel {
  titel: string
  /** Pre-selected dataset, when the row already has one. */
  datensatzId: string | null
  /** The announcement to attach the dataset to, when the row came from the agenda. */
  ankuendigungId: string | null
}

export interface AuftragDialogProps {
  ziel: AuftragZiel | null
  datensaetze: readonly DatensatzWahlFelder[]
  laeuft?: boolean
  /** Registers a statistik.bl.ch table and returns the dataset it became. */
  onTabelle: (url: string, vorgabe: string) => Promise<DatensatzWahlFelder | null>
  onSchliessen: () => void
  onStarten: (auftrag: { datensatzId: string; vorgabe: string; gemeindefeld: string | null }) => void
  /** Assign the dataset without starting a run. */
  onNurZuordnen: (datensatzId: string | null) => void
}

export function AuftragDialog({
  ziel,
  datensaetze,
  laeuft = false,
  onTabelle,
  onSchliessen,
  onStarten,
  onNurZuordnen
}: AuftragDialogProps) {
  const [wahl, setWahl] = useState<DatensatzWahlFelder | null>(null)
  const [vorgabe, setVorgabe] = useState('')
  const [gemeindefeld, setGemeindefeld] = useState<string | null>(null)
  const [beruehrt, setBeruehrt] = useState(false)
  const [tabellenUrl, setTabellenUrl] = useState('')
  const [holt, setHolt] = useState(false)
  const [tabellenFehler, setTabellenFehler] = useState<string | null>(null)

  // The already-assigned dataset is the starting point, until the editor picks
  // another one in this dialog.
  const aktuell = useMemo(() => {
    if (wahl !== null || beruehrt) return wahl
    if (ziel?.datensatzId == null) return null
    return datensaetze.find((d) => d.id === ziel.datensatzId) ?? null
  }, [wahl, beruehrt, ziel, datensaetze])

  const spalte = gemeindefeld ?? aktuell?.gemeindefeld ?? null
  const brauchtSpalte = aktuell !== null && !aktuell.hat_gemeinde
  const bereit = aktuell !== null && (!brauchtSpalte || spalte !== null)

  function schliessen() {
    setWahl(null)
    setVorgabe('')
    setGemeindefeld(null)
    setBeruehrt(false)
    setTabellenUrl('')
    setTabellenFehler(null)
    onSchliessen()
  }

  async function tabelleHolen() {
    setHolt(true)
    setTabellenFehler(null)

    try {
      const datensatz = await onTabelle(tabellenUrl.trim(), vorgabe.trim())
      if (datensatz === null) {
        setTabellenFehler('Diese Tabelle konnte nicht gelesen werden.')
        return
      }
      setWahl(datensatz)
      setBeruehrt(true)
      setTabellenUrl('')
    } catch (error) {
      setTabellenFehler(error instanceof Error ? error.message : 'Diese Tabelle konnte nicht gelesen werden.')
    } finally {
      setHolt(false)
    }
  }

  return (
    <Dialog open={ziel !== null} onClose={schliessen} fullWidth maxWidth="md">
      <DialogTitle>{ziel?.titel ?? ''}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Welcher Datensatz im Portal gehört zu dieser Statistik, und was soll daraus werden?
          </Typography>

          <Autocomplete
            options={[...datensaetze]}
            value={aktuell}
            onChange={(_, neu) => {
              setWahl(neu)
              setBeruehrt(true)
              setGemeindefeld(null)
            }}
            getOptionLabel={(o) => `${o.titel} (${o.externe_id})`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Datensatz"
                placeholder="Titel oder ID eingeben"
                helperText="Alle Datensätze des Portals — auch die ohne Gemeindespalte."
              />
            )}
            renderOption={(props, option) => {
              const { key, ...rest } = props as { key?: string } & Record<string, unknown>
              return (
                <li key={option.id} {...rest}>
                  <Stack sx={{ width: '100%' }}>
                    <Typography variant="body2">{option.titel}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {option.externe_id}
                      {option.hat_gemeinde ? ' · nach Gemeinde' : ' · keine Gemeindespalte erkannt'}
                    </Typography>
                  </Stack>
                </li>
              )
            }}
          />

          {/* Nicht alles, was das Amt publiziert, liegt im Open-Data-Portal —
              zur Landwirtschaft gibt es dort gar nichts. Diese Tabellen haben
              eine feste Adresse und Jahrgaenge bis zurueck, also holt sie „Die
              Redaktion" direkt. */}
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              Kein passender Datensatz im Portal? Adresse einer Tabelle von statistik.bl.ch einfügen:
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                size="small"
                label="Tabellen-Adresse"
                value={tabellenUrl}
                onChange={(e) => setTabellenUrl(e.target.value)}
                placeholder="https://statistik.bl.ch/web_portal/7_1_1_3"
              />
              <Button
                onClick={() => void tabelleHolen()}
                disabled={holt || laeuft || tabellenUrl.trim() === ''}
              >
                {holt ? 'Liest …' : 'Tabelle lesen'}
              </Button>
            </Stack>
            {tabellenFehler !== null && <Alert severity="error">{tabellenFehler}</Alert>}
          </Stack>

          {brauchtSpalte && (
            <Stack spacing={1}>
              <Alert severity="warning">
                Für diesen Datensatz wurde keine Gemeindespalte erkannt. Wenn du weisst, welche Spalte die
                Gemeinde bezeichnet, wähle sie — die Zuordnung läuft dann über BFS-Nummer oder Namen.
              </Alert>
              <Autocomplete
                options={(aktuell?.felder ?? []).map((f) => f.name)}
                value={spalte}
                onChange={(_, neu) => setGemeindefeld(neu)}
                renderInput={(params) => <TextField {...params} label="Gemeindespalte" />}
              />
            </Stack>
          )}

          <TextField
            label="Auftrag an die Redaktion"
            value={vorgabe}
            onChange={(e) => setVorgabe(e.target.value)}
            multiline
            minRows={3}
            placeholder="Vergleiche die Zahl der Landwirtschaftsbetriebe je Gemeinde mit dem Vorjahr und mit vor zehn Jahren, und ordne sie in die kantonale Entwicklung ein."
            helperText="Optional. Gilt für alle Meldungen dieses Laufs — und wird bei einer Tabelle gemerkt, sodass der Lauf im nächsten Jahr denselben Auftrag hat."
          />

          {aktuell !== null && (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Chip size="small" label={`Status: ${aktuell.status}`} />
              <Chip
                size="small"
                color={aktuell.hat_gemeinde || spalte !== null ? 'success' : 'default'}
                label={
                  aktuell.hat_gemeinde
                    ? 'Gemeindedaten erkannt'
                    : spalte === null
                      ? 'keine Gemeindespalte'
                      : `Gemeindespalte: ${spalte}`
                }
              />
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={schliessen} color="inherit">
          Abbrechen
        </Button>
        <Button
          disabled={laeuft || aktuell === null}
          onClick={() => {
            onNurZuordnen(aktuell?.id ?? null)
            schliessen()
          }}
        >
          Nur zuordnen
        </Button>
        <Button
          variant="contained"
          disabled={laeuft || !bereit}
          onClick={() => {
            if (aktuell === null) return
            onStarten({
              datensatzId: aktuell.id,
              vorgabe: vorgabe.trim(),
              gemeindefeld: brauchtSpalte ? spalte : null
            })
            schliessen()
          }}
        >
          Meldungen erzeugen
        </Button>
      </DialogActions>
    </Dialog>
  )
}
