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
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined'
import type { AlleMeldungFelder, GemeindeFelder, GemeindemitteilungFelder } from '@/graphql/redaktion'
import { MeldungKarte, type MeldungAktion, type MeldungAktionKoerper } from './MeldungKarte'
import { Originaltext } from './Presseschau'
import {
  ABLEHNUNGSGRUENDE,
  anhangHinweis,
  datumText,
  terminVon,
  laufText,
  lesefehler,
  meldungJeMitteilung,
  ohneNewsseite,
  ohneVeranstaltungsseite,
  seitenLink,
  tisch,
  zeitpunktText,
  type Filter,
  type GemeindeseitenLaufStatus
} from '@/lib/gemeindeseiten'

export interface GemeindeseitenProps {
  eintraege: GemeindemitteilungFelder[]
  gemeinden: GemeindeFelder[]
  /** Alle Meldungen — die uebernommenen werden hier redigiert, nicht anderswo. */
  meldungen?: readonly AlleMeldungFelder[]
  heute: string
  laeuft?: boolean
  /** Der von Hand gestartete Lauf, solange der Server ihn kennt: unterwegs, oder was der letzte brachte. */
  lauf?: GemeindeseitenLaufStatus | null
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion, koerper?: MeldungAktionKoerper) => Promise<void>
  onLauf?: () => Promise<void> | void
  onUebernehmen?: (id: string) => Promise<void> | void
  onAblehnen?: (id: string, grund: string, kommentar: string | null) => Promise<void> | void
  onWeiterreichen?: (id: string, begruendung: string | null) => Promise<void> | void
  onZuGemeinden?: () => void
}

/**
 * The municipal-news desk.
 *
 * A DESK like the gazette's: three decisions per row, and a decided row leaves
 * the view. What is different is what a row carries — the municipality's whole
 * announcement, read from its own page, with the documents it links. The
 * editor checks the original, never the summary: the text sits behind one
 * click, the page and the documents are linked.
 */
