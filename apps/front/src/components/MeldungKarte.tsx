'use client'

import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { MeldungFelder } from '@/graphql/redaktion'
import { pruefsiegelText, statusFarbe, statusText, warnungen } from '@/lib/redaktion'
import { hatRevision } from '@/lib/revision'
import { langesDatum } from '@/lib/entsorgung'
import { Artikeltext } from './Artikeltext'

// One article. Presentational: props in, callbacks out, so it can be tested
// without a network or a router.

export type MeldungAktion = 'publizieren' | 'pruefung' | 'verwerfen' | 'freigeben'

/** What a status action may carry — today only the optional reason for discarding. */
export interface MeldungAktionKoerper {
  kommentar?: string
}

export interface MeldungKarteProps {
  meldung: MeldungFelder
  onChat: (id: string, anweisung: string) => Promise<void>
  onAktion: (id: string, aktion: MeldungAktion, koerper?: MeldungAktionKoerper) => Promise<void>
  laeuft?: boolean
  /**
   * The newsletter day of a waste-collection reminder.
   *
   * When set, the card approves instead of publishing: the reminder is written
   * weeks ahead and has to go out on one specific day, so the scheduled run
   * publishes it the evening before. Publishing it by hand now would put "am
   * Freitag ist Papierabfuhr" in front of readers in September.
   */
  erscheintAm?: string | null
  /**
   * Offer "publish now" beside the approval — only for the reminders that are
   * actually next in line. Publishing weeks early would put a reminder into the
   * wrong newsletter, which is why it is not the default.
   */
  sofortPublizierbar?: boolean
  /**
   * Verkleinert, fuer die Karte IN einer Liste: der Sport-Reiter zeigt Gemeinde
   * und Status schon als Chips auf der Spielzeile, also faellt der Kopf weg und
   * die Karte rueckt enger zusammen. Chat und Aktionen bleiben vollstaendig.
   */
  kompakt?: boolean
}

