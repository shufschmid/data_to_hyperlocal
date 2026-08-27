'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
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
  WochenblattFelder
} from '@/graphql/redaktion'
import { bleibtAufDemTisch, seitenLink } from '@/lib/redaktion'
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

/**
 * Checking a proposal must not require opening the PDF: the page's own text
 * layer sits in a collapsible box under it. The summary above stays what it
 * is — a summary; verified is only ever the original. Shared with the
 * Chefredaktion desk, where a lead carries its page text itself.
 */
export function Originaltext({ text, seite }: { text: string | null; seite: number | null }) {
  const [offen, setOffen] = useState(false)
  if (text === null || seite === null) return null

  return (
    <Box>
      <Button size="small" variant="text" onClick={() => setOffen((o) => !o)} sx={{ px: 0 }}>
        {offen ? 'Originaltext verbergen' : `Originaltext lesen (S. ${seite})`}
      </Button>
      {/* unmountOnExit: a 24-page text layer has no business in the DOM
          while the box is closed. */}
      <Collapse in={offen} unmountOnExit>
        <Box
          sx={{
            maxHeight: 280,
            overflowY: 'auto',
            bgcolor: 'action.hover',
            borderRadius: 1,
            p: 1.5,
            whiteSpace: 'pre-wrap'
          }}
        >
          <Typography variant="body2" component="div">
            {text}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  )
}

export interface PresseschauProps {
  blaetter: readonly WochenblattFelder[]
  gemeinden: readonly GemeindeFelder[]
  meldungen: readonly AlleMeldungFelder[]
  laedt?: boolean
  laeuft?: boolean
  onAnlegen: (eingabe: { gemeinden: string[]; name: string; archiv_url: string }) => Promise<void>
  onPruefen: () => Promise<void>
  onInventar: (ausgabeId: string) => Promise<void>
  onMeldung: (kandidatId: string) => Promise<void>
  onAblehnen: (kandidatId: string, grund: string, kommentar: string) => Promise<void>
  /** Gute Meldung, aber heute nicht verifizierbar — wandert als Fährte auf den Chefredaktions-Tisch. */
  onWeiterreichen: (kandidatId: string, begruendung: string) => Promise<void>
  onGemeinde?: (kandidatId: string, gemeindeId: string) => Promise<void>
  onChat: (id: string, anweisung: string) => Promise<void>
  onAktion: (id: string, aktion: MeldungAktion) => Promise<void>
}

export function Presseschau({
  blaetter,
  gemeinden,
  meldungen,
  laedt = false,
  laeuft = false,
  onAnlegen,
  onPruefen,
  onInventar,
  onMeldung,
  onAblehnen,
  onWeiterreichen,
  onGemeinde,
  onChat,
  onAktion
}: PresseschauProps) {
  const [gewaehlteGemeinden, setGewaehlteGemeinden] = useState<string[]>([])
  const [name, setName] = useState('')
  const [archivUrl, setArchivUrl] = useState('')
  const [ablehnung, setAblehnung] = useState<KandidatFelder | null>(null)
  const [grund, setGrund] = useState('nicht_relevant')
  const [kommentar, setKommentar] = useState('')
  const [weitergabe, setWeitergabe] = useState<KandidatFelder | null>(null)
  const [weitergabeGrund, setWeitergabeGrund] = useState('')

  // A municipality already covered by some paper is not offered again.
  const freieGemeinden = useMemo(() => {
    const belegt = new Set<string | undefined>()
    for (const blatt of blaetter) {
      belegt.add(blatt.gemeinde?.id)
      for (const a of blatt.abdeckungen) belegt.add(a.gemeinde?.id)
    }
    return gemeinden.filter((g) => !belegt.has(g.id))
  }, [blaetter, gemeinden])

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

  async function weiterreichen() {
    if (weitergabe === null) return
    await onWeiterreichen(weitergabe.id, weitergabeGrund.trim())
    setWeitergabe(null)
    setWeitergabeGrund('')
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
        // Der Tisch zeigt Arbeit, nicht Geschichte: Erledigtes — publiziert,
        // verworfen, abgelehnt, weitergereicht — verschwindet sofort. Die
        // Zeilen bleiben in der Datenbank als Gedächtnis des Inventars.
        const aufDemTisch = (ausgabe?.kandidaten ?? []).filter((k) =>
          bleibtAufDemTisch(k.entscheid, nachKandidat.get(k.id)?.status ?? null)
        )
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

                  {aufDemTisch.map((kandidat) => {
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
                              {kandidat.seite !== null &&
                                (ausgabe.pdf_url !== null ? (
                                  <>
                                    {' '}
                                    <Link
                                      href={seitenLink(ausgabe.pdf_url, kandidat.seite)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      (S. {kandidat.seite})
                                    </Link>
                                  </>
                                ) : (
                                  ` (S. ${kandidat.seite})`
                                ))}
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
                                when the paper covers more than one. Correctable
                                only WHILE the candidate is open: once a Meldung
                                exists it carries the municipality itself (its
                                card says so), and changing the candidate would
                                no longer move it. */}
                            {blatt.abdeckungen.length > 1 &&
                              meldung === undefined &&
                              (onGemeinde !== undefined && kandidat.entscheid === 'offen' ? (
                                <TextField
                                  select
                                  size="small"
                                  variant="standard"
                                  value={kandidat.gemeinde?.id ?? ''}
                                  onChange={(e) => void onGemeinde(kandidat.id, e.target.value)}
                                  disabled={laeuft}
                                  // The name must sit on the element carrying the
                                  // combobox role — a plain aria-label on the
                                  // TextField never reaches it.
                                  slotProps={{
                                    select: {
                                      SelectDisplayProps: { 'aria-label': 'Gemeinde des Beitrags' }
                                    }
                                  }}
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
                          <Originaltext
                            text={
                              kandidat.seite === null
                                ? null
                                : (ausgabe.seiten_texte?.[kandidat.seite - 1] ?? null)
                            }
                            seite={kandidat.seite}
                          />

                          {meldung !== undefined ? (
                            <MeldungKarte
                              meldung={meldung}
                              onChat={onChat}
                              onAktion={onAktion}
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
                              <Button size="small" onClick={() => setWeitergabe(kandidat)} disabled={laeuft}>
                                An Chefredaktion
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
                  {ausgabe.status === 'inventarisiert' &&
                    ausgabe.kandidaten.length > 0 &&
                    aufDemTisch.length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        Alle Vorschläge dieser Ausgabe sind bearbeitet — der Tisch ist leer.
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

      {/* The handover dialog — a good piece the desk cannot verify today goes
          to the Chefredaktion as a lead instead of being rejected. */}
      <Dialog open={weitergabe !== null} onClose={() => setWeitergabe(null)} fullWidth maxWidth="xs">
        <DialogTitle>An die Chefredaktion weiterreichen</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              {weitergabe?.titel}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Für gute Ansätze, die zuerst verifiziert oder fertig recherchiert werden müssen — landet als
              Recherche-Hinweis auf dem Chefredaktions-Tisch.
            </Typography>
            <TextField
              label="Begründung (optional)"
              size="small"
              multiline
              minRows={2}
              value={weitergabeGrund}
              onChange={(e) => setWeitergabeGrund(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWeitergabe(null)}>Abbrechen</Button>
          <Button variant="contained" onClick={() => void weiterreichen()} disabled={laeuft}>
            Weiterreichen
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
