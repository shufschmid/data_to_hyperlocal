'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import InputAdornment from '@mui/material/InputAdornment'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import SearchIcon from '@mui/icons-material/Search'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type {
  EntsorgungskalenderFelder,
  GemeindeFelder,
  VereinFelder,
  WochenblattFelder
} from '@/graphql/redaktion'
import {
  blattJeGemeinde,
  filterGemeinden,
  gemeindeSlug,
  istBaselbiet,
  kalenderJeGemeinde,
  vereineNachGemeinde
} from '@/lib/redaktion'
import { kalenderStatusText } from '@/lib/entsorgung'
import { VereinDialog, type VereinFormular } from './VereinDialog'

// Das Redaktionsgebiet — eine Karte je Gemeinde, mit allem, was an ihr haengt.
//
// Vorher war das eine Liste aller 87 Zeilen mit Schaltern, und die Zuordnungen
// lagen anderswo: Vereine nur im Directus-Admin, die Wochenblatt-Abdeckung nur
// beim Erstanlegen setzbar, der Abfuhrkalender gar nicht sichtbar. Jetzt zeigt
// die Ansicht, was die Redaktion tatsaechlich bespielt, und jede Karte
// beantwortet die vier Fragen an einem Ort.
//
// Die Liste selbst bleibt vollstaendig — sie ist nicht nur Auswahl, sondern
// auch das Verzeichnis, gegen das die Quellen-Erkennung prueft („nennt diese
// Portalseite mindestens 20 unserer Gemeindenamen?"). Ausgeduennt wuerde die
// Erkennung still versiegen. Unsichtbar ist hier also nur, was nicht bespielt
// wird; im Hinzufuegen-Dialog ist es wieder da.

export interface GemeindenAuswahlProps {
  gemeinden: readonly GemeindeFelder[]
  vereine?: readonly VereinFelder[]
  blaetter?: readonly WochenblattFelder[]
  kalender?: readonly EntsorgungskalenderFelder[]
  onUmschalten: (id: string, aktiv: boolean) => Promise<void>
  onGemeindeErfassen?: (eingabe: { name: string; bfs_nummer: number; bezirk: string }) => Promise<void>
  onVerein?: (gemeindeId: string, eingabe: VereinFormular, vereinId: string | null) => Promise<void>
  onBlattZuordnen?: (blattId: string, gemeindeId: string, entfernen: boolean) => Promise<void>
  onZumEntsorgungsTab?: () => void
  onPlz?: (gemeindeId: string, plz: string[]) => Promise<void>
  laeuft?: boolean
  /** In Tests gesetzt. */
  jahr?: number
}

