'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
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
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined'
import type { AlleMeldungFelder, BuschtelefonFundFelder, GemeindeFelder } from '@/graphql/redaktion'
import type { TerminEingabe } from '@/lib/termin'
import { MeldungKarte, type MeldungAktion, type MeldungAktionKoerper } from './MeldungKarte'
import { Originaltext } from './Presseschau'
import {
  ABLEHNUNGSGRUENDE,
  MATERIAL_HINWEIS,
  datumText,
  einrichtungText,
  fundTitel,
  kanaele,
  kanalText,
  laufText,
  meldungJeFund,
  tisch,
  zahlenText,
  type BuschtelefonLaufStatus,
  type Filter
} from '@/lib/buschtelefon'

export interface BuschtelefonProps {
  funde: BuschtelefonFundFelder[]
  gemeinden: GemeindeFelder[]
  /** Alle Meldungen: die uebernommenen werden hier redigiert, nicht anderswo. */
  meldungen?: readonly AlleMeldungFelder[]
  laeuft?: boolean
  lauf?: BuschtelefonLaufStatus | null
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion, koerper?: MeldungAktionKoerper) => Promise<void>
  onTermin?: (id: string, eingabe: TerminEingabe) => Promise<void>
  onLauf?: () => Promise<void> | void
  onUebernehmen?: (id: string) => Promise<void> | void
  onAblehnen?: (id: string, grund: string, kommentar: string | null) => Promise<void> | void
  /** Setzt die Gemeinde eines Funds, der keine hat. */
  onGemeinde?: (id: string, gemeinde: string) => Promise<void> | void
}

/**
 * The Buschtelefon desk: raw, unconfirmed finds from the social networks of
 * the municipalities. A desk like the Kanton and SMD ones, slimmer: two
 * decisions per find (write a Meldung, or turn it down), no model proposal.
 * Group, account and link are shown here, for the editor only; none of them
 * enters the Meldung.
 */
