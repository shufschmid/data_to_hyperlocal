'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type {
  AlleMeldungFelder,
  GemeindeFelder,
  KandidatFelder,
  RecherchehinweisFelder,
  WochenblattFelder
} from '@/graphql/redaktion'
import { MeldungKarte, type MeldungAktion } from './MeldungKarte'

// The press review: what each municipality's weekly paper has exclusively.
//
// The 09:00 run inventories a new issue into candidates; everything here is
// the editor's half of the loop — take a candidate over (one Meldung, with
// attribution and page link) or reject it with a reason. Both are learning
// signals: they ride into the next inventory as examples.

const TYP_LABEL: Record<string, string> = {
  interview: 'Interview',
  reportage: 'Reportage',
  portraet: 'Porträt',
  hintergrund: 'Hintergrund',
  vereinsleben: 'Vereinsleben',
  veranstaltung: 'Veranstaltung',
  service: 'Service',
  erfolgsmeldung: 'Erfolgsmeldung',
  fotoverweis: 'Fotoverweis'
}

const AUSGABE_STATUS: Record<string, string> = {
  neu: 'Neu',
  liest: 'Wird gelesen',
  inventarisiert: 'Inventarisiert',
  fehler: 'Fehler'
}

const GRUENDE = [
  { wert: 'nicht_relevant', text: 'Nicht relevant' },
  { wert: 'doublette', text: 'Doublette' },
  { wert: 'veraltet', text: 'Veraltet' },
  { wert: 'falsche_gemeinde', text: 'Falsche Gemeinde' },
  { wert: 'andere', text: 'Andere' }
]

const GRUND_LABEL: Record<string, string> = Object.fromEntries(GRUENDE.map((g) => [g.wert, g.text]))

export interface PresseschauProps {
  blaetter: readonly WochenblattFelder[]
  gemeinden: readonly GemeindeFelder[]
  meldungen: readonly AlleMeldungFelder[]
  hinweise?: readonly RecherchehinweisFelder[]
  laedt?: boolean
  laeuft?: boolean
  onAnlegen: (eingabe: { gemeinden: string[]; name: string; archiv_url: string }) => Promise<void>
  onPruefen: () => Promise<void>
  onInventar: (ausgabeId: string) => Promise<void>
  onMeldung: (kandidatId: string) => Promise<void>
  onAblehnen: (kandidatId: string, grund: string, kommentar: string) => Promise<void>
  onGemeinde?: (kandidatId: string, gemeindeId: string) => Promise<void>
  onHinweisUrteil?: (hinweisId: string, brauchbar: boolean, kommentar: string) => Promise<void>
  onChat: (id: string, anweisung: string) => Promise<void>
  onAktion: (id: string, aktion: MeldungAktion) => Promise<void>
  onPerlePublizieren: (id: string, perle: boolean) => Promise<void>
}

