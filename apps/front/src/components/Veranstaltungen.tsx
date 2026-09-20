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
import ListAltOutlined from '@mui/icons-material/ListAltOutlined'
import type {
  AlleMeldungFelder,
  GemeindeFelder,
  VeranstaltungFelder,
  VeranstaltungsquelleFelder
} from '@/graphql/redaktion'
import { MeldungKarte, type MeldungAktion, type MeldungAktionKoerper } from './MeldungKarte'
import { Originaltext } from './Presseschau'
import { anhangHinweis } from '@/lib/gemeindeseiten'
import {
  ABLEHNUNGSGRUENDE,
  ankerFarbe,
  ankerText,
  DAUERANGEBOT_OPTIONEN,
  datumText,
  gemeindenOhneKalender,
  laufText,
  meldungJeAnlass,
  quellenMitFehler,
  quellenMitHinweis,
  quellenOhneLeser,
  seitenLink,
  termineText,
  tisch,
  zeitpunktText,
  type Filter,
  type GemeindeseitenLaufStatus
} from '@/lib/veranstaltungen'

export interface VeranstaltungenProps {
  anlaesse: VeranstaltungFelder[]
  /** Die erfassten Kalender — ihre Statuszeilen stehen hier, nicht bei den Gemeindeseiten. */
  quellen: VeranstaltungsquelleFelder[]
  gemeinden: GemeindeFelder[]
  /** Alle Meldungen — die uebernommenen werden hier redigiert, nicht anderswo. */
  meldungen?: readonly AlleMeldungFelder[]
  heute: string
  laeuft?: boolean
  /** Derselbe Lauf wie bei den Gemeindeseiten: ein Host, eine Pause, eine Operation. */
  lauf?: GemeindeseitenLaufStatus | null
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion, koerper?: MeldungAktionKoerper) => Promise<void>
  onLauf?: () => Promise<void> | void
  onUebernehmen?: (id: string) => Promise<void> | void
  onAblehnen?: (id: string, grund: string, kommentar: string | null) => Promise<void> | void
  onWeiterreichen?: (id: string, begruendung: string | null) => Promise<void> | void
  /** Der Schalter auf einer Routine: `intervall`, `nie` — oder einmalig `jetzt`. */
  onDauerangebot?: (id: string, modus: string) => Promise<void> | void
  onZuGemeinden?: () => void
}

/**
 * Der Veranstaltungstisch.
 *
 * Die Einheit ist der ANLASS: dasselbe an drei Tagen ist eine Zeile mit drei
 * Terminen. Was daran eine Meldung werden koennte, hat der Lauf ausgerechnet
 * und steht als Chip auf der Zeile — der Tisch zeigt den Anker, er erfindet
 * ihn nicht neu.
 *
 * Drei Stapel statt zwei, und der dritte ist der Grund fuer den eigenen Tisch:
 * unter „Routine" liegt, was jede Woche stattfindet. Das ist keine Meldung,
 * aber auch kein Abfall — der Jass-Nachmittag ist genau das, was Neuzugezogene
 * wissen wollen. Darum steht dort ein Schalter und kein Papierkorb.
 */