export function Gemeindeseiten({
  eintraege,
  gemeinden,
  meldungen = [],
  heute,
  laeuft = false,
  lauf = null,
  onChat,
  onAktion,
  onLauf,
  onUebernehmen,
  onAblehnen,
  onWeiterreichen,
  onZuGemeinden
}: GemeindeseitenProps) {
  const [filter, setFilter] = useState<Filter>({ gemeinde: null, suche: '' })
  const [uebrigeOffen, setUebrigeOffen] = useState(false)
  const [ablehnung, setAblehnung] = useState<GemeindemitteilungFelder | null>(null)
  const [grund, setGrund] = useState('nicht_relevant')
  const [kommentar, setKommentar] = useState('')
  const [weitergabe, setWeitergabe] = useState<GemeindemitteilungFelder | null>(null)
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
  const fehlende = useMemo(() => ohneNewsseite(gemeinden), [gemeinden])
  const ohneTermine = useMemo(() => ohneVeranstaltungsseite(gemeinden), [gemeinden])
  const gestoerte = useMemo(() => lesefehler(gemeinden), [gemeinden])
  const aktive = useMemo(() => gemeinden.filter((g) => g.aktiv), [gemeinden])
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

  function Zeile({ eintrag }: { eintrag: GemeindemitteilungFelder }) {
    const meldung = meldungZu.get(eintrag.id)
    const anhaenge = eintrag.anhaenge ?? []
    const hinweise = eintrag.hinweise ?? []

    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Chip size="small" label={eintrag.gemeinde?.name ?? '—'} />
            {eintrag.kategorie !== null && <Chip size="small" variant="outlined" label={eintrag.kategorie} />}
            {eintrag.inhalt_typ === 'pdf' && <Chip size="small" variant="outlined" label="PDF" />}
            {eintrag.text_abgeschnitten && (
              <Chip size="small" color="warning" variant="outlined" label="Text unvollständig gelesen" />
            )}
            {anhaenge.length > 0 && (
              <Chip
                size="small"
                variant="outlined"
                label={`${anhaenge.length} ${anhaenge.length === 1 ? 'Anhang' : 'Anhänge'}`}
              />
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
              // Termin oder Mitteilung: die Zeile sagt, welches der beiden
              // Daten sie traegt, weil die Redaktion sie nie verwechseln darf.
              terminVon(eintrag) !== null
                ? `Termin am ${datumText(terminVon(eintrag))}`
                : eintrag.publiziert_am === null
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

          {/* The page and its documents stay linked whatever we could read —
              the editor checks for herself, and that is the point. */}
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            <Link
              href={seitenLink(eintrag)}
              target="_blank"
              rel="noopener"
              variant="body2"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
            >
              <ArticleOutlined fontSize="inherit" />{' '}
              {terminVon(eintrag) === null
                ? 'Mitteilung auf der Gemeindeseite'
                : 'Veranstaltung auf der Gemeindeseite'}
            </Link>
            {anhaenge.map((a) => (
              <Link
                key={a.url}
                href={a.url}
                target="_blank"
                rel="noopener"
                variant="body2"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
              >
                <DescriptionOutlined fontSize="inherit" /> {a.bezeichnung}
                {!a.gelesen && anhangHinweis(a.grund) !== null && (
                  <Typography component="span" variant="caption" color="text.secondary">
                    ({anhangHinweis(a.grund)})
                  </Typography>
                )}
              </Link>
            ))}
          </Stack>

          <Originaltext text={eintrag.text} />

          <Divider />

          {/* Sobald eine Meldung da ist, wird sie HIER redigiert — der Tisch
              zeigt Arbeit, nicht Geschichte. */}
          {meldung !== undefined ? (
            <MeldungKarte
              meldung={meldung}
              onChat={onChat ?? (async () => {})}
              onAktion={onAktion ?? (async () => {})}
              laeuft={laeuft}
            />
          ) : (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Button
                size="small"
                variant="contained"
                disabled={beschaeftigt === eintrag.id}
                onClick={() => fuehreAus(eintrag.id, () => onUebernehmen?.(eintrag.id))}
              >
                Meldung schreiben
              </Button>
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
          )}
        </Stack>
      </Paper>
    )
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Mitteilungen der Gemeinden
        </Typography>
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
        Der Tisch räumt sich selbst: was die Sichtung nicht vorgeschlagen hat, verschwindet nach sieben Tagen,
        ein unentschiedener Vorschlag nach vierzehn — der Zähler im Reiter zählt die Vorschläge.
      </Typography>

      {/* The run's own voice: a click has to show something for the minutes it
          takes, and the desk has to say what the last run brought. */}
      {lauf?.fehler != null && (
        <Alert severity="error">Der letzte Lauf ist fehlgeschlagen: {lauf.fehler}</Alert>
      )}
      {laufHinweis !== null && (
        <Typography variant="body2" color="text.secondary">
          {laufHinweis}
        </Typography>
      )}

      {/* A page that could not be read is said, per municipality — an
          absence is otherwise indistinguishable from "nothing was published". */}
      {gestoerte.map((g) => (
        <Alert
          key={g.id}
          severity="warning"
          action={
            g.news_url !== null ? (
              <Button color="inherit" size="small" href={g.news_url} target="_blank" rel="noopener">
                Seite öffnen
              </Button>
            ) : undefined
          }
        >
          <strong>{g.name}</strong> konnte nicht gelesen werden: {g.news_letzter_fehler}
          {g.news_letzte_pruefung !== null && ` — letzter Versuch ${zeitpunktText(g.news_letzte_pruefung)}`}
        </Alert>
      ))}

      {fehlende.length > 0 && (
        <Alert
          severity="info"
          action={
            onZuGemeinden !== undefined ? (
              <Button color="inherit" size="small" onClick={onZuGemeinden}>
                Zu den Gemeinden
              </Button>
            ) : undefined
          }
        >
          Ohne Newsseite kommen keine Mitteilungen: {fehlende.map((g) => g.name).join(', ')}. Die Adresse der
          Newsübersicht steht in der Gemeinde-Karte.
        </Alert>
      )}

      {/* Dieselbe Aussage fuer die zweite Adresse. Eine Gemeinde ohne
          Veranstaltungsseite sieht sonst aus wie eine Gemeinde, in der nichts
          stattfindet. */}
      {ohneTermine.length > 0 && (
        <Alert
          severity="info"
          action={
            onZuGemeinden !== undefined ? (
              <Button color="inherit" size="small" onClick={onZuGemeinden}>
                Zu den Gemeinden
              </Button>
            ) : undefined
          }
        >
          Ohne Veranstaltungsseite kommen keine Termine: {ohneTermine.map((g) => g.name).join(', ')}. Die
          Adresse der Veranstaltungsübersicht steht in der Gemeinde-Karte.
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
          size="small"
          label="Suche"
          value={filter.suche}
          onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
          sx={{ minWidth: 200 }}
        />
      </Stack>

      {vorschlaege.length === 0 && uebrige.length === 0 ? (
        <Alert severity="info">
          Nichts auf dem Tisch. Der nächste Lauf um 13 Uhr holt, was seither erschienen ist.
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
