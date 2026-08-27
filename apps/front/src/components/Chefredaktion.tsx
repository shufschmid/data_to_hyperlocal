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
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { PerleFelder, RecherchehinweisFelder } from '@/graphql/redaktion'
import { seitenLink } from '@/lib/redaktion'
import { Originaltext } from './Presseschau'

// The chief editor's desk: everything that is NOT the everyday take-or-reject
// loop of the weekly-paper tab. Two piles, both staying put until she decides
// — they deliberately survive new issues:
//
// - Recherche-Hinweise: leads for the newsroom's own reporting, proposed by
//   the inventory (Leserbriefe etc.) or handed over by the editor. Never
//   published unchecked; her verdict is the learning signal.
// - Perlen: candidates the inventory found curious enough for the city. Her
//   verdict lives on the CANDIDATE — independent of whether a Meldung ever
//   comes of it; a published one gets a copy of the verdict for downstream.

function blattZeile(ausgabe: { nummer: string | null; wochenblatt: { name: string } | null }): string {
  return [ausgabe.wochenblatt?.name, ausgabe.nummer === null ? null : `Nr. ${ausgabe.nummer}`]
    .filter((t) => t != null && t !== '')
    .join(' ')
}

export interface ChefredaktionProps {
  hinweise: readonly RecherchehinweisFelder[]
  perlen: readonly PerleFelder[]
  laeuft?: boolean
  onHinweisUrteil: (hinweisId: string, brauchbar: boolean, kommentar: string) => Promise<void>
  onPerle: (kandidatId: string, perle: boolean) => Promise<void>
}

export function Chefredaktion({
  hinweise,
  perlen,
  laeuft = false,
  onHinweisUrteil,
  onPerle
}: ChefredaktionProps) {
  const [urteil, setUrteil] = useState<{
    hinweis: RecherchehinweisFelder
    brauchbar: boolean
  } | null>(null)
  const [urteilKommentar, setUrteilKommentar] = useState('')

  const offeneHinweise = useMemo(() => hinweise.filter((h) => h.status === 'offen'), [hinweise])

  async function beurteilen() {
    if (urteil === null) return
    await onHinweisUrteil(urteil.hinweis.id, urteil.brauchbar, urteilKommentar.trim())
    setUrteil(null)
    setUrteilKommentar('')
  }

  return (
    <Stack spacing={2}>
      {offeneHinweise.length === 0 && perlen.length === 0 && (
        <Alert severity="success">Der Tisch ist leer — keine offenen Fährten, keine Perlen-Entscheide.</Alert>
      )}

      {perlen.length > 0 && (
        <Paper sx={{ p: 2, borderLeft: 4, borderColor: 'secondary.main' }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2">Perlen-Entscheide ({perlen.length} offen)</Typography>
            <Typography variant="caption" color="text.secondary">
              Beiträge, die das Inventar für überörtlich kurios hält — Perle heisst: auch die Stadt will die
              Geschichte. Der Entscheid gilt dem Beitrag selbst, unabhängig davon, ob daraus eine Meldung
              wird.
            </Typography>
            {perlen.map((p) => (
              <Box key={p.id} sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}>
                <Stack spacing={0.5}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {p.titel}
                    </Typography>
                    {p.gemeinde !== null && <Chip size="small" variant="outlined" label={p.gemeinde.name} />}
                    {p.ausgabe !== null &&
                      (p.ausgabe.pdf_url !== null ? (
                        <Link
                          href={seitenLink(p.ausgabe.pdf_url, p.seite)}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="caption"
                        >
                          {blattZeile(p.ausgabe)}
                          {p.seite !== null && `, S. ${p.seite}`}
                        </Link>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {blattZeile(p.ausgabe)}
                        </Typography>
                      ))}
                  </Stack>
                  {p.zusammenfassung !== null && <Typography variant="body2">{p.zusammenfassung}</Typography>}
                  {p.perle_begruendung !== null && (
                    <Typography variant="caption" color="text.secondary">
                      Perle, weil: {p.perle_begruendung}
                    </Typography>
                  )}
                  <Originaltext
                    text={p.seite === null ? null : (p.ausgabe?.seiten_texte?.[p.seite - 1] ?? null)}
                    seite={p.seite}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant="contained"
                      color="secondary"
                      onClick={() => void onPerle(p.id, true)}
                      disabled={laeuft}
                    >
                      Als Perle markieren
                    </Button>
                    <Button size="small" onClick={() => void onPerle(p.id, false)} disabled={laeuft}>
                      Keine Perle
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            ))}
          </Stack>
        </Paper>
      )}

      {offeneHinweise.length > 0 && (
        <Paper sx={{ p: 2, borderLeft: 4, borderColor: 'warning.main' }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2">Recherche-Hinweise ({offeneHinweise.length} offen)</Typography>
            {offeneHinweise.map((h) => {
              const pdfUrl = h.ausgabe?.pdf_url ?? null
              return (
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
                      {h.gemeinde !== null && (
                        <Chip size="small" variant="outlined" label={h.gemeinde.name} />
                      )}
                      {h.ausgabe !== null &&
                        (pdfUrl !== null ? (
                          <Link
                            href={seitenLink(pdfUrl, h.seite)}
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="caption"
                          >
                            {blattZeile(h.ausgabe)}
                            {h.seite !== null && `, S. ${h.seite}`}
                          </Link>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            {blattZeile(h.ausgabe)}
                          </Typography>
                        ))}
                    </Stack>
                    {h.fundort !== null && (
                      <Typography variant="caption" color="text.secondary">
                        {h.fundort}
                      </Typography>
                    )}
                    {h.begruendung !== null && <Typography variant="body2">{h.begruendung}</Typography>}
                    <Originaltext text={h.quelltext} seite={h.seite} />
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
                  </Stack>
                </Box>
              )
            })}
          </Stack>
        </Paper>
      )}

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