export function MeldungKarte({
  meldung,
  onChat,
  onAktion,
  laeuft = false,
  erscheintAm = null,
  sofortPublizierbar = false,
  kompakt = false
}: MeldungKarteProps) {
  const [anweisung, setAnweisung] = useState('')
  const [verwerfen, setVerwerfen] = useState(false)
  const [verwerfungsgrund, setVerwerfungsgrund] = useState('')

  async function verwerfenBestaetigen() {
    const grund = verwerfungsgrund.trim()
    setVerwerfen(false)
    setVerwerfungsgrund('')
    await onAktion(meldung.id, 'verwerfen', grund === '' ? undefined : { kommentar: grund })
  }
  const [offen, setOffen] = useState(false)
  const [sendet, setSendet] = useState(false)

  const beschaeftigt = laeuft || meldung.verarbeitung === 'geplant' || meldung.verarbeitung === 'laeuft'
  const hinweise = warnungen(meldung)
  // Nur auf publizierten Karten, und auch dort klein: die Warnungen selbst
  // stehen schon oben im Kasten, hier steht, wer unterschrieben hat.
  const siegel = pruefsiegelText(meldung)
  // Der lauteste Hinweis auf dieser Karte: der Beitrag ist publiziert, und die
  // Quelle hat seine Zahlen seither korrigiert.
  const revidiert = hatRevision(meldung)

  async function schicken() {
    if (anweisung.trim() === '') return
    setSendet(true)
    try {
      await onChat(meldung.id, anweisung.trim())
      setAnweisung('')
      setOffen(false)
    } finally {
      setSendet(false)
    }
  }

  return (
    <Paper sx={{ p: kompakt ? 2 : 3 }} variant={kompakt ? 'outlined' : 'elevation'}>
      <Stack spacing={kompakt ? 1.5 : 2}>
        {kompakt ? (
          (beschaeftigt || siegel !== null) && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {beschaeftigt && (
                <>
                  <CircularProgress size={14} />
                  <Typography variant="caption" color="text.secondary">
                    Wird überarbeitet …
                  </Typography>
                </>
              )}
              {revidiert && <Chip size="small" color="error" label="Zahlen revidiert" />}
              {siegel !== null && (
                <Chip
                  size="small"
                  variant="outlined"
                  color={hinweise.length === 0 ? 'success' : 'warning'}
                  label={siegel}
                />
              )}
            </Stack>
          )
        ) : (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h2" component="h2" sx={{ fontSize: '1.1rem' }}>
              {meldung.gemeinde?.name ?? 'Ohne Gemeinde'}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {beschaeftigt && <CircularProgress size={16} />}
              {revidiert && <Chip size="small" color="error" label="Zahlen revidiert" />}
              {siegel !== null && (
                <Chip
                  size="small"
                  variant="outlined"
                  color={hinweise.length === 0 ? 'success' : 'warning'}
                  label={siegel}
                />
              )}
              <Chip size="small" label={statusText(meldung.status)} color={statusFarbe(meldung.status)} />
            </Stack>
          </Stack>
        )}

        {/* Ueber allen Warnungen, weil er als einziger einen Beitrag betrifft,
            der schon draussen ist. Einklappbar, weil er lang ist und die Karte
            sonst nichts anderes mehr zeigt. */}
        {revidiert && (
          <Alert severity="error">
            <details>
              <summary style={{ cursor: 'pointer' }}>Die Quelle hat ihre Zahlen revidiert</summary>
              <Box sx={{ mt: 1 }}>{meldung.revision_hinweis}</Box>
            </details>
          </Alert>
        )}

        {/* Warnings sit above the text, because the point of them is to be seen
            before the article is judged. */}
        {hinweise.length > 0 && (
          <Alert severity="warning">
            {hinweise.map((h, i) => (
              <Box key={i}>{h}</Box>
            ))}
          </Alert>
        )}

        {meldung.titel === null ? (
          <Typography variant="body2" color="text.secondary">
            Wird geschrieben …
          </Typography>
        ) : (
          <>
            <Typography
              variant="h3"
              component="h3"
              sx={{ fontSize: kompakt ? '0.95rem' : '1rem', fontWeight: 700 }}
            >
              {meldung.titel}
            </Typography>
            {/* Ein Spielbericht hat bewusst keinen Lead — dann auch kein leeres
                Element, das nur Abstand kostet. */}
            {meldung.lead !== null && meldung.lead.trim() !== '' && (
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                {meldung.lead}
              </Typography>
            )}
            <Artikeltext text={meldung.text} abstand={0} />
          </>
        )}

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button size="small" onClick={() => setOffen((o) => !o)} disabled={beschaeftigt}>
            Überarbeiten
          </Button>
          <Button
            size="small"
            onClick={() => void onAktion(meldung.id, 'pruefung')}
            disabled={beschaeftigt || meldung.titel === null}
          >
            Gegenlesen lassen
          </Button>
          {erscheintAm === null ? (
            <Button
              size="small"
              variant="contained"
              onClick={() => void onAktion(meldung.id, 'publizieren')}
              disabled={beschaeftigt || meldung.titel === null}
            >
              Publizieren
            </Button>
          ) : (
            <>
              <Button
                size="small"
                variant="contained"
                onClick={() => void onAktion(meldung.id, 'freigeben')}
                disabled={beschaeftigt || meldung.titel === null}
              >
                Freigeben
              </Button>
              {sofortPublizierbar && (
                <Button
                  size="small"
                  onClick={() => void onAktion(meldung.id, 'publizieren')}
                  disabled={beschaeftigt || meldung.titel === null}
                >
                  Jetzt publizieren
                </Button>
              )}
            </>
          )}
          <Button size="small" color="inherit" onClick={() => setVerwerfen(true)} disabled={beschaeftigt}>
            Verwerfen
          </Button>
        </Stack>

        {/* Discarding stays one decision, but it may carry a reason: an article
            rejected as prose is a lesson for the desk it came from, and this was
            the one decision with no channel for it. Optional — Enter discards. */}
        <Dialog open={verwerfen} onClose={() => setVerwerfen(false)} fullWidth maxWidth="xs">
          <DialogTitle>Meldung verwerfen</DialogTitle>
          <DialogContent>
            <Stack spacing={1} sx={{ mt: 1 }}>
              <TextField
                label="Warum? (optional, hilft dem Lernen)"
                size="small"
                multiline
                minRows={2}
                autoFocus
                value={verwerfungsgrund}
                onChange={(e) => setVerwerfungsgrund(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void verwerfenBestaetigen()
                  }
                }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setVerwerfen(false)}>Abbrechen</Button>
            <Button variant="contained" color="inherit" onClick={() => void verwerfenBestaetigen()}>
              Verwerfen
            </Button>
          </DialogActions>
        </Dialog>

        {erscheintAm !== null && (
          <Typography variant="caption" color="text.secondary">
            Erscheint am {langesDatum(erscheintAm)} · der Tageslauf publiziert sie am Vortag um 12 Uhr, wenn
            sie bis dann freigegeben ist
          </Typography>
        )}

        {offen && (
          <Stack spacing={1}>
            <TextField
              label="Was soll anders werden?"
              multiline
              minRows={2}
              size="small"
              value={anweisung}
              onChange={(e) => setAnweisung(e.target.value)}
              disabled={sendet}
            />
            <Box>
              <Button
                size="small"
                variant="contained"
                onClick={() => void schicken()}
                disabled={sendet || anweisung.trim() === ''}
              >
                Anweisung schicken
              </Button>
            </Box>
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}
