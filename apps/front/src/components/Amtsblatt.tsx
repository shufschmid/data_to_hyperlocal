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
import Divider from '@mui/material/Divider'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ArticleOutlined from '@mui/icons-material/ArticleOutlined'
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined'
import MapOutlined from '@mui/icons-material/MapOutlined'
import type { AmtsblattFelder, GemeindeFelder } from '@/graphql/redaktion'
import {
  ABLEHNUNGSGRUENDE,
  GRUPPEN,
  datumText,
  gruppenText,
  kannUnterlagenLesen,
  karte,
  ohnePlz,
  planStatusText,
  tageBisFrist,
  tisch,
  unterlage,
  unterlagenText,
  type Filter
} from '@/lib/amtsblatt'

export interface AmtsblattProps {
  eintraege: AmtsblattFelder[]
  gemeinden: GemeindeFelder[]
  heute: string
  laeuft?: boolean
  onLauf?: () => Promise<void> | void
  onUebernehmen?: (id: string) => Promise<void> | void
  onAblehnen?: (id: string, grund: string, kommentar: string | null) => Promise<void> | void
  onWeiterreichen?: (id: string, begruendung: string | null) => Promise<void> | void
  onUnterlagen?: (id: string) => Promise<void> | void
}

/**
 * The official gazette desk.
 *
 * Deliberately a DESK and not an archive, like the press review: three
 * decisions per row, and a decided row leaves the view. What is different here
 * is the fourth button — the documents. Baselland publishes its building plans
 * as plain images, and the run already looked at them for what it proposed; for
 * everything else the editor gets the link (so she can check herself) and a
 * button that reads them and folds the findings into the article.
 */
