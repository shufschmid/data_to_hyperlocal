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
import ForumOutlined from '@mui/icons-material/ForumOutlined'
import type {
  AlleMeldungFelder,
  BuschtelefonFundFelder,
  BuschtelefonQuelleFelder,
  BuschtelefonStandFelder,
  GemeindeFelder
} from '@/graphql/redaktion'
import type { TerminEingabe } from '@/lib/termin'
import type { MeldungErzeugenKoerper } from '@/lib/eigene'
import { stufeText, STANDARD_EINSTELLUNG } from '@/lib/tische'
import { MeldungKarte, type MeldungAktion, type MeldungAktionKoerper } from './MeldungKarte'
import { EigeneMeldungKnopf } from './EigeneMeldung'
import { BeitragWortlaut, KommentarListe } from './BuschtelefonMaterial'
import {
  ABLEHNUNGSGRUENDE,
  abrufAnzeige,
  autorText,
  datumZeile,
  entscheide,
  entwurfVorbehalt,
  fehlendeBilder,
  fundTitel,
  GESCHLOSSEN_SATZ,
  kanalText,
  keinEntwurf,
  materialGeleert,
  meldungJeFund,
  OHNE_GEMEINDE,
  quellenProbleme,
  quellenZahlen,
  sichtbarkeitText,
  tisch,
  type BuschtelefonLaufStatus,
  type Filter,
  type Kanal
} from '@/lib/buschtelefon'

export interface BuschtelefonProps {
  /** Which channel this workbench shows — the three workbenches share the component. */
  kanal: Kanal
  funde: BuschtelefonFundFelder[]
  quellen?: readonly BuschtelefonQuelleFelder[]
  /** The fetch's own state: the last release, the hint when today's is missing. */
  stand?: BuschtelefonStandFelder | null
  gemeinden: GemeindeFelder[]
  /** Alle Meldungen — die Entwuerfe des Laufs werden hier redigiert, nicht anderswo. */
  meldungen?: readonly AlleMeldungFelder[]
  /** Ab dieser Stufe liegt ein Fund zuoberst — der Regler hinter dem Zahnrad. */
  schwelle?: number
  laeuft?: boolean
  lauf?: BuschtelefonLaufStatus | null
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion, koerper?: MeldungAktionKoerper) => Promise<void>
  onTermin?: (id: string, eingabe: TerminEingabe) => Promise<void>
  onLauf?: () => Promise<void> | void
  /** „Meldung schreiben" — mit Koerper, wenn die Redaktion eigene Angaben oder den Text selbst mitgibt. */
  onUebernehmen?: (id: string, koerper?: MeldungErzeugenKoerper) => Promise<void> | void
  onAblehnen?: (id: string, grund: string, kommentar: string | null) => Promise<void> | void
  onWeiterreichen?: (id: string, begruendung: string | null) => Promise<void> | void
  /** Ordnet einem Fund ohne Gemeinde eine zu — ohne sie schreibt niemand eine Meldung. */
  onGemeinde?: (id: string, gemeinde: string) => Promise<void> | void
}

/**
 * The Buschtelefon desk: what stands in the social-network groups of a
 * municipality.
 *
 * A DESK like the Kanton one — three decisions per find, a decided find
 * leaves the view, the run's draft is edited on the row. What a row carries
 * is the post as the Buschtelefon released it: wording, the text read out of
 * every image, links, the post it shares, and the comments. The Sichtung
 * grades and never filters; what it did not put forward is one click away.
 *
 * The one thing this desk must not let an editor miss: a find from a CLOSED
 * group. Its post link is there for verification only — a Meldung links the
 * group — so such a row wears a filled warning chip and says it in a sentence.
 */
