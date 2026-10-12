'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined'
import type { AlleMeldungFelder, GemeindeFelder, SmdBeitragFelder } from '@/graphql/redaktion'
import type { TerminEingabe } from '@/lib/termin'
import { MeldungKarte, type MeldungAktion, type MeldungAktionKoerper } from './MeldungKarte'
import { Originaltext } from './Presseschau'
import {
  ABLEHNUNGSGRUENDE,
  beitragsText,
  datumText,
  laufText,
  linkChip,
  linkText,
  medien,
  meldungJeBeitrag,
  publizierbare,
  tisch,
  weitereGemeinden,
  type Filter,
  type SmdLaufStatus
} from '@/lib/smd'

export interface SmdProps {
  eintraege: SmdBeitragFelder[]
  gemeinden: GemeindeFelder[]
  /** Alle Meldungen — die uebernommenen werden hier redigiert, nicht anderswo. */
  meldungen?: readonly AlleMeldungFelder[]
  heute: string
  laeuft?: boolean
  /** Der von Hand gestartete Lauf, solange der Server ihn kennt: unterwegs, oder was der letzte brachte. */
  lauf?: SmdLaufStatus | null
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion, koerper?: MeldungAktionKoerper) => Promise<void>
  /** Der Termin der Meldung fuer den Dorfkoenig — siehe `MeldungKarte`. */
  onTermin?: (id: string, eingabe: TerminEingabe) => Promise<void>
  onLauf?: () => Promise<void> | void
  onUebernehmen?: (id: string) => Promise<void> | void
  onAblehnen?: (id: string, grund: string, kommentar: string | null) => Promise<void> | void
  onWeiterreichen?: (id: string, begruendung: string | null) => Promise<void> | void
  /** Der Link zum Online-Artikel von Hand — null entfernt ihn. */
  onLink?: (id: string, url: string | null, abo: boolean) => Promise<void> | void
  /** Publiziert alle geschriebenen Meldungen dieses Tischs auf einen Griff. */
  onAllePublizieren?: () => Promise<void> | void
}

/**
 * The SMD desk: what OTHER media wrote about a municipality, from the daily
 * dossier of the Schweizer Mediendatenbank.
 *
 * A DESK like the Kanton one — three decisions per row, a decided row leaves
 * the view, the Meldung is written on the click and edited here. A row is an
 * article of the dossier or a NEW entry of a news blog (the dossier brings
 * the whole blog every time one entry changed), and every row says whether
 * the piece stands online and behind a paywall — found by the run through
 * the publisher's door, or set by hand — or that the newsroom read it as if
 * in the printed paper.
 */