export function GemeindenAuswahl({
  gemeinden,
  vereine = [],
  blaetter = [],
  kalender = [],
  onUmschalten,
  onGemeindeErfassen,
  onVerein,
  onBlattZuordnen,
  onZumEntsorgungsTab,
  onPlz,
  laeuft = false,
  jahr
}: GemeindenAuswahlProps) {
  const [suche, setSuche] = useState('')
  const [hinzufuegenOffen, setHinzufuegenOffen] = useState(false)
  const [vereinDialog, setVereinDialog] = useState<{
    gemeinde: GemeindeFelder
    verein: VereinFelder | null
  } | null>(null)
  const [blattDialog, setBlattDialog] = useState<GemeindeFelder | null>(null)

  const aktiveJahr = jahr ?? new Date().getFullYear()
  const aktive = useMemo(() => filterGemeinden(gemeinden, suche, true), [gemeinden, suche])
  const nachGemeinde = useMemo(() => vereineNachGemeinde(vereine), [vereine])
  const blattVon = useMemo(() => blattJeGemeinde(blaetter), [blaetter])
  const kalenderVon = useMemo(() => kalenderJeGemeinde(kalender, aktiveJahr), [kalender, aktiveJahr])
  const anzahlAktiv = gemeinden.filter((g) => g.aktiv).length

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <TextField
          size="small"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder="Gemeinde, Bezirk oder BFS-Nummer"
          label="Suche"
          sx={{ flex: '1 1 240px' }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              )
            }
          }}
        />
        <Button variant="contained" size="small" onClick={() => setHinzufuegenOffen(true)}>
          Gemeinde hinzufügen
        </Button>
      </Stack>

      {anzahlAktiv === 0 ? (
        <Alert severity="warning">
          Noch keine Gemeinde im Redaktionsgebiet — ein Lauf würde keine Meldung erzeugen.
        </Alert>
      ) : (
        aktive.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Keine Gemeinde gefunden.
          </Typography>
        )
      )}

      {aktive.map((gemeinde) => (
        <GemeindeKarte
          key={gemeinde.id}
          gemeinde={gemeinde}
          vereine={nachGemeinde.get(gemeinde.id) ?? []}
          blatt={blattVon.get(gemeinde.id) ?? null}
          kalender={kalenderVon.get(gemeinde.id) ?? null}
          jahr={aktiveJahr}
          laeuft={laeuft}
          onEntfernen={() => void onUmschalten(gemeinde.id, false)}
          {...(onVerein === undefined
            ? {}
            : {
                onVereinBearbeiten: (verein: VereinFelder | null) => setVereinDialog({ gemeinde, verein })
              })}
          {...(onBlattZuordnen === undefined ? {} : { onBlattAendern: () => setBlattDialog(gemeinde) })}
          {...(onZumEntsorgungsTab === undefined ? {} : { onZumEntsorgungsTab })}
          {...(onPlz === undefined ? {} : { onPlz })}
        />
      ))}

      <GemeindeHinzufuegen
        offen={hinzufuegenOffen}
        gemeinden={gemeinden}
        laeuft={laeuft}
        onSchliessen={() => setHinzufuegenOffen(false)}
        onAktivieren={async (id) => {
          await onUmschalten(id, true)
          setHinzufuegenOffen(false)
        }}
        {...(onGemeindeErfassen === undefined
          ? {}
          : {
              onErfassen: async (eingabe: { name: string; bfs_nummer: number; bezirk: string }) => {
                await onGemeindeErfassen(eingabe)
                setHinzufuegenOffen(false)
              }
            })}
      />

      {onVerein !== undefined && (
        <VereinDialog
          offen={vereinDialog !== null}
          gemeindeName={vereinDialog?.gemeinde.name ?? ''}
          verein={vereinDialog?.verein ?? null}
          laeuft={laeuft}
          onSchliessen={() => setVereinDialog(null)}
          onSpeichern={async (eingabe, vereinId) => {
            if (vereinDialog === null) return
            await onVerein(vereinDialog.gemeinde.id, eingabe, vereinId)
            setVereinDialog(null)
          }}
        />
      )}

      {onBlattZuordnen !== undefined && (
        <BlattZuordnen
          gemeinde={blattDialog}
          blaetter={blaetter}
          aktuell={blattDialog === null ? null : (blattVon.get(blattDialog.id) ?? null)}
          laeuft={laeuft}
          onSchliessen={() => setBlattDialog(null)}
          onZuordnen={async (blattId, entfernen) => {
            if (blattDialog === null) return
            await onBlattZuordnen(blattId, blattDialog.id, entfernen)
            setBlattDialog(null)
          }}
        />
      )}
    </Stack>
  )
}

interface KarteProps {
  gemeinde: GemeindeFelder
  vereine: readonly VereinFelder[]
  blatt: WochenblattFelder | null
  kalender: EntsorgungskalenderFelder | null
  jahr: number
  laeuft: boolean
  onEntfernen: () => void
  onVereinBearbeiten?: (verein: VereinFelder | null) => void
  onBlattAendern?: () => void
  onZumEntsorgungsTab?: () => void
  onPlz?: (gemeindeId: string, plz: string[]) => Promise<void>
}