export function Presseschau({
  blaetter,
  gemeinden,
  meldungen,
  hinweise = [],
  laedt = false,
  laeuft = false,
  onAnlegen,
  onPruefen,
  onInventar,
  onMeldung,
  onAblehnen,
  onGemeinde,
  onHinweisUrteil,
  onChat,
  onAktion,
  onPerlePublizieren
}: PresseschauProps) {
  const [gewaehlteGemeinden, setGewaehlteGemeinden] = useState<string[]>([])
  const [name, setName] = useState('')
  const [archivUrl, setArchivUrl] = useState('')
  const [ablehnung, setAblehnung] = useState<KandidatFelder | null>(null)
  const [grund, setGrund] = useState('nicht_relevant')
  const [kommentar, setKommentar] = useState('')
  const [urteil, setUrteil] = useState<{
    hinweis: RecherchehinweisFelder
    brauchbar: boolean
  } | null>(null)
  const [urteilKommentar, setUrteilKommentar] = useState('')

  // A municipality already covered by some paper is not offered again.
  const freieGemeinden = useMemo(() => {
    const belegt = new Set<string | undefined>()
    for (const blatt of blaetter) {
      belegt.add(blatt.gemeinde?.id)
      for (const a of blatt.abdeckungen) belegt.add(a.gemeinde?.id)
    }
    return gemeinden.filter((g) => !belegt.has(g.id))
  }, [blaetter, gemeinden])

  const offeneHinweise = useMemo(() => hinweise.filter((h) => h.status === 'offen'), [hinweise])

  const nachKandidat = useMemo(() => {
    const karte = new Map<string, AlleMeldungFelder>()
    for (const meldung of meldungen) {
      if (meldung.kandidat !== null) karte.set(meldung.kandidat.id, meldung)
    }
    return karte
  }, [meldungen])

  const liest = blaetter.some((b) => b.ausgaben.some((a) => a.status === 'liest' || a.status === 'neu'))

  async function anlegen() {
    await onAnlegen({
      gemeinden: gewaehlteGemeinden,
      name: name.trim(),
      archiv_url: archivUrl.trim()
    })
    setGewaehlteGemeinden([])
    setName('')
    setArchivUrl('')
  }

  async function ablehnen() {
    if (ablehnung === null) return
    await onAblehnen(ablehnung.id, grund, kommentar.trim())
    setAblehnung(null)
    setGrund('nicht_relevant')
    setKommentar('')
  }

  async function beurteilen() {
    if (urteil === null || onHinweisUrteil === undefined) return
    await onHinweisUrteil(urteil.hinweis.id, urteil.brauchbar, urteilKommentar.trim())
    setUrteil(null)
    setUrteilKommentar('')
  }

  return (
    <Stack spacing={2}>
      {/* A paper that could not be read says so — absence is never silence. */}
      {blaetter
        .filter((b) => b.letzter_fehler !== null)
        .map((b) => (
          <Alert key={b.id} severity="warning">
            <AlertTitle>{b.name}: Archiv nicht gelesen</AlertTitle>
            {b.letzter_fehler}
            {b.letzte_pruefung !== null && ` — letzter Versuch: ${b.letzte_pruefung.slice(0, 10)}`}
            {' · '}
            <Link href={b.archiv_url} target="_blank" rel="noopener noreferrer">
              Archiv öffnen
            </Link>
          </Alert>
        ))}

      {/* Research leads first and loud: never content, always work — a new
          one must be impossible to miss. */}
      {offeneHinweise.length > 0 && (
        <Paper sx={{ p: 2, borderLeft: 4, borderColor: 'warning.main' }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2">Recherche-Hinweise ({offeneHinweise.length} offen)</Typography>
            {offeneHinweise.map((h) => (
              <Box key={h.id} sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}>
                <Stack spacing={0.5}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {h.titel}
                    </Typography>
                    {h.gemeinde !== null && <Chip size="small" variant="outlined" label={h.gemeinde.name} />}
                    <Typography variant="caption" color="text.secondary">
                      {h.ausgabe?.wochenblatt?.name}
                      {h.ausgabe?.nummer !== null && ` Nr. ${h.ausgabe?.nummer}`}
                    </Typography>
                  </Stack>
                  {h.fundort !== null && (
                    <Typography variant="caption" color="text.secondary">
                      {h.fundort}
                    </Typography>
                  )}
                  {h.begruendung !== null && <Typography variant="body2">{h.begruendung}</Typography>}
                  {onHinweisUrteil !== undefined && (
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="contained"
                        color="warning"
                        onClick={() => setUrteil({ hinweis: h, brauchbar: true })}
                        disabled={laeuft}
                      >
                        Brauchbare Fährte
                      </Button>
                      <Button
                        size="small"
                        onClick={() => setUrteil({ hinweis: h, brauchbar: false })}
                        disabled={laeuft}
                      >
                        Kein Hinweis
                      </Button>
                    </Stack>
                  )}
                </Stack>
              </Box>
            ))}
          </Stack>
        </Paper>
      )}

      <Paper sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Typography variant="subtitle2">Wochenblatt erfassen</Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <TextField
              select
              label="Gemeinden"
              size="small"
              value={gewaehlteGemeinden}
              onChange={(e) => {
                const wert = e.target.value
                setGewaehlteGemeinden(Array.isArray(wert) ? wert : [wert])
              }}
              helperText="Mehrfachwahl: der Anzeiger zweier Gemeinden traegt beide."
              slotProps={{ select: { multiple: true } }}
              sx={{ minWidth: 200 }}
            >
              {freieGemeinden.map((g) => (
                <MenuItem key={g.id} value={g.id}>
                  {g.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Name des Blatts"
              size="small"
              value={name}
              onChange={(e) => setName(e.target.value)}
              sx={{ minWidth: 220 }}
            />
            <TextField
              label="Archiv-Adresse"
              size="small"
              value={archivUrl}
              onChange={(e) => setArchivUrl(e.target.value)}
              placeholder="https://…/archiv/"
              sx={{ minWidth: 280, flexGrow: 1 }}
            />
            <Button
              variant="contained"
              size="small"
              onClick={() => void anlegen()}
              disabled={
                laeuft ||
                gewaehlteGemeinden.length === 0 ||
                name.trim() === '' ||
                !/^https?:\/\//.test(archivUrl.trim())
              }
            >
              Erfassen
            </Button>
          </Stack>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Button size="small" onClick={() => void onPruefen()} disabled={laeuft || liest}>
              {liest ? 'Wird gelesen …' : 'Jetzt auf neue Ausgaben prüfen'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Läuft sonst täglich um 9 Uhr. Beim Erfassen wird die aktuellste Ausgabe geholt, alles Ältere
              bleibt liegen.
            </Typography>
          </Stack>
        </Stack>
      </Paper>

      {blaetter.length === 0 && !laedt && <Alert severity="info">Noch kein Wochenblatt erfasst.</Alert>}

      {blaetter.map((blatt) => {
        const ausgabe = blatt.ausgaben[0]
        return (
          <Paper key={blatt.id} sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
              >
                <Typography variant="h2" component="h2" sx={{ fontSize: '1.1rem' }}>
                  {blatt.name}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  {blatt.gemeinde !== null && (
                    <Chip size="small" variant="outlined" label={blatt.gemeinde.name} />
                  )}
                  {ausgabe !== undefined && (
                    <Chip size="small" label={AUSGABE_STATUS[ausgabe.status] ?? ausgabe.status} />
                  )}
                </Stack>
              </Stack>

              {ausgabe === undefined ? (
                <Typography variant="body2" color="text.secondary">
                  Noch keine Ausgabe geholt — der nächste Lauf nimmt die aktuellste aus dem Archiv.
                </Typography>
              ) : (
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      Ausgabe Nr. {ausgabe.nummer ?? ausgabe.schluessel}
                      {ausgabe.datum !== null && ` vom ${ausgabe.datum}`}
                      {ausgabe.seiten !== null && ` · ${ausgabe.seiten} Seiten`}
                    </Typography>
                    {ausgabe.pdf_url !== null && (
                      <Link
                        href={ausgabe.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="caption"
                      >
                        PDF öffnen
                      </Link>
                    )}
                    <Button
                      size="small"
                      onClick={() => void onInventar(ausgabe.id)}
                      disabled={laeuft || ausgabe.status === 'liest'}
                    >
                      Neu inventarisieren
                    </Button>
                  </Stack>

                  {ausgabe.fehler !== null && <Alert severity="error">{ausgabe.fehler}</Alert>}
                  {ausgabe.status === 'liest' && (
                    <Alert severity="info">
                      Die Ausgabe wird gerade gelesen — das dauert einige Minuten, die Ansicht aktualisiert
                      sich von selbst.
                    </Alert>
                  )}

                  {ausgabe.kandidaten.map((kandidat) => {
                    const meldung = nachKandidat.get(kandidat.id)
                    return (
                      <Box key={kandidat.id} sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
                        <Stack spacing={1}>
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}
                          >
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {kandidat.titel}
                              {kandidat.seite !== null && ` (S. ${kandidat.seite})`}
                            </Typography>
                            <Chip
                              size="small"
                              variant="outlined"
                              label={TYP_LABEL[kandidat.typ] ?? kandidat.typ}
                            />
                            {kandidat.frontseite && <Chip size="small" color="info" label="Front" />}
                            {kandidat.perle_vorschlag && (
                              <Chip size="small" color="secondary" label="Perle?" />
                            )}
                            {/* The per-piece municipality — only worth pixels
                                when the paper covers more than one. */}
                            {blatt.abdeckungen.length > 1 &&
                              (onGemeinde !== undefined ? (
                                <TextField
                                  select
                                  size="small"
                                  variant="standard"
                                  value={kandidat.gemeinde?.id ?? ''}
                                  onChange={(e) => void onGemeinde(kandidat.id, e.target.value)}
                                  disabled={laeuft}
                                  aria-label="Gemeinde des Beitrags"
                                  sx={{ minWidth: 110 }}
                                >
                                  {blatt.abdeckungen
                                    .filter((a) => a.gemeinde !== null)
                                    .map((a) => (
                                      <MenuItem key={a.gemeinde?.id} value={a.gemeinde?.id ?? ''}>
                                        {a.gemeinde?.name}
                                      </MenuItem>
                                    ))}
                                </TextField>
                              ) : (
                                kandidat.gemeinde !== null && (
                                  <Chip size="small" variant="outlined" label={kandidat.gemeinde.name} />
                                )
                              ))}
                          </Stack>
                          {kandidat.warum_exklusiv !== null && (
                            <Typography variant="caption" color="text.secondary">
                              {kandidat.warum_exklusiv}
                              {kandidat.perle_begruendung !== null &&
                                ` — Perle: ${kandidat.perle_begruendung}`}
                            </Typography>
                          )}
                          <Typography variant="body2">{kandidat.zusammenfassung}</Typography>

                          {kandidat.entscheid === 'abgelehnt' ? (
                            <Typography variant="caption" color="text.secondary">
                              Abgelehnt — {GRUND_LABEL[kandidat.ablehnungsgrund ?? ''] ?? 'ohne Grund'}
                              {kandidat.ablehnungskommentar !== null && `: ${kandidat.ablehnungskommentar}`}
                            </Typography>
                          ) : meldung !== undefined ? (
                            <MeldungKarte
                              meldung={meldung}
                              onChat={onChat}
                              onAktion={onAktion}
                              onPerlePublizieren={onPerlePublizieren}
                              laeuft={laeuft}
                            />
                          ) : (
                            <Stack direction="row" spacing={1}>
                              <Button
                                size="small"
                                variant="contained"
                                onClick={() => void onMeldung(kandidat.id)}
                                disabled={laeuft}
                              >
                                Meldung erzeugen
                              </Button>
                              <Button size="small" onClick={() => setAblehnung(kandidat)} disabled={laeuft}>
                                Ablehnen
                              </Button>
                            </Stack>
                          )}
                        </Stack>
                      </Box>
                    )
                  })}

                  {ausgabe.status === 'inventarisiert' && ausgabe.kandidaten.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      Keine exklusiven Beiträge in dieser Ausgabe gefunden.
                    </Typography>
                  )}
                </Stack>
              )}
            </Stack>
          </Paper>
        )
      })}

      {/* The rejection dialog — the reason is the learning signal, so it is
          asked for instead of being a bare delete. */}
      <Dialog open={ablehnung !== null} onClose={() => setAblehnung(null)} fullWidth maxWidth="xs">
        <DialogTitle>Kandidat ablehnen</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              {ablehnung?.titel}
            </Typography>
            <RadioGroup value={grund} onChange={(e) => setGrund(e.target.value)}>
              {GRUENDE.map((g) => (
                <FormControlLabel
                  key={g.wert}
                  value={g.wert}
                  control={<Radio size="small" />}
                  label={g.text}
                />
              ))}
            </RadioGroup>
            <TextField
              label="Kommentar (optional)"
              size="small"
              multiline
              minRows={2}
              value={kommentar}
              onChange={(e) => setKommentar(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAblehnung(null)}>Abbrechen</Button>
          <Button variant="contained" onClick={() => void ablehnen()} disabled={laeuft}>
            Ablehnen
          </Button>
        </DialogActions>
      </Dialog>

      {/* The lead verdict dialog — "war das ein Recherchehinweis?" is the
          learning signal, the optional comment its reasoning. */}
      <Dialog open={urteil !== null} onClose={() => setUrteil(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {urteil?.brauchbar === true ? 'Als brauchbare Fährte bestätigen' : 'Als «kein Hinweis» ablegen'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              {urteil?.hinweis.titel}
            </Typography>
            <TextField
              label="Kommentar (optional, hilft dem Lernen)"
              size="small"
              multiline
              minRows={2}
              value={urteilKommentar}
              onChange={(e) => setUrteilKommentar(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUrteil(null)}>Abbrechen</Button>
          <Button variant="contained" onClick={() => void beurteilen()} disabled={laeuft}>
            Speichern
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