export function Buschtelefon({
  funde,
  gemeinden,
  meldungen = [],
  laeuft = false,
  lauf = null,
  onChat,
  onAktion,
  onTermin,
  onLauf,
  onUebernehmen,
  onAblehnen,
  onGemeinde
}: BuschtelefonProps) {
  const [filter, setFilter] = useState<Filter>({ gemeinde: null, kanal: null, suche: '' })
  const [ablehnung, setAblehnung] = useState<BuschtelefonFundFelder | null>(null)
  const [grund, setGrund] = useState('nicht_relevant')
  const [kommentar, setKommentar] = useState('')
  const [beschaeftigt, setBeschaeftigt] = useState<string | null>(null)

  const meldungZu = useMemo(() => meldungJeFund(meldungen), [meldungen])
  const statusJeFund = useMemo(
    () => new Map([...meldungZu].map(([id, m]) => [id, m.status] as const)),
    [meldungZu]
  )
  const sichtbar = useMemo(() => tisch(funde, filter, statusJeFund), [funde, filter, statusJeFund])
  const aktive = useMemo(() => gemeinden.filter((g) => g.aktiv), [gemeinden])
  const alleKanaele = useMemo(() => kanaele(funde), [funde])
  const unterwegs = lauf?.laeuft === true
  const laufHinweis = lauf === null ? null : laufText(lauf)
  const einrichtung = einrichtungText(lauf)
  const doubletteVon = useMemo(() => new Map(funde.map((f) => [f.kennung, f] as const)), [funde])

  async function fuehreAus(id: string, tun: () => Promise<void> | void) {
    setBeschaeftigt(id)
    try {
      await tun()
    } finally {
      setBeschaeftigt(null)
    }
  }

  function Zeile({ fund }: { fund: BuschtelefonFundFelder }) {
    const meldung = meldungZu.get(fund.id)
    const kommentare = fund.kommentare ?? []
    const original = fund.doublette_von === null ? null : (doubletteVon.get(fund.doublette_von) ?? null)

    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 1 }}>
            <Chip
              size="small"
              label={fund.gemeinde?.name ?? 'Gemeinde fehlt'}
              color={fund.gemeinde === null ? 'warning' : 'default'}
            />
            <Chip size="small" variant="outlined" label={kanalText(fund.kanal)} />
            <Chip size="small" variant="outlined" color="warning" label="nicht bestätigt" />
            {fund.doublette_von !== null && (
              <Chip
                size="small"
                color="warning"
                label={original === null ? 'Doublette' : `Doublette von «${fundTitel(original)}»`}
              />
            )}
          </Stack>

          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {fundTitel(fund)}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {[
              fund.veroeffentlicht_am === null
                ? 'Datum unbekannt'
                : datumText(fund.veroeffentlicht_am.slice(0, 10)),
              ...(fund.quelle_name === null ? [] : [fund.quelle_name]),
              zahlenText(fund)
            ].join(' · ')}
          </Typography>

          <Link
            href={fund.link}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            <OpenInNewOutlined fontSize="inherit" /> Original ansehen
          </Link>

          <Originaltext text={fund.text} />

          {kommentare.length > 0 && (
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                Kommentare ({kommentare.length} von {fund.n_kommentare})
              </Typography>
              {kommentare.map((k, i) => (
                <Typography key={i} variant="body2" sx={{ pl: 1, borderLeft: 2, borderColor: 'divider' }}>
                  {k.text}
                </Typography>
              ))}
            </Stack>
          )}

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

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
            {meldung === undefined && fund.gemeinde !== null && (
              <Button
                size="small"
                variant="contained"
                disabled={beschaeftigt === fund.id}
                onClick={() => fuehreAus(fund.id, () => onUebernehmen?.(fund.id))}
              >
                Meldung schreiben
              </Button>
            )}
            {meldung === undefined && fund.gemeinde === null && onGemeinde !== undefined && (
              <TextField
                select
                size="small"
                label="Gemeinde zuordnen"
                value=""
                onChange={(e) => {
                  const wert = e.target.value
                  if (wert !== '') void fuehreAus(fund.id, () => onGemeinde(fund.id, wert))
                }}
                sx={{ minWidth: 200 }}
              >
                {aktive.map((g) => (
                  <MenuItem key={g.id} value={g.id}>
                    {g.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {meldung === undefined && (
              <Button
                size="small"
                disabled={beschaeftigt === fund.id}
                onClick={() => {
                  setAblehnung(fund)
                  setGrund(fund.doublette_von === null ? 'nicht_relevant' : 'doublette')
                  setKommentar('')
                }}
              >
                Ablehnen
              </Button>
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
          Buschtelefon
        </Typography>
        <Button
          variant="outlined"
          disabled={laeuft || unterwegs || lauf?.eingerichtet === false}
          onClick={() => onLauf?.()}
          startIcon={unterwegs ? <CircularProgress size={16} /> : undefined}
        >
          {unterwegs ? 'Abruf läuft …' : laeuft ? 'Läuft …' : 'Jetzt abholen'}
        </Button>
      </Stack>

      <Alert severity="warning">{MATERIAL_HINWEIS}</Alert>

      {einrichtung !== null && <Alert severity="info">{einrichtung}</Alert>}
      {lauf?.fehler != null && (
        <Alert severity="error">Der letzte Abruf ist fehlgeschlagen: {lauf.fehler}</Alert>
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
          label="Kanal"
          value={filter.kanal ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, kanal: e.target.value === '' ? null : e.target.value }))}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">Alle Kanäle</MenuItem>
          {alleKanaele.map((k) => (
            <MenuItem key={k} value={k}>
              {kanalText(k)}
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

      {sichtbar.length === 0 ? (
        <Alert severity="info">
          Nichts auf dem Tisch. Der nächste Abruf läuft zur Minute 20 jeder Stunde.
        </Alert>
      ) : (
        <Stack spacing={2}>
          {sichtbar.map((f) => (
            <Zeile key={f.id} fund={f} />
          ))}
        </Stack>
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
    </Stack>
  )
}