export function Smd({
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
  onLink,
  onAllePublizieren
}: SmdProps) {
  const [filter, setFilter] = useState<Filter>({ gemeinde: null, medium: null, suche: '' })
  const [uebrigeOffen, setUebrigeOffen] = useState(false)
  const [ablehnung, setAblehnung] = useState<SmdBeitragFelder | null>(null)
  const [grund, setGrund] = useState('nicht_relevant')
  const [kommentar, setKommentar] = useState('')
  const [weitergabe, setWeitergabe] = useState<SmdBeitragFelder | null>(null)
  const [begruendung, setBegruendung] = useState('')
  const [verlinkung, setVerlinkung] = useState<SmdBeitragFelder | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkAbo, setLinkAbo] = useState(true)
  const [beschaeftigt, setBeschaeftigt] = useState<string | null>(null)

  const meldungZu = useMemo(() => meldungJeBeitrag(meldungen), [meldungen])
  const statusJeBeitrag = useMemo(
    () => new Map([...meldungZu].map(([id, m]) => [id, m.status] as const)),
    [meldungZu]
  )
  const { vorschlaege, uebrige } = useMemo(
    () => tisch(eintraege, filter, statusJeBeitrag, heute),
    [eintraege, filter, statusJeBeitrag, heute]
  )
  const aktive = useMemo(() => gemeinden.filter((g) => g.aktiv), [gemeinden])
  const alleMedien = useMemo(() => medien(eintraege), [eintraege])
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

  function Zeile({ eintrag }: { eintrag: SmdBeitragFelder }) {
    const meldung = meldungZu.get(eintrag.id)
    const hinweise = eintrag.hinweise ?? []
    const weitere = weitereGemeinden(eintrag)
    const chip = linkChip(eintrag)

    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 1 }}>
            <Chip size="small" label={eintrag.gemeinde?.name ?? '—'} />
            <Chip size="small" variant="outlined" label={eintrag.medium} />
            {eintrag.art === 'blogeintrag' && (
              <Chip size="small" variant="outlined" color="info" label={`Blog «${eintrag.blog ?? ''}»`} />
            )}
            <Chip size="small" variant="outlined" color={chip.farbe} label={chip.text} />
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

          {eintrag.lead !== null && eintrag.lead !== '' && (
            <Typography variant="body2">{eintrag.lead}</Typography>
          )}

          <Typography variant="body2" color="text.secondary">
            {[
              beitragsText(eintrag, datumText),
              ...(eintrag.autor === null ? [] : [eintrag.autor]),
              ...(eintrag.rubrik === null || eintrag.art === 'blogeintrag' ? [] : [eintrag.rubrik]),
              ...hinweise,
              ...(eintrag.link_url === null && eintrag.link_hinweis !== null ? [eintrag.link_hinweis] : [])
            ].join(' · ')}
          </Typography>

          {eintrag.vorschlag_begruendung !== null && (
            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
              {eintrag.vorschlag_begruendung}
            </Typography>
          )}

          {/* The online address: the run's find, or the editor's. The source
              line of the article carries exactly this text. */}
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {eintrag.link_url !== null ? (
              <Link
                href={eintrag.link_url}
                target="_blank"
                rel="noopener"
                variant="body2"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
              >
                <OpenInNewOutlined fontSize="inherit" /> {linkText(eintrag)}
              </Link>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {linkText(eintrag)}
              </Typography>
            )}
            {onLink !== undefined && (
              <Button
                size="small"
                disabled={beschaeftigt === eintrag.id}
                onClick={() => {
                  setVerlinkung(eintrag)
                  setLinkUrl(eintrag.link_url ?? '')
                  setLinkAbo(eintrag.link_abo !== false)
                }}
              >
                {eintrag.link_url === null ? 'Link setzen' : 'Link ändern'}
              </Button>
            )}
          </Stack>

          <Originaltext text={eintrag.text} />

          <Divider />

          {meldung !== undefined && (
            <MeldungKarte
              meldung={meldung}
              onChat={onChat ?? (async () => {})}
              onAktion={onAktion ?? (async () => {})}
              onTermin={onTermin}
              laeuft={laeuft}
            />
          )}

          {/* Die Entscheide bleiben stehen, auch wenn die Meldung schon da
              ist — Grund und Weiterreichen lehren die naechste Sichtung. */}
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
          Beiträge anderer Medien
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
        Das tägliche Dossier der Schweizer Mediendatenbank, nach Gemeinden gesucht — ein Newsblog zählt nur
        mit seinen neuen Einträgen, und nur Beiträge, die eine Gemeinde beim Namen nennen, kommen auf den
        Tisch. Zu jedem Beitrag sucht der Lauf den Online-Artikel beim Verlag; wo er keinen findet, sagt die
        Quellenzeile «(Artikel nicht online verfügbar)», und der Link lässt sich von Hand setzen. Die Meldung
        entsteht auf Klick, in eigenen Worten, das Medium im Text genannt. Was die Sichtung nicht
        vorgeschlagen hat, bleibt liegen und verschwindet nach sieben Tagen, ein unentschiedener Vorschlag
        nach vierzehn.
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
          select
          size="small"
          label="Medium"
          value={filter.medium ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, medium: e.target.value === '' ? null : e.target.value }))
          }
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Alle Medien</MenuItem>
          {alleMedien.map((m) => (
            <MenuItem key={m} value={m}>
              {m}
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
          Nichts auf dem Tisch. Der nächste Lauf um 14:45 Uhr holt das Dossier, das SMD um 14:30 Uhr schickt.
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
        <DialogTitle>Beitrag ablehnen</DialogTitle>
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

      <Dialog open={verlinkung !== null} onClose={() => setVerlinkung(null)} fullWidth maxWidth="sm">
        <DialogTitle>Link zum Online-Artikel</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {verlinkung?.titel}
            </Typography>
            <TextField
              label="Adresse"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://…"
              helperText="Leer lassen, um den Link zu entfernen — die Quellenzeile sagt dann «(Artikel nicht online verfügbar)»."
            />
            <FormControlLabel
              control={<Checkbox checked={linkAbo} onChange={(e) => setLinkAbo(e.target.checked)} />}
              label="Hinter der Bezahlschranke — der Linktext trägt «(Abo)»"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVerlinkung(null)}>Abbrechen</Button>
          <Button
            variant="contained"
            onClick={() => {
              const eintrag = verlinkung
              setVerlinkung(null)
              if (eintrag !== null) {
                void fuehreAus(eintrag.id, () =>
                  onLink?.(eintrag.id, linkUrl.trim() === '' ? null : linkUrl.trim(), linkAbo)
                )
              }
            }}
          >
            Speichern
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
