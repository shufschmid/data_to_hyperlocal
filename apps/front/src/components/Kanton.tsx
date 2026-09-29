'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
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
import type { AlleMeldungFelder, GemeindeFelder, KantonsmitteilungFelder } from '@/graphql/redaktion'
import type { TerminEingabe } from '@/lib/termin'
import { MeldungKarte, type MeldungAktion, type MeldungAktionKoerper } from './MeldungKarte'
import { Originaltext } from './Presseschau'
import {
  ABLEHNUNGSGRUENDE,
  datumText,
  laufText,
  meldungJeMitteilung,
  publizierbare,
  quelleText,
  tisch,
  weitereGemeinden,
  type Filter,
  type KantonLaufStatus
} from '@/lib/kanton'

export interface KantonProps {
  eintraege: KantonsmitteilungFelder[]
  gemeinden: GemeindeFelder[]
  /** Alle Meldungen — die uebernommenen werden hier redigiert, nicht anderswo. */
  meldungen?: readonly AlleMeldungFelder[]
  heute: string
  laeuft?: boolean
  /** Der von Hand gestartete Lauf, solange der Server ihn kennt: unterwegs, oder was der letzte brachte. */
  lauf?: KantonLaufStatus | null
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion, koerper?: MeldungAktionKoerper) => Promise<void>
  /** Der Termin der Meldung fuer den Dorfkoenig — siehe `MeldungKarte`. */
  onTermin?: (id: string, eingabe: TerminEingabe) => Promise<void>
  onLauf?: () => Promise<void> | void
  onUebernehmen?: (id: string) => Promise<void> | void
  onAblehnen?: (id: string, grund: string, kommentar: string | null) => Promise<void> | void
  onWeiterreichen?: (id: string, begruendung: string | null) => Promise<void> | void
  /** Publiziert alle geschriebenen Meldungen dieses Tischs auf einen Griff. */
  onAllePublizieren?: () => Promise<void> | void
}

/**
 * The Kanton desk: what the canton and its police say ABOUT a municipality.
 *
 * A DESK like the municipal one — three decisions per row, a decided row
 * leaves the view, the run's draft is edited here. What a row carries is the
 * notice's whole wording, read through the canton's data door; the public
 * page is linked and never fetched. One notice naming three municipalities is
 * three rows, and each row says which others it names.
 */