function GemeindeKarte({
  gemeinde,
  vereine,
  blatt,
  kalender,
  jahr,
  laeuft,
  onEntfernen,
  onVereinBearbeiten,
  onBlattAendern,
  onZumEntsorgungsTab,
  onPlz
}: KarteProps) {
  const imKanton = istBaselbiet(gemeinde.bezirk)
  const [plzEingabe, setPlzEingabe] = useState((gemeinde.plz ?? []).join(', '))

  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
            <Typography variant="h3" component="h3" sx={{ fontSize: '1.1rem' }}>
              {gemeinde.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {gemeinde.bfs_nummer} · {gemeinde.bezirk}
            </Typography>
          </Stack>
          <Link href={`/blog?gemeinde=${gemeindeSlug(gemeinde.name)}`} variant="caption">
            Blog ansehen
          </Link>
        </Stack>

        <Divider />

        <Abschnitt titel="Statistik">
          {imKanton ? (
            <Typography variant="body2" color="text.secondary">
              Läuft automatisch über data.bl.ch und statistik.bl.ch.
            </Typography>
          ) : (
            // Ehrlicher als Schweigen: die Portale sind kantonal, diese
            // Gemeinde kommt in ihren Zeilen nicht vor. Sonst wartet die
            // Redaktion auf Meldungen, die nicht kommen koennen.
            <Alert severity="info" sx={{ py: 0 }}>
              Ausserhalb Basel-Landschaft — die kantonalen Statistik-Quellen führen diese Gemeinde nicht.
              Amtsblatt, Sport, Abfuhrkalender und Presseschau laufen normal — das Amtsblattportal ist
              national.
            </Alert>
          )}
        </Abschnitt>

        <Abschnitt
          titel="Sport"
          aktion={
            onVereinBearbeiten === undefined ? null : (
              <Button size="small" disabled={laeuft} onClick={() => onVereinBearbeiten(null)}>
                Verein erfassen
              </Button>
            )
          }
        >
          {vereine.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Noch kein Verein erfasst.
            </Typography>
          ) : (
            <Stack spacing={0.25}>
              {vereine.map((verein) => (
                <Stack
                  key={verein.id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 0.5 }}
                >
                  <Typography variant="body2">
                    {verein.bedeutung === 'aushaengeschild' ? '★' : '·'} {verein.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {verein.sportart}
                    {verein.liga === null ? '' : ` · ${verein.liga}`}
                  </Typography>
                  {!verein.aktiv && <Chip size="small" label="pausiert" />}
                  {!verein.zuordnung_geprueft && <Chip size="small" color="warning" label="vorgeschlagen" />}
                  {onVereinBearbeiten !== undefined && (
                    <Button
                      size="small"
                      variant="text"
                      disabled={laeuft}
                      onClick={() => onVereinBearbeiten(verein)}
                      sx={{ py: 0, minWidth: 0 }}
                    >
                      Bearbeiten
                    </Button>
                  )}
                </Stack>
              ))}
            </Stack>
          )}
        </Abschnitt>

        <Abschnitt
          titel="Wochenblatt"
          aktion={
            onBlattAendern === undefined ? null : (
              <Button size="small" disabled={laeuft} onClick={onBlattAendern}>
                Zuordnung ändern
              </Button>
            )
          }
        >
          {blatt === null ? (
            <Typography variant="body2" color="text.secondary">
              Keines zugeordnet. Ein neues Blatt wird im Reiter „Wochenblätter" erfasst.
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
              <Typography variant="body2">{blatt.name}</Typography>
              {blatt.gemeinde?.id === gemeinde.id && (
                <Chip size="small" variant="outlined" label="Hauptgemeinde" />
              )}
              {blatt.letzter_fehler !== null && (
                <Chip size="small" color="warning" label="zuletzt nicht gelesen" />
              )}
            </Stack>
          )}
        </Abschnitt>

        <Abschnitt titel="Amtsblatt">
          {(gemeinde.plz ?? []).length > 0 ? (
            <Typography variant="body2" color="text.secondary">
              Läuft über BFS {gemeinde.bfs_nummer} und PLZ {(gemeinde.plz ?? []).join(', ')}.
            </Typography>
          ) : (
            // Ohne PLZ liefert das Portal für diese Gemeinde schlicht nichts
            // zurück — und das sieht genauso aus wie „es wurde nichts
            // publiziert". Darum benannt statt verschwiegen.
            <Alert severity="warning" sx={{ py: 0 }}>
              Keine Postleitzahl erfasst. Baugesuche und Behördenbeschlüsse kommen trotzdem (über die
              BFS-Nummer), Handelsregister, Konkurse und Betreibungen aber nicht — die führt das Portal über
              die Adresse.
            </Alert>
          )}
          {onPlz !== undefined && (
            <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'flex-start' }}>
              <TextField
                size="small"
                label="Postleitzahlen"
                placeholder="4147, 4148"
                value={plzEingabe}
                onChange={(e) => setPlzEingabe(e.target.value)}
                sx={{ flex: 1 }}
              />
              <Button
                size="small"
                disabled={laeuft}
                onClick={() =>
                  void onPlz(
                    gemeinde.id,
                    plzEingabe
                      .split(/[\s,;]+/)
                      .map((t) => t.trim())
                      .filter((t) => t !== '')
                  )
                }
              >
                Speichern
              </Button>
            </Stack>
          )}
        </Abschnitt>

        <Abschnitt
          titel="Entsorgung"
          aktion={
            onZumEntsorgungsTab === undefined ? null : (
              <Button size="small" onClick={onZumEntsorgungsTab}>
                Zum Entsorgungs-Reiter
              </Button>
            )
          }
        >
          <Typography variant="body2" color="text.secondary">
            {kalender === null
              ? `Kein Abfuhrkalender ${jahr} erfasst — ohne ihn gibt es keine Erinnerungen.`
              : `Abfuhrkalender ${jahr}: ${kalenderStatusText(kalender.status)}${
                  kalender.dokumente.length > 1 ? ` · ${kalender.dokumente.length} Zonen` : ''
                }`}
          </Typography>
        </Abschnitt>

        <Box>
          <Button size="small" color="inherit" disabled={laeuft} onClick={onEntfernen}>
            Aus dem Redaktionsgebiet nehmen
          </Button>
        </Box>
      </Stack>
    </Paper>
  )
}