export function Buschtelefon({
  kanal,
  funde,
  quellen = [],
  stand = null,
  gemeinden,
  meldungen = [],
  schwelle = STANDARD_EINSTELLUNG.schwelle,
  laeuft = false,
  lauf = null,
  onChat,
  onAktion,
  onTermin,
  onLauf,
  onUebernehmen,
  onAblehnen,
  onWeiterreichen,
  onGemeinde
}: BuschtelefonProps) {
  const [filter, setFilter] = useState<Filter>({ gemeinde: null, suche: '' })
  const [uebrigeOffen, setUebrigeOffen] = useState(false)
  const [quellenOffen, setQuellenOffen] = useState(false)
  const [kommentareOffen, setKommentareOffen] = useState<ReadonlySet<string>>(new Set())
  const [ablehnung, setAblehnung] = useState<BuschtelefonFundFelder | null>(null)
  const [grund, setGrund] = useState('nicht_relevant')
  const [kommentar, setKommentar] = useState('')
  const [weitergabe, setWeitergabe] = useState<BuschtelefonFundFelder | null>(null)
  const [begruendung, setBegruendung] = useState('')
  const [beschaeftigt, setBeschaeftigt] = useState<string | null>(null)

  const meldungZu = useMemo(() => meldungJeFund(meldungen), [meldungen])
  const statusJeFund = useMemo(
    () => new Map([...meldungZu].map(([id, m]) => [id, m.status] as const)),
    [meldungZu]
  )
  const { vorschlaege, uebrige } = useMemo(
    () => tisch(funde, kanal, filter, statusJeFund, schwelle),
    [funde, kanal, filter, statusJeFund, schwelle]
  )
  const imKanal = useMemo(() => funde.some((f) => f.kanal === kanal), [funde, kanal])
  const aktive = useMemo(() => gemeinden.filter((g) => g.aktiv), [gemeinden])
  const probleme = useMemo(() => quellenProbleme(quellen, kanal), [quellen, kanal])
  const zahlen = useMemo(() => quellenZahlen(quellen, kanal), [quellen, kanal])
  const unterwegs = lauf?.laeuft === true
  // The hand-started run from the process, or — on the normal day, and after
  // every restart — the scheduled run's result from the stand.
  const abruf = abrufAnzeige(lauf, stand)

  async function fuehreAus(id: string, tun: () => Promise<void> | void) {
    setBeschaeftigt(id)
    try {
      await tun()
    } finally {
      setBeschaeftigt(null)
    }
  }

  function kommentareUmschalten(id: string) {
    setKommentareOffen((alt) => {
      const neu = new Set(alt)
      if (neu.has(id)) neu.delete(id)
      else neu.add(id)
      return neu
    })
  }

  function Zeile({ fund }: { fund: BuschtelefonFundFelder }) {
    const meldung = meldungZu.get(fund.id)
    const lebendeMeldung = meldung !== undefined && meldung.status !== 'verworfen' ? meldung : undefined
    const meldungStatus = meldung?.status ?? null
    const titel = fundTitel(fund)
    const geleert = materialGeleert(fund)
    const entfernt = fund.status === 'entfernt'
    const geschlossen = sichtbarkeitText(fund)
    const stufe = stufeText(fund.vorschlag_wert)
    const autor = autorText(fund)
    const neueKommentare = fund.neue_kommentare ?? 0
    const hinweise = [...(fund.hinweise ?? []), fehlendeBilder(fund)].filter(
      (h, i, alle): h is string => h !== null && h !== '' && alle.indexOf(h) === i
    )
    // A find whose material is gone cannot become an article any more; the
    // row only still says what happened to it.
    const entscheidbar = !geleert && !entfernt
    const moeglich = entscheide(fund, meldungStatus)
    const vorbehalt = entwurfVorbehalt(fund, meldungStatus)
    const abgelehnt = entscheidbar && keinEntwurf(fund, meldungStatus)

    return (
      <Paper variant="outlined" sx={{ p: 2 }} data-testid="fund">
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 1 }}>
            {fund.gemeinde === null ? (
              <Chip size="small" color="warning" label="Gemeinde fehlt" />
            ) : (
              <Chip size="small" label={fund.gemeinde.name} />
            )}
            {fund.quelle_name !== null && <Chip size="small" variant="outlined" label={fund.quelle_name} />}
            {geschlossen !== null && <Chip size="small" color="warning" label={geschlossen} />}
            {stufe !== null && (
              <Chip
                size="small"
                variant="outlined"
                color={(fund.vorschlag_wert ?? 0) >= 4 ? 'primary' : 'default'}
                label={stufe}
              />
            )}
            {neueKommentare > 0 && (
              <Chip
                size="small"
                color="info"
                label={neueKommentare === 1 ? '1 neuer Kommentar' : `${neueKommentare} neue Kommentare`}
              />
            )}
            {fund.doublette_von !== null && <Chip size="small" variant="outlined" label="Doublette" />}
            {fund.status === 'nicht_erreichbar' && (
              <Chip size="small" color="warning" variant="outlined" label="Original nicht erreichbar" />
            )}
            {entfernt && (
              <Chip size="small" color="error" variant="outlined" label="Original nicht mehr auffindbar" />
            )}
            {fund.text_abgeschnitten === true && (
              <Chip size="small" color="warning" variant="outlined" label="Text gekürzt geliefert" />
            )}
          </Stack>

          {geschlossen !== null && (
            <Alert severity="warning" sx={{ py: 0 }}>
              {GESCHLOSSEN_SATZ}
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary">
            {[
              datumZeile(fund),
              autor === null ? null : `von ${autor}`,
              fund.n_kommentare === null ? null : `${fund.n_kommentare} Kommentare`,
              fund.n_reaktionen === null ? null : `${fund.n_reaktionen} Reaktionen`,
              ...hinweise
            ]
              .filter((t): t is string => t !== null)
              .join(' · ')}
          </Typography>

          {geleert ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              Das Rohmaterial dieses Fundes ist gelöscht — die Zeile bleibt, damit derselbe Beitrag nicht noch
              einmal als neu ankommt.
            </Typography>
          ) : (
            <BeitragWortlaut fund={fund} />
          )}

          {fund.vorschlag_begruendung !== null && fund.vorschlag_begruendung !== '' && (
            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
              {fund.vorschlag_begruendung}
            </Typography>
          )}

          {/* The post link always stands on the desk — it is how the editor
              verifies. Whether a Meldung may carry it is another question,
              and the warning above answers it for a closed group. */}
          {fund.link !== null && fund.link !== '' && (
            <Link
              href={fund.link}
              target="_blank"
              rel="noopener noreferrer"
              variant="body2"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
            >
              <ForumOutlined fontSize="inherit" /> Original-Beitrag öffnen
            </Link>
          )}

          {!geleert && (
            <KommentarListe
              fund={fund}
              offen={kommentareOffen.has(fund.id)}
              onUmschalten={() => kommentareUmschalten(fund.id)}
            />
          )}

          <Divider />

          {vorbehalt !== null && (
            <Alert severity="info">Vorbehalt beim Schreiben des Entwurfs: {vorbehalt}</Alert>
          )}
          {/* The run's writer declined this find — said here, or the row
              sits among the proposals without a draft and without a word why. */}
          {abgelehnt && (
            <Alert severity="info">
              {fund.entwurf_bedenken} Mit eigenen Angaben lässt sich die Meldung trotzdem schreiben.
            </Alert>
          )}

          {/* Sobald eine Meldung da ist, wird sie HIER redigiert. */}
          {lebendeMeldung !== undefined && (
            <MeldungKarte
              meldung={lebendeMeldung}
              onChat={onChat ?? (async () => {})}
              onAktion={onAktion ?? (async () => {})}
              onTermin={onTermin}
              laeuft={laeuft}
            />
          )}

          {fund.gemeinde === null && entscheidbar && fund.entscheid === 'offen' && (
            <TextField
              select
              size="small"
              label="Gemeinde zuordnen"
              value=""
              disabled={beschaeftigt === fund.id}
              onChange={(e) => {
                const gemeinde = e.target.value
                if (gemeinde !== '') void fuehreAus(fund.id, () => onGemeinde?.(fund.id, gemeinde))
              }}
              helperText="Ohne Gemeinde wird keine Meldung geschrieben — die Quelle gehört zu mehreren oder zu keiner bespielten Gemeinde."
              sx={{ maxWidth: 420 }}
            >
              {aktive.map((g) => (
                <MenuItem key={g.id} value={g.id}>
                  {g.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          {/* Die Entscheide bleiben stehen, AUCH wenn der Lauf den Entwurf
              schon geschrieben hat — Grund und Weiterreichen lehren die
              naechste Sichtung, der Entwurf lehrt nichts. */}
          {entscheidbar && (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              {lebendeMeldung === undefined && (
                <Button
                  size="small"
                  variant="contained"
                  disabled={beschaeftigt === fund.id || fund.gemeinde === null}
                  onClick={() => fuehreAus(fund.id, () => onUebernehmen?.(fund.id))}
                >
                  Meldung schreiben
                </Button>
              )}
              {lebendeMeldung === undefined && (
                <EigeneMeldungKnopf
                  titel={titel}
                  disabled={beschaeftigt === fund.id || fund.gemeinde === null}
                  onAbschicken={(koerper) => fuehreAus(fund.id, () => onUebernehmen?.(fund.id, koerper))}
                />
              )}
              {moeglich.ablehnen && (
                <Button
                  size="small"
                  disabled={beschaeftigt === fund.id}
                  onClick={() => {
                    setAblehnung(fund)
                    setGrund('nicht_relevant')
                    setKommentar('')
                  }}
                >
                  Ablehnen
                </Button>
              )}
              {moeglich.weiterreichen && (
                <Button
                  size="small"
                  disabled={beschaeftigt === fund.id}
                  onClick={() => {
                    setWeitergabe(fund)
                    setBegruendung('')
                  }}
                >
                  An Chefredaktion
                </Button>
              )}
            </Stack>
          )}
          {entscheidbar && moeglich.meldungUnterwegs && (
            <Typography variant="caption" color="text.secondary">
              Die Meldung ist über den Entwurf hinaus — über sie wird jetzt auf ihrer Karte entschieden.
            </Typography>
          )}
        </Stack>
      </Paper>
    )
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Buschtelefon — {kanalText(kanal)}
        </Typography>
        <Button
          variant="outlined"
          disabled={laeuft || unterwegs}
          onClick={() => onLauf?.()}
          startIcon={unterwegs ? <CircularProgress size={16} /> : undefined}
        >
          {unterwegs ? 'Abruf ist unterwegs …' : laeuft ? 'Läuft …' : 'Jetzt abholen'}
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        Jeder Fund ist ein Beitrag mit seinen Bildtexten, Links und Kommentaren, wie das Buschtelefon ihn
        einmal am Tag freigibt. Die Sichtung benotet und begründet, sie filtert nie. Zu jedem Vorschlag mit
        Gemeinde schreibt der Lauf den Entwurf gleich mit; publiziert wird nichts ohne dich. Abgelehnt oder
        weitergereicht wird trotzdem hier, und der Entwurf geht dann mit. Ein unentschiedener Fund wird mit
        dem neuen Stand ersetzt und verfällt nach vierzehn Tagen. Was hier steht, ist nicht unabhängig
        bestätigt — Nachnamen, Telefonnummern und Adressen von Privatpersonen gehören in keine Meldung.
      </Typography>

      {abruf.aus !== null && <Alert severity="warning">{abruf.aus}</Alert>}
      {abruf.fehlgeschlagen !== null && (
        <Alert severity="error">Der letzte Abruf ist fehlgeschlagen: {abruf.fehlgeschlagen}</Alert>
      )}
      {abruf.standFehler !== null && (
        <Alert severity="error">Der letzte Abruf meldet: {abruf.standFehler}</Alert>
      )}
      {/* Ein stiller Tag und eine ausgefallene Freigabe sehen sonst gleich aus. */}
      {stand?.letzter_hinweis != null && stand.letzter_hinweis !== '' && (
        <Alert severity="info">{stand.letzter_hinweis}</Alert>
      )}
      {abruf.text !== null && (
        <Typography variant="body2" color="text.secondary">
          {abruf.text}
        </Typography>
      )}
      {abruf.fehler.length > 0 && (
        <Alert severity="warning">
          {abruf.fehler.slice(0, 5).join(' · ')}
          {abruf.fehler.length > 5 ? ` · (${abruf.fehler.length - 5} weitere)` : ''}
        </Alert>
      )}
      {/* Der Deckel der Entwürfe, abgewiesene Funde, ein neu gelesenes
          Lesezeichen: ein Deckel, der greift, muss hörbar sein. */}
      {abruf.hinweise.length > 0 && (
        <Alert severity="info">
          {abruf.hinweise.slice(0, 5).join(' · ')}
          {abruf.hinweise.length > 5 ? ` · (${abruf.hinweise.length - 5} weitere)` : ''}
        </Alert>
      )}

      {(probleme.length > 0 || zahlen.length > 0) && (
        <Box>
          <Button size="small" onClick={() => setQuellenOffen((o) => !o)} sx={{ px: 0 }}>
            {[
              probleme.length === 0
                ? null
                : probleme.length === 1
                  ? '1 Quelle nicht vollständig gelesen'
                  : `${probleme.length} Quellen nicht vollständig gelesen`,
              zahlen.length === 0 ? null : 'nicht Geliefertes je Quelle'
            ]
              .filter((t): t is string => t !== null)
              .join(' · ')}
            {quellenOffen ? ' — verbergen' : ' — anzeigen'}
          </Button>
          <Collapse in={quellenOffen} unmountOnExit>
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {probleme.map((p) => (
                <Typography key={`p-${p.id}`} variant="body2" color="warning.main">
                  {p.name}: {p.text}
                </Typography>
              ))}
              {zahlen.map((z) => (
                <Typography key={`z-${z.id}`} variant="body2" color="text.secondary">
                  {z.name}: {z.text}
                </Typography>
              ))}
            </Stack>
          </Collapse>
        </Box>
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
          <MenuItem value={OHNE_GEMEINDE}>Ohne Gemeinde</MenuItem>
        </TextField>
        <TextField
          size="small"
          label="Suche"
          value={filter.suche}
          onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
          sx={{ minWidth: 200 }}
        />
      </Stack>

      {!imKanal && kanal !== 'facebook' ? (
        <Alert severity="info">Das Buschtelefon liefert für diesen Kanal noch nichts.</Alert>
      ) : vorschlaege.length === 0 && uebrige.length === 0 ? (
        <Alert severity="info">
          Nichts auf dem Tisch. Der nächste Abruf um 12 Uhr holt, was das Buschtelefon seither freigegeben
          hat.
        </Alert>
      ) : (
        <>
          <Typography variant="subtitle2" color="text.secondary">
            {vorschlaege.length === 0
              ? 'Kein Vorschlag — die Sichtung hielt nichts für berichtenswert.'
              : `${vorschlaege.length} vorgeschlagen`}
          </Typography>
          <Stack spacing={2}>
            {vorschlaege.map((f) => (
              <Zeile key={f.id} fund={f} />
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
                  {uebrige.map((f) => (
                    <Zeile key={f.id} fund={f} />
                  ))}
                </Stack>
              </Collapse>
            </Box>
          )}
        </>
      )}

      <Dialog open={ablehnung !== null} onClose={() => setAblehnung(null)} fullWidth maxWidth="sm">
        <DialogTitle>Fund ablehnen</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {ablehnung === null ? '' : fundTitel(ablehnung)}
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
              helperText="Wird der nächsten Sichtung als Beispiel mitgegeben — und in Worten sofort zur Regel geprüft. Kommentare und Bildtexte des Fundes werden mit dem Ablehnen gelöscht."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAblehnung(null)}>Abbrechen</Button>
          <Button
            variant="contained"
            onClick={() => {
              const fund = ablehnung
              setAblehnung(null)
              if (fund !== null) {
                void fuehreAus(fund.id, () =>
                  onAblehnen?.(fund.id, grund, kommentar.trim() === '' ? null : kommentar.trim())
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
              {weitergabe === null ? '' : fundTitel(weitergabe)}
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
              const fund = weitergabe
              setWeitergabe(null)
              if (fund !== null) {
                void fuehreAus(fund.id, () =>
                  onWeiterreichen?.(fund.id, begruendung.trim() === '' ? null : begruendung.trim())
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