export function Veranstaltungen({
  anlaesse,
  quellen,
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
  onDauerangebot,
  onZuGemeinden
}: VeranstaltungenProps) {
  const [filter, setFilter] = useState<Filter>({ gemeinde: null, suche: '' })
  const [verankertOffen, setVerankertOffen] = useState(false)
  const [routineOffen, setRoutineOffen] = useState(false)
  const [ablehnung, setAblehnung] = useState<VeranstaltungFelder | null>(null)
  const [grund, setGrund] = useState('nicht_relevant')
  const [kommentar, setKommentar] = useState('')
  const [weitergabe, setWeitergabe] = useState<VeranstaltungFelder | null>(null)
  const [begruendung, setBegruendung] = useState('')
  const [beschaeftigt, setBeschaeftigt] = useState<string | null>(null)

  const meldungZu = useMemo(() => meldungJeAnlass(meldungen), [meldungen])
  const statusJeAnlass = useMemo(
    () => new Map([...meldungZu].map(([id, m]) => [id, m.status] as const)),
    [meldungZu]
  )
  const { vorschlaege, verankert, routine } = useMemo(
    () => tisch(anlaesse, filter, statusJeAnlass, heute),
    [anlaesse, filter, statusJeAnlass, heute]
  )
  const ohneKalender = useMemo(() => gemeindenOhneKalender(gemeinden, quellen), [gemeinden, quellen])
  const gestoerte = useMemo(() => quellenMitFehler(quellen), [quellen])
  const deklariert = useMemo(() => quellenMitHinweis(quellen), [quellen])
  const ohneLeser = useMemo(() => quellenOhneLeser(quellen), [quellen])
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

  function Kopfzeile({ anlass }: { anlass: VeranstaltungFelder }) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Chip size="small" label={anlass.gemeinde?.name ?? '—'} />
        <Chip size="small" color={ankerFarbe(anlass.anker)} label={ankerText(anlass.anker)} />
        {anlass.kategorie !== null && anlass.kategorie !== '' && (
          <Chip size="small" variant="outlined" label={anlass.kategorie} />
        )}
        {/* Ein Anlass ausserhalb der Gemeinde wird DEKLARIERT und nicht
            ausgeschlossen: der Suppentag der Binninger Kirchgemeinde findet in
            Bottmingen statt und bleibt Binninger Dorfleben. */}
        {anlass.ort_ausserhalb && (
          <Chip size="small" variant="outlined" color="warning" label="Ort ausserhalb" />
        )}
        {anlass.text_abgeschnitten && (
          <Chip size="small" color="warning" variant="outlined" label="Text unvollständig gelesen" />
        )}
      </Stack>
    )
  }

  function Angaben({ anlass }: { anlass: VeranstaltungFelder }) {
    const ort = [anlass.lokalitaet, anlass.adresse, anlass.ort].filter((t) => t !== null && t !== '')
    return (
      <Typography variant="body2" color="text.secondary">
        {[
          termineText(anlass.termine),
          anlass.zeit,
          ort.length === 0 ? null : ort.join(', '),
          anlass.veranstalter,
          anlass.preis,
          anlass.frist_am === null ? null : `Anmeldung bis ${datumText(anlass.frist_am)}`,
          ...(anlass.hinweise ?? [])
        ]
          .filter((t): t is string => t !== null && t !== '')
          .join(' · ')}
      </Typography>
    )
  }

  function Zeile({ anlass }: { anlass: VeranstaltungFelder }) {
    const meldung = meldungZu.get(anlass.id)
    const dokumente = anlass.dokumente ?? []
    const traktanden = anlass.traktanden ?? []

    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Kopfzeile anlass={anlass} />

          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {anlass.titel}
          </Typography>

          <Angaben anlass={anlass} />

          {/* Warum der Code diesen Anker gesetzt hat, steht da — sonst ist
              „Abweichung" eine Behauptung, die niemand pruefen kann. */}
          {anlass.anker_grund !== null && anlass.anker_grund !== '' && (
            <Typography variant="caption" color="text.secondary">
              {anlass.anker_grund}
            </Typography>
          )}

          {anlass.vorschlag_begruendung !== null && (
            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
              {anlass.vorschlag_begruendung}
            </Typography>
          )}

          {/* Die Traktanden sind der Grund, warum ein Gremium ueberhaupt
              vorgeschlagen wird — sie stehen offen da, nicht hinter einem
              Klick. */}
          {traktanden.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Traktanden
              </Typography>
              <Stack component="ul" sx={{ m: 0, pl: 3 }}>
                {traktanden.map((t, i) => (
                  <Typography key={`${i}-${t}`} component="li" variant="body2">
                    {t}
                  </Typography>
                ))}
              </Stack>
            </Box>
          )}

          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            <Link
              href={seitenLink(anlass)}
              target="_blank"
              rel="noopener"
              variant="body2"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
            >
              <ArticleOutlined fontSize="inherit" /> Anlass im Kalender
            </Link>
            {anlass.traktanden_url !== null && (
              <Link
                href={anlass.traktanden_url}
                target="_blank"
                rel="noopener"
                variant="body2"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
              >
                <ListAltOutlined fontSize="inherit" /> Traktanden der Sitzung
              </Link>
            )}
            {dokumente.map((d) => (
              <Link
                key={d.url}
                href={d.url}
                target="_blank"
                rel="noopener"
                variant="body2"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
              >
                <DescriptionOutlined fontSize="inherit" /> {d.bezeichnung}
                {!d.gelesen && anhangHinweis(d.grund) !== null && (
                  <Typography component="span" variant="caption" color="text.secondary">
                    ({anhangHinweis(d.grund)})
                  </Typography>
                )}
              </Link>
            ))}
          </Stack>

          <Originaltext text={anlass.beschreibung} />

          <Divider />

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
                disabled={beschaeftigt === anlass.id}
                onClick={() => fuehreAus(anlass.id, () => onUebernehmen?.(anlass.id))}
              >
                Meldung schreiben
              </Button>
              <Button
                size="small"
                disabled={beschaeftigt === anlass.id}
                onClick={() => {
                  setAblehnung(anlass)
                  setGrund('nicht_relevant')
                  setKommentar('')
                }}
              >
                Ablehnen
              </Button>
              <Button
                size="small"
                disabled={beschaeftigt === anlass.id}
                onClick={() => {
                  setWeitergabe(anlass)
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

  /**
   * Eine Routine — kompakt, mit dem einen Schalter, der hier zaehlt.
   *
   * „Alle sechs Monate" macht aus dem woechentlichen Jass-Nachmittag zweimal
   * im Jahr eine Erinnerung; „nie" nimmt ihn fuer immer aus der Warteschlange.
   * „Jetzt vorschlagen" ist der einmalige Griff daneben und veraendert die
   * Einstellung nicht.
   */
  function RoutineZeile({ anlass }: { anlass: VeranstaltungFelder }) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack spacing={1}>
          <Kopfzeile anlass={anlass} />
          <Link
            href={seitenLink(anlass)}
            target="_blank"
            rel="noopener"
            variant="subtitle2"
            sx={{ fontWeight: 600 }}
          >
            {anlass.titel}
          </Link>
          <Angaben anlass={anlass} />
          {anlass.zuletzt_vorgelegt_am !== null && (
            <Typography variant="caption" color="text.secondary">
              Zuletzt vorgelegt am {datumText(anlass.zuletzt_vorgelegt_am)}
            </Typography>
          )}
          {onDauerangebot !== undefined && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
              <TextField
                select
                size="small"
                label="Dauerangebot"
                value={anlass.dauerangebot ?? ''}
                disabled={beschaeftigt === anlass.id}
                onChange={(e) => void fuehreAus(anlass.id, () => onDauerangebot(anlass.id, e.target.value))}
                sx={{ minWidth: 240 }}
              >
                <MenuItem value="">Noch nicht entschieden</MenuItem>
                {DAUERANGEBOT_OPTIONEN.map((o) => (
                  <MenuItem key={o.wert} value={o.wert}>
                    {o.text}
                  </MenuItem>
                ))}
              </TextField>
              <Button
                size="small"
                disabled={beschaeftigt === anlass.id}
                onClick={() => void fuehreAus(anlass.id, () => onDauerangebot(anlass.id, 'jetzt'))}
              >
                Jetzt vorschlagen
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
          Anlässe aus den Veranstaltungskalendern
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
        Eine Zeile ist ein Anlass, nicht ein Kalendertag: dieselbe Sache an drei Tagen steht einmal da. Der
        Chip nennt, was daran eine Meldung sein könnte — der Lauf rechnet ihn aus, die Sichtung sortiert nur.
        Ein Vorschlag verfällt nach seinem Anker, eine Zeile ohne Anker nach drei Wochen ohne Kalender.
      </Typography>

      {lauf?.fehler != null && (
        <Alert severity="error">Der letzte Lauf ist fehlgeschlagen: {lauf.fehler}</Alert>
      )}
      {laufHinweis !== null && (
        <Typography variant="body2" color="text.secondary">
          {laufHinweis}
        </Typography>
      )}

      {/* Je Kalender eine Zeile: ein Kalender, der nicht antwortet, sieht
          sonst aus wie eine Gemeinde, in der nichts stattfindet.

          Der Text sagt NICHT, die Seite sei nicht lesbar gewesen. Ein Lauf
          scheitert an zwei verschiedenen Stellen — beim Lesen der Seite und
          bei der Sichtung danach —, und im zweiten Fall stehen die Anlässe
          längst auf dem Tisch. Eine Zeile, die dann „konnte nicht gelesen
          werden" behauptet, widerspricht dem, was daneben steht. */}
      {gestoerte.map((q) => (
        <Alert
          key={q.id}
          severity="warning"
          action={
            <Button color="inherit" size="small" href={q.url} target="_blank" rel="noopener">
              Kalender öffnen
            </Button>
          }
        >
          <strong>{q.name}</strong>: {q.letzter_fehler}
          {q.letzte_pruefung !== null && ` — letzter Lauf ${zeitpunktText(q.letzte_pruefung)}`}
        </Alert>
      ))}

      {/* Blau, nicht orange: die Seite WURDE gelesen, ein Deckel hat
          gegriffen, morgen geht es weiter. */}
      {deklariert.map((q) => (
        <Alert key={`hinweis-${q.id}`} severity="info">
          <strong>{q.name}</strong>: {q.letzter_hinweis}
          {q.letzte_pruefung !== null && ` — Stand ${zeitpunktText(q.letzte_pruefung)}`}
        </Alert>
      ))}

      {ohneKalender.length > 0 && (
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
          Ohne Kalender kommen keine Anlässe: {ohneKalender.map((g) => g.name).join(', ')}. Kalender werden in
          der Gemeinde-Karte erfasst.
        </Alert>
      )}

      {/* Erfasst, aber noch von niemandem gelesen — sichtbar, damit die
          Redaktion nicht auf Anlässe wartet, die nicht kommen können. */}
      {ohneLeser.length > 0 && (
        <Alert severity="info">
          Erfasst, aber noch ohne Leser: {ohneLeser.map((q) => q.name).join(', ')}. Diese Kalender werden noch
          nicht abgerufen.
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

      {vorschlaege.length === 0 && verankert.length === 0 && routine.length === 0 ? (
        <Alert severity="info">
          Nichts auf dem Tisch. Der nächste Lauf um 13 Uhr liest die Kalender erneut.
        </Alert>
      ) : (
        <>
          <Typography variant="subtitle2" color="text.secondary">
            {vorschlaege.length === 0
              ? 'Kein Vorschlag — die Sichtung hielt nichts für berichtenswert.'
              : `${vorschlaege.length} vorgeschlagen`}
          </Typography>
          <Stack spacing={2}>
            {vorschlaege.map((a) => (
              <Zeile key={a.id} anlass={a} />
            ))}
          </Stack>

          {verankert.length > 0 && (
            <Box>
              <Button onClick={() => setVerankertOffen((o) => !o)}>
                {verankertOffen
                  ? 'Weitere mit Anker ausblenden'
                  : `Weitere ${verankert.length} mit Anker anzeigen — nichts wird weggeworfen`}
              </Button>
              <Collapse in={verankertOffen} unmountOnExit>
                <Stack spacing={2} sx={{ mt: 2 }}>
                  {verankert.map((a) => (
                    <Zeile key={a.id} anlass={a} />
                  ))}
                </Stack>
              </Collapse>
            </Box>
          )}

          {routine.length > 0 && (
            <Box>
              <Button onClick={() => setRoutineOffen((o) => !o)}>
                {routineOffen ? 'Routine ausblenden' : `Routine (${routine.length}) anzeigen`}
              </Button>
              <Collapse in={routineOffen} unmountOnExit>
                <Stack spacing={1.5} sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    Was jede Woche stattfindet, ist keine Meldung — aber genau das, was Neuzugezogene wissen
                    wollen. „Alle sechs Monate" legt es der Sichtung zweimal im Jahr vor, höchstens eines pro
                    Gemeinde und Woche. Abfuhrtermine gehören auf den Entsorgungstisch und stehen nur hier,
                    damit sichtbar ist, dass sie erkannt wurden.
                  </Typography>
                  {routine.map((a) => (
                    <RoutineZeile key={a.id} anlass={a} />
                  ))}
                </Stack>
              </Collapse>
            </Box>
          )}
        </>
      )}

      <Dialog open={ablehnung !== null} onClose={() => setAblehnung(null)} fullWidth maxWidth="sm">
        <DialogTitle>Anlass ablehnen</DialogTitle>
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