export function Amtsblatt({
  eintraege,
  gemeinden,
  heute,
  laeuft = false,
  onLauf,
  onUebernehmen,
  onAblehnen,
  onWeiterreichen,
  onUnterlagen
}: AmtsblattProps) {
  const [filter, setFilter] = useState<Filter>({
    gemeinde: null,
    gruppe: null,
    suche: ''
  })
  const [uebrigeOffen, setUebrigeOffen] = useState(false)
  const [ablehnung, setAblehnung] = useState<AmtsblattFelder | null>(null)
  const [grund, setGrund] = useState('nicht_relevant')
  const [kommentar, setKommentar] = useState('')
  const [beschaeftigt, setBeschaeftigt] = useState<string | null>(null)

  const { vorschlaege, uebrige } = useMemo(() => tisch(eintraege, filter), [eintraege, filter])
  const fehlendePlz = useMemo(() => ohnePlz(gemeinden), [gemeinden])
  const aktive = useMemo(() => gemeinden.filter((g) => g.aktiv), [gemeinden])

  async function fuehreAus(id: string, tun: () => Promise<void> | void) {
    setBeschaeftigt(id)
    try {
      await tun()
    } finally {
      setBeschaeftigt(null)
    }
  }

  function Zeile({ eintrag }: { eintrag: AmtsblattFelder }) {
    const [offen, setOffen] = useState(false)
    const doku = unterlage(eintrag)
    const lage = karte(eintrag)
    const tage = tageBisFrist(eintrag.frist, heute)
    const befunde = eintrag.planbefunde ?? []

    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Chip size="small" label={eintrag.gemeinde?.name ?? '—'} />
            <Chip size="small" variant="outlined" label={gruppenText(eintrag.gruppe)} />
            {eintrag.rubrik_name !== null && (
              <Chip size="small" variant="outlined" label={eintrag.rubrik_name} />
            )}
            {tage !== null && (
              <Chip
                size="small"
                color={tage < 0 ? 'default' : tage <= 7 ? 'error' : 'warning'}
                label={
                  tage < 0
                    ? `Frist abgelaufen (${datumText(eintrag.frist)})`
                    : `Frist: ${datumText(eintrag.frist)}`
                }
              />
            )}
          </Stack>

          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {eintrag.titel}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {[eintrag.amt, datumText(eintrag.publiziert_am)].filter((t) => t).join(' · ')}
          </Typography>

          {eintrag.vorschlag_begruendung !== null && (
            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
              {eintrag.vorschlag_begruendung}
            </Typography>
          )}

          {/* The links stay whatever we can or cannot read — the editor checks
              for herself, and that is the point of showing them. */}
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
            {eintrag.pdf_url !== null && (
              <Link
                href={eintrag.pdf_url}
                target="_blank"
                rel="noopener"
                variant="body2"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
              >
                <ArticleOutlined fontSize="inherit" /> Amtliche Publikation
              </Link>
            )}
            {doku !== null && (
              <Link
                href={doku.url}
                target="_blank"
                rel="noopener"
                variant="body2"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
              >
                <DescriptionOutlined fontSize="inherit" /> {unterlagenText(doku.art)}
              </Link>
            )}
            {lage !== null && (
              <Link
                href={lage}
                target="_blank"
                rel="noopener"
                variant="body2"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
              >
                <MapOutlined fontSize="inherit" /> Lage
              </Link>
            )}
          </Stack>

          {eintrag.plan_status === 'liest' && (
            <Alert severity="info">
              Die Unterlagen werden gelesen — das dauert ein bis zwei Minuten. Die Ansicht aktualisiert sich
              von selbst.
            </Alert>
          )}

          {befunde.length > 0 && (
            <Box>
              <Button size="small" onClick={() => setOffen((o) => !o)}>
                {offen
                  ? 'Befunde aus den Unterlagen ausblenden'
                  : `Was in den Unterlagen steht (${befunde.length})`}
              </Button>
              <Collapse in={offen} unmountOnExit>
                <Stack spacing={1} sx={{ mt: 1, pl: 1, borderLeft: 3, borderColor: 'divider' }}>
                  {eintrag.plan_fazit !== null && (
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {eintrag.plan_fazit}
                    </Typography>
                  )}
                  {befunde.map((b, i) => (
                    <Typography key={i} variant="body2" color="text.secondary">
                      · {b}
                    </Typography>
                  ))}
                </Stack>
              </Collapse>
            </Box>
          )}

          <Divider />

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Button
              size="small"
              variant="contained"
              disabled={beschaeftigt === eintrag.id}
              onClick={() => fuehreAus(eintrag.id, () => onUebernehmen?.(eintrag.id))}
            >
              Meldung schreiben
            </Button>
            {kannUnterlagenLesen(eintrag) && (
              <Button
                size="small"
                variant="outlined"
                disabled={beschaeftigt === eintrag.id}
                onClick={() => fuehreAus(eintrag.id, () => onUnterlagen?.(eintrag.id))}
              >
                Unterlagen lesen und einbeziehen
              </Button>
            )}
            <Button
              size="small"
              disabled={beschaeftigt === eintrag.id}
              onClick={() => {
                setAblehnung(eintrag)
                setGrund('nicht_relevant')
                setKommentar('')
              }}
            >
              Ablehnen
            </Button>
            <Button
              size="small"
              disabled={beschaeftigt === eintrag.id}
              onClick={() => fuehreAus(eintrag.id, () => onWeiterreichen?.(eintrag.id, null))}
            >
              An Chefredaktion
            </Button>
            {eintrag.plan_status !== 'offen' && eintrag.plan_status !== 'gelesen' && (
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                {planStatusText(eintrag.plan_status)}
              </Typography>
            )}
          </Stack>
        </Stack>
      </Paper>
    )
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Amtliche Publikationen
        </Typography>
        <Button variant="outlined" disabled={laeuft} onClick={() => onLauf?.()}>
          {laeuft ? 'Läuft …' : 'Jetzt prüfen'}
        </Button>
      </Stack>

      {fehlendePlz.length > 0 && (
        <Alert severity="warning">
          Ohne Postleitzahl bleiben Handelsregister, Konkurse und Betreibungen unsichtbar — das Portal führt
          sie über die Adresse, nicht über die BFS-Nummer. Betroffen:{' '}
          {fehlendePlz.map((g) => g.name).join(', ')}. Nachtragen im Reiter „Gemeinden“.
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
        <TextField
          select
          size="small"
          label="Gemeinde"
          value={filter.gemeinde ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, gemeinde: e.target.value === '' ? null : e.target.value }))
          }
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Alle Gemeinden</MenuItem>
          {aktive.map((g) => (
            <MenuItem key={g.id} value={g.id}>
              {g.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Art"
          value={filter.gruppe ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, gruppe: e.target.value === '' ? null : e.target.value }))
          }
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">Alle Arten</MenuItem>
          {GRUPPEN.map((g) => (
            <MenuItem key={g.wert} value={g.wert}>
              {g.text}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Suche"
          value={filter.suche}
          onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
          sx={{ minWidth: 200 }}
        />
      </Stack>

      {vorschlaege.length === 0 && uebrige.length === 0 ? (
        <Alert severity="info">
          Nichts auf dem Tisch. Der nächste Lauf holt, was seither publiziert wurde.
        </Alert>
      ) : (
        <>
          <Typography variant="subtitle2" color="text.secondary">
            {vorschlaege.length === 0
              ? 'Kein Vorschlag — die Sichtung hielt heute nichts für berichtenswert.'
              : `${vorschlaege.length} vorgeschlagen`}
          </Typography>
          <Stack spacing={2}>
            {vorschlaege.map((e) => (
              <Zeile key={e.id} eintrag={e} />
            ))}
          </Stack>

          {uebrige.length > 0 && (
            <Box>
              <Button onClick={() => setUebrigeOffen((o) => !o)}>
                {uebrigeOffen
                  ? 'Übrige ausblenden'
                  : `Übrige ${uebrige.length} anzeigen — nichts wird weggeworfen`}
              </Button>
              <Collapse in={uebrigeOffen} unmountOnExit>
                <Stack spacing={2} sx={{ mt: 2 }}>
                  {uebrige.map((e) => (
                    <Zeile key={e.id} eintrag={e} />
                  ))}
                </Stack>
              </Collapse>
            </Box>
          )}
        </>
      )}

      <Dialog open={ablehnung !== null} onClose={() => setAblehnung(null)} fullWidth maxWidth="sm">
        <DialogTitle>Publikation ablehnen</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {ablehnung?.titel}
            </Typography>
            {/* The reason is the learning signal: it rides into the next
                triage for this municipality as a negative example. */}
            <TextField select label="Grund" value={grund} onChange={(e) => setGrund(e.target.value)}>
              {ABLEHNUNGSGRUENDE.map((g) => (
                <MenuItem key={g.wert} value={g.wert}>
                  {g.text}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Kommentar"
              value={kommentar}
              onChange={(e) => setKommentar(e.target.value)}
              multiline
              minRows={2}
              helperText="Wird der nächsten Sichtung als Beispiel mitgegeben."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAblehnung(null)}>Abbrechen</Button>
          <Button
            variant="contained"
            onClick={() => {
              const eintrag = ablehnung
              setAblehnung(null)
              if (eintrag !== null) {
                void fuehreAus(eintrag.id, () =>
                  onAblehnen?.(eintrag.id, grund, kommentar.trim() === '' ? null : kommentar.trim())
                )
              }
            }}
          >
            Ablehnen
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