export function Kanton({
  eintraege,
  gemeinden,
  meldungen = [],
  heute,
  laeuft = false,
  lauf = null,
  onChat,
  onAktion,
  onTermin,
  onLauf,
  onUebernehmen,
  onAblehnen,
  onWeiterreichen,
  onAllePublizieren
}: KantonProps) {
  const [filter, setFilter] = useState<Filter>({ gemeinde: null, suche: '' })
  const [uebrigeOffen, setUebrigeOffen] = useState(false)
  const [ablehnung, setAblehnung] = useState<KantonsmitteilungFelder | null>(null)
  const [grund, setGrund] = useState('nicht_relevant')
  const [kommentar, setKommentar] = useState('')
  const [weitergabe, setWeitergabe] = useState<KantonsmitteilungFelder | null>(null)
  const [begruendung, setBegruendung] = useState('')
  const [beschaeftigt, setBeschaeftigt] = useState<string | null>(null)

  const meldungZu = useMemo(() => meldungJeMitteilung(meldungen), [meldungen])
  const statusJeMitteilung = useMemo(
    () => new Map([...meldungZu].map(([id, m]) => [id, m.status] as const)),
    [meldungZu]
  )
  const { vorschlaege, uebrige } = useMemo(
    () => tisch(eintraege, filter, statusJeMitteilung, heute),
    [eintraege, filter, statusJeMitteilung, heute]
  )
  const aktive = useMemo(() => gemeinden.filter((g) => g.aktiv), [gemeinden])
  // Die Zahl auf dem Knopf und das, was er tut, sind dieselbe Menge.
  const fertige = useMemo(() => publizierbare(meldungen), [meldungen])
  const unterwegs = lauf?.laeuft === true
  const laufHinweis = lauf === null ? null : laufText(lauf)

  async function fuehreAus(id: string, tun: () => Promise<void> | void) {
    setBeschaeftigt(id)
    try {
      await tun()
    } finally {
      setBeschaeftigt(null)
    }
  }

  function Zeile({ eintrag }: { eintrag: KantonsmitteilungFelder }) {
    const meldung = meldungZu.get(eintrag.id)
    const hinweise = eintrag.hinweise ?? []
    const weitere = weitereGemeinden(eintrag)

    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Chip size="small" label={eintrag.gemeinde?.name ?? '—'} />
            <Chip
              size="small"
              variant="outlined"
              color={eintrag.quelle === 'polizeimeldung' ? 'warning' : 'default'}
              label={quelleText(eintrag.quelle)}
            />
            {eintrag.behoerde !== null && <Chip size="small" variant="outlined" label={eintrag.behoerde} />}
            {eintrag.text_abgeschnitten && (
              <Chip size="small" color="warning" variant="outlined" label="Text unvollständig gelesen" />
            )}
            {weitere.length > 0 && (
              <Chip size="small" variant="outlined" label={`nennt auch ${weitere.join(', ')}`} />
            )}
          </Stack>

          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {eintrag.titel}
          </Typography>

          {eintrag.teaser !== null && eintrag.teaser !== '' && (
            <Typography variant="body2">{eintrag.teaser}</Typography>
          )}

          <Typography variant="body2" color="text.secondary">
            {[
              eintrag.publiziert_am === null
                ? 'ohne Datum'
                : `Mitteilung vom ${datumText(eintrag.publiziert_am)}`,
              ...hinweise
            ].join(' · ')}
          </Typography>

          {eintrag.vorschlag_begruendung !== null && (
            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
              {eintrag.vorschlag_begruendung}
            </Typography>
          )}

          {/* The public page stays linked whatever we could read — the editor
              checks for herself. It is never fetched: it sits behind a
              challenge, and the wording below came through the data door. */}
          <Link
            href={eintrag.url}
            target="_blank"
            rel="noopener"
            variant="body2"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            <ArticleOutlined fontSize="inherit" /> Mitteilung auf baselland.ch
          </Link>

          <Originaltext text={eintrag.text} />

          <Divider />

          {/* Sobald eine Meldung da ist, wird sie HIER redigiert. */}
          {meldung !== undefined && (
            <MeldungKarte
              meldung={meldung}
              onChat={onChat ?? (async () => {})}
              onAktion={onAktion ?? (async () => {})}
              onTermin={onTermin}
              laeuft={laeuft}
            />
          )}

          {/* Die Entscheide bleiben stehen, AUCH wenn der Lauf den Artikel
              schon geschrieben hat — Grund und Weiterreichen lehren die
              naechste Sichtung, der Entwurf lehrt nichts. */}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {meldung === undefined && (
              <Button
                size="small"
                variant="contained"
                disabled={beschaeftigt === eintrag.id}
                onClick={() => fuehreAus(eintrag.id, () => onUebernehmen?.(eintrag.id))}
              >
                Meldung schreiben
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
              onClick={() => {
                setWeitergabe(eintrag)
                setBegruendung('')
              }}
            >
              An Chefredaktion
            </Button>
          </Stack>
        </Stack>
      </Paper>
    )
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Mitteilungen des Kantons
        </Typography>
        {onAllePublizieren !== undefined && fertige.length > 0 && (
          <Button variant="contained" disabled={laeuft || unterwegs} onClick={() => void onAllePublizieren()}>
            Alle publizieren ({fertige.length})
          </Button>
        )}
        <Button
          variant="outlined"
          disabled={laeuft || unterwegs}
          onClick={() => onLauf?.()}
          startIcon={unterwegs ? <CircularProgress size={16} /> : undefined}
        >
          {unterwegs ? 'Lauf ist unterwegs …' : laeuft ? 'Läuft …' : 'Jetzt prüfen'}
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        Nur Mitteilungen, die eine bespielte Gemeinde beim Namen nennen — eine Zeile je Gemeinde. Zu jedem
        Vorschlag schreibt der Lauf die Meldung gleich mit; publizieren genügt. Abgelehnt oder weitergereicht
        wird trotzdem hier, und der Entwurf geht dann mit. Was die Sichtung nicht vorgeschlagen hat, bleibt
        ohne Meldung liegen und verschwindet nach sieben Tagen, ein unentschiedener Vorschlag nach vierzehn.
        Eine Polizeimeldung wird über den Ort und das Ereignis geschrieben, nie über eine genannte Person.
      </Typography>

      {lauf?.fehler != null && (
        <Alert severity="error">Der letzte Lauf ist fehlgeschlagen: {lauf.fehler}</Alert>
      )}
      {laufHinweis !== null && (
        <Typography variant="body2" color="text.secondary">
          {laufHinweis}
        </Typography>
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
          size="small"
          label="Suche"
          value={filter.suche}
          onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
          sx={{ minWidth: 200 }}
        />
      </Stack>

      {vorschlaege.length === 0 && uebrige.length === 0 ? (
        <Alert severity="info">
          Nichts auf dem Tisch. Der nächste Lauf um 12 Uhr holt, was der Kanton seither über eine Gemeinde
          mitgeteilt hat.
        </Alert>
      ) : (
        <>
          <Typography variant="subtitle2" color="text.secondary">
            {vorschlaege.length === 0
              ? 'Kein Vorschlag — die Sichtung hielt nichts für berichtenswert.'
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
        <DialogTitle>Mitteilung ablehnen</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {ablehnung?.titel}
            </Typography>
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
              helperText="Wird der nächsten Sichtung als Beispiel mitgegeben — und in Worten sofort zur Regel geprüft."
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

      <Dialog open={weitergabe !== null} onClose={() => setWeitergabe(null)} fullWidth maxWidth="sm">
        <DialogTitle>An die Chefredaktion weiterreichen</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {weitergabe?.titel}
            </Typography>
            <TextField
              label="Begründung (optional)"
              value={begruendung}
              onChange={(e) => setBegruendung(e.target.value)}
              multiline
              minRows={2}
              helperText="Hilft der Chefredaktion — und lehrt die nächste Sichtung, was weitergereicht gehört."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWeitergabe(null)}>Abbrechen</Button>
          <Button
            variant="contained"
            onClick={() => {
              const eintrag = weitergabe
              setWeitergabe(null)
              if (eintrag !== null) {
                void fuehreAus(eintrag.id, () =>
                  onWeiterreichen?.(eintrag.id, begruendung.trim() === '' ? null : begruendung.trim())
                )
              }
            }}
          >
            Weiterreichen
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