function Abschnitt({
  titel,
  aktion = null,
  children
}: {
  titel: string
  aktion?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2">{titel}</Typography>
        {aktion}
      </Stack>
      {children}
    </Box>
  )
}

/**
 * Gemeinde ins Redaktionsgebiet holen.
 *
 * Zwei Wege, und die Reihenfolge ist Absicht: fast immer steht die Gemeinde
 * schon im Verzeichnis (alle 86 Baselbieter plus Riehen) und muss nur
 * aktiviert werden. Nur was dort fehlt — Dornach etwa — wird neu erfasst.
 */
function GemeindeHinzufuegen({
  offen,
  gemeinden,
  laeuft,
  onSchliessen,
  onAktivieren,
  onErfassen
}: {
  offen: boolean
  gemeinden: readonly GemeindeFelder[]
  laeuft: boolean
  onSchliessen: () => void
  onAktivieren: (id: string) => Promise<void>
  onErfassen?: (eingabe: { name: string; bfs_nummer: number; bezirk: string }) => Promise<void>
}) {
  const [suche, setSuche] = useState('')
  const [neu, setNeu] = useState({ name: '', bfs_nummer: '', bezirk: '' })

  const frei = useMemo(
    () => filterGemeinden(gemeinden, suche, false).filter((g) => !g.aktiv),
    [gemeinden, suche]
  )
  const bfs = Number.parseInt(neu.bfs_nummer, 10)
  const neuBereit = neu.name.trim() !== '' && neu.bezirk.trim() !== '' && Number.isInteger(bfs) && bfs > 0

  return (
    <Dialog open={offen} onClose={onSchliessen} fullWidth maxWidth="sm">
      <DialogTitle>Gemeinde hinzufügen</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">Jede Gemeinde im Gebiet ist eine weitere Meldung pro Lauf.</Alert>

          <TextField
            size="small"
            label="Im Verzeichnis suchen"
            placeholder="Gemeinde, Bezirk oder BFS-Nummer"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
          />

          <Stack spacing={0.5} sx={{ maxHeight: 220, overflowY: 'auto' }}>
            {frei.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Keine passende Gemeinde im Verzeichnis.
              </Typography>
            ) : (
              frei.slice(0, 30).map((gemeinde) => (
                <Stack
                  key={gemeinde.id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Typography variant="body2">
                    {gemeinde.name}{' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {gemeinde.bfs_nummer} · {gemeinde.bezirk}
                    </Typography>
                  </Typography>
                  <Button size="small" disabled={laeuft} onClick={() => void onAktivieren(gemeinde.id)}>
                    Hinzufügen
                  </Button>
                </Stack>
              ))
            )}
          </Stack>

          {onErfassen !== undefined && (
            <>
              <Divider />
              <Typography variant="subtitle2">Nicht im Verzeichnis? Neu erfassen</Typography>
              <Typography variant="caption" color="text.secondary">
                Für Gemeinden ausserhalb Basel-Landschaft — etwa Dornach (SO). Die BFS-Nummer ist die Kennung,
                über die alle Daten zusammenfinden.
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  label="Name"
                  value={neu.name}
                  onChange={(e) => setNeu((a) => ({ ...a, name: e.target.value }))}
                  sx={{ flex: 2 }}
                />
                <TextField
                  size="small"
                  label="BFS-Nummer"
                  value={neu.bfs_nummer}
                  onChange={(e) => setNeu((a) => ({ ...a, bfs_nummer: e.target.value }))}
                  sx={{ flex: 1 }}
                />
              </Stack>
              <TextField
                size="small"
                label="Bezirk"
                placeholder="Dorneck (SO)"
                value={neu.bezirk}
                onChange={(e) => setNeu((a) => ({ ...a, bezirk: e.target.value }))}
              />
              <Box>
                <Button
                  variant="contained"
                  size="small"
                  disabled={laeuft || !neuBereit}
                  onClick={() =>
                    void onErfassen({
                      name: neu.name.trim(),
                      bfs_nummer: bfs,
                      bezirk: neu.bezirk.trim()
                    })
                  }
                >
                  Erfassen
                </Button>
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onSchliessen}>Schliessen</Button>
      </DialogActions>
    </Dialog>
  )
}

/** Welches Blatt diese Gemeinde abdeckt — zuordnen oder lösen. */
function BlattZuordnen({
  gemeinde,
  blaetter,
  aktuell,
  laeuft,
  onSchliessen,
  onZuordnen
}: {
  gemeinde: GemeindeFelder | null
  blaetter: readonly WochenblattFelder[]
  aktuell: WochenblattFelder | null
  laeuft: boolean
  onSchliessen: () => void
  onZuordnen: (blattId: string, entfernen: boolean) => Promise<void>
}) {
  const [wahl, setWahl] = useState('')
  const istHauptgemeinde = aktuell !== null && gemeinde !== null && aktuell.gemeinde?.id === gemeinde.id

  return (
    <Dialog open={gemeinde !== null} onClose={onSchliessen} fullWidth maxWidth="xs">
      <DialogTitle>Wochenblatt für {gemeinde?.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {aktuell === null ? (
            <Typography variant="body2" color="text.secondary">
              Zurzeit ist kein Blatt zugeordnet.
            </Typography>
          ) : (
            <Stack spacing={1}>
              <Typography variant="body2">
                Zugeordnet: <strong>{aktuell.name}</strong>
              </Typography>
              {istHauptgemeinde ? (
                <Alert severity="info">
                  Das ist die Hauptgemeinde des Blatts — sie kann hier nicht gelöst werden.
                </Alert>
              ) : (
                <Box>
                  <Button
                    size="small"
                    color="inherit"
                    disabled={laeuft}
                    onClick={() => void onZuordnen(aktuell.id, true)}
                  >
                    Zuordnung lösen
                  </Button>
                </Box>
              )}
            </Stack>
          )}

          <TextField
            select
            size="small"
            label="Anderem Blatt zuordnen"
            value={wahl}
            onChange={(e) => setWahl(e.target.value)}
            helperText={'Ein neues Blatt wird im Reiter "Wochenblätter" erfasst.'}
          >
            {blaetter
              .filter((blatt) => blatt.id !== aktuell?.id)
              .map((blatt) => (
                <MenuItem key={blatt.id} value={blatt.id}>
                  {blatt.name}
                </MenuItem>
              ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onSchliessen}>Abbrechen</Button>
        <Button
          variant="contained"
          disabled={laeuft || wahl === ''}
          onClick={() => void onZuordnen(wahl, false)}
        >
          Zuordnen
        </Button>
      </DialogActions>
    </Dialog>
  )
}
