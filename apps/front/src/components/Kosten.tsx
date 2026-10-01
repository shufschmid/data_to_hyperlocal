'use client'

import { Fragment, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  betrag,
  einstellungFuer,
  etatKnapp,
  tischName,
  tokensKurz,
  verlustText,
  type Modelleinstellung,
  type Modellpreis,
  type VerbrauchJeZweck,
  type VerbrauchsBilanz
} from '@/lib/verbrauch'

// Die Kosten je Tisch: Aufrufe, Tokens und Geld der letzten Tage, mit dem,
// was fuer nichts bezahlt wurde, in Rot — und seit 1.10.2026 der Regler
// dazu: Modell und Etat je Zweck oder je Tisch, und die Preise je Modell.
// Ein Etat ist rot, wenn die groesste Antwort nahe an ihn kam: dann senkt
// ihn niemand, ohne es zu sehen.

export type EinstellungsFelder = { zweck: string; modell: string | null; max_tokens: number | null }
export type PreisFelder = Omit<Modellpreis, 'quelle'>

export interface KostenProps {
  bilanz: VerbrauchsBilanz
  laeuft?: boolean
  onTage?: (tage: number) => void
  onEinstellung?: (e: EinstellungsFelder) => Promise<void>
  onPreis?: (p: PreisFelder) => Promise<void>
}

const STANDARD = ''
const EIGEN = 'eigen'

function Regler({
  zweck,
  aktuell,
  bilanz,
  laeuft,
  onEinstellung
}: {
  zweck: string
  aktuell: Modelleinstellung | null
  bilanz: VerbrauchsBilanz
  laeuft: boolean
  onEinstellung: KostenProps['onEinstellung']
}) {
  const [modell, setModell] = useState<string>(aktuell?.modell ?? STANDARD)
  const [etat, setEtat] = useState<string>(aktuell?.max_tokens == null ? '' : String(aktuell.max_tokens))
  const bekannt = modell === STANDARD || bilanz.modelle.some((m) => m.id === modell)
  const speichern = () =>
    void onEinstellung?.({
      zweck,
      modell: modell === STANDARD ? null : modell,
      max_tokens: etat.trim() === '' ? null : Number(etat)
    })
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
      <TextField
        select
        size="small"
        label="Modell"
        value={bekannt ? modell : EIGEN}
        onChange={(e) => {
          if (e.target.value !== EIGEN) setModell(e.target.value)
        }}
        slotProps={{ htmlInput: { 'aria-label': `Modell für ${zweck}` } }}
        sx={{ minWidth: 220 }}
      >
        <MenuItem value={STANDARD}>Standard (wie im Code)</MenuItem>
        {bilanz.modelle.map((m) => (
          <MenuItem key={m.id} value={m.id}>
            {m.name} — {m.hinweis}
          </MenuItem>
        ))}
        {!bekannt && <MenuItem value={EIGEN}>{modell}</MenuItem>}
      </TextField>
      <TextField
        size="small"
        label="Etat (Tokens)"
        value={etat}
        onChange={(e) => setEtat(e.target.value)}
        placeholder="wie im Code"
        slotProps={{ htmlInput: { 'aria-label': `Etat für ${zweck}`, inputMode: 'numeric' } }}
        sx={{ width: 150 }}
      />
      <Button
        size="small"
        variant="outlined"
        disabled={laeuft || onEinstellung === undefined}
        onClick={speichern}
      >
        Speichern
      </Button>
      {aktuell !== null && (
        <Button
          size="small"
          disabled={laeuft || onEinstellung === undefined}
          onClick={() => void onEinstellung?.({ zweck, modell: null, max_tokens: null })}
        >
          Zurücksetzen
        </Button>
      )}
    </Stack>
  )
}

type PreisFeld = 'eingabe_je_mio' | 'ausgabe_je_mio' | 'cache_lesen_je_mio' | 'cache_schreiben_je_mio'

function PreisZeile({
  preis,
  laeuft,
  onPreis
}: {
  preis: PreisFelder
  laeuft: boolean
  onPreis: KostenProps['onPreis']
}) {
  const [werte, setWerte] = useState<Record<PreisFeld, string>>({
    eingabe_je_mio: String(preis.eingabe_je_mio),
    ausgabe_je_mio: String(preis.ausgabe_je_mio),
    cache_lesen_je_mio: String(preis.cache_lesen_je_mio),
    cache_schreiben_je_mio: String(preis.cache_schreiben_je_mio)
  })
  const feld = (name: PreisFeld) => (
    <TableCell align="right">
      <TextField
        size="small"
        value={werte[name]}
        onChange={(e) => setWerte({ ...werte, [name]: e.target.value })}
        slotProps={{
          htmlInput: { 'aria-label': `${preis.modell} ${name}`, style: { textAlign: 'right', width: 64 } }
        }}
      />
    </TableCell>
  )
  return (
    <TableRow>
      <TableCell>{preis.modell}</TableCell>
      {feld('eingabe_je_mio')}
      {feld('ausgabe_je_mio')}
      {feld('cache_lesen_je_mio')}
      {feld('cache_schreiben_je_mio')}
      <TableCell>{preis.waehrung}</TableCell>
      <TableCell>
        <Button
          size="small"
          disabled={laeuft || onPreis === undefined}
          onClick={() =>
            void onPreis?.({
              modell: preis.modell,
              waehrung: preis.waehrung,
              eingabe_je_mio: Number(werte.eingabe_je_mio),
              ausgabe_je_mio: Number(werte.ausgabe_je_mio),
              cache_lesen_je_mio: Number(werte.cache_lesen_je_mio),
              cache_schreiben_je_mio: Number(werte.cache_schreiben_je_mio)
            })
          }
        >
          Speichern
        </Button>
      </TableCell>
    </TableRow>
  )
}

function Etat({ z }: { z: VerbrauchJeZweck }) {
  const text =
    z.max_tokens_zuletzt === null
      ? '–'
      : `${tokensKurz(z.max_tokens_zuletzt)} · max. Antwort ${tokensKurz(z.ausgabe_max)}`
  return etatKnapp(z) ? (
    <Typography component="span" variant="caption" color="error">
      {text}
    </Typography>
  ) : (
    <>{text}</>
  )
}

function Verlust({ s }: { s: Pick<VerbrauchJeZweck, 'abgebrochen' | 'fehler'> }) {
  const text = verlustText(s)
  if (text === null) return <>–</>
  return (
    <Typography variant="body2" color="error">
      {text}
    </Typography>
  )
}

export function Kosten({ bilanz, laeuft = false, onTage, onEinstellung, onPreis }: KostenProps) {
  const [offen, setOffen] = useState<string | null>(null)
  const [regler, setRegler] = useState<string | null>(null)
  const [preiseOffen, setPreiseOffen] = useState(false)
  const w = bilanz.waehrung
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            Kosten — was die Modellaufrufe der letzten {bilanz.tage} Tage brauchten
          </Typography>
          {onTage !== undefined &&
            [7, 30].map((t) => (
              <Button
                key={t}
                size="small"
                variant={bilanz.tage === t ? 'contained' : 'text'}
                onClick={() => onTage(t)}
              >
                {t} Tage
              </Button>
            ))}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {bilanz.gesamt.aufrufe.toLocaleString('de-CH')} Aufrufe, {betrag(bilanz.gesamt.kosten, w)} —{' '}
          {tokensKurz(bilanz.gesamt.eingabe_tokens)} Tokens Eingabe,{' '}
          {tokensKurz(bilanz.gesamt.ausgabe_tokens)} Ausgabe, {tokensKurz(bilanz.gesamt.cache_gelesen_tokens)}{' '}
          aus dem Cache. Ein Klick auf einen Tisch zeigt seine Zwecke mit Modell und Etat; dort stellst du
          beides um — leer heisst: wie im Code.
        </Typography>
        {bilanz.ohnePreis.length > 0 && (
          <Alert severity="warning" sx={{ py: 0 }}>
            Ohne Preis, darum ohne Geld in der Rechnung: {bilanz.ohnePreis.join(', ')}. Trage den Preis unten
            ein.
          </Alert>
        )}
        {bilanz.tische.length === 0 ? (
          <Alert severity="info">Noch kein Aufruf aufgezeichnet.</Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tisch</TableCell>
                <TableCell align="right">Aufrufe</TableCell>
                <TableCell align="right">Eingabe</TableCell>
                <TableCell align="right">Ausgabe</TableCell>
                <TableCell align="right">Kosten</TableCell>
                <TableCell>Für nichts</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {bilanz.tische.map((t) => (
                <Fragment key={t.tisch}>
                  <TableRow
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => setOffen(offen === t.tisch ? null : t.tisch)}
                  >
                    <TableCell>{tischName(t.tisch)}</TableCell>
                    <TableCell align="right">{t.aufrufe.toLocaleString('de-CH')}</TableCell>
                    <TableCell align="right">{tokensKurz(t.eingabe_tokens)}</TableCell>
                    <TableCell align="right">{tokensKurz(t.ausgabe_tokens)}</TableCell>
                    <TableCell align="right">{betrag(t.kosten, w)}</TableCell>
                    <TableCell>
                      <Verlust s={t} />
                    </TableCell>
                  </TableRow>
                  {offen === t.tisch && (
                    <>
                      <TableRow>
                        <TableCell colSpan={6} sx={{ pl: 4 }}>
                          <Stack spacing={1}>
                            <Typography variant="caption" color="text.secondary">
                              Für den ganzen Tisch {tischName(t.tisch)} (ein Zweck mit eigener Einstellung
                              geht vor)
                            </Typography>
                            <Regler
                              key={`${t.tisch}-tisch`}
                              zweck={t.tisch}
                              aktuell={bilanz.einstellungen.find((e) => e.zweck === t.tisch) ?? null}
                              bilanz={bilanz}
                              laeuft={laeuft}
                              onEinstellung={onEinstellung}
                            />
                          </Stack>
                        </TableCell>
                      </TableRow>
                      {t.zwecke.map((z) => {
                        const eingestellt = einstellungFuer(bilanz.einstellungen, z.zweck)
                        return (
                          <Fragment key={`${t.tisch}-${z.zweck}`}>
                            <TableRow>
                              <TableCell sx={{ pl: 4 }}>
                                <Typography variant="caption">{z.zweck}</Typography>
                                <br />
                                <Typography variant="caption" color="text.secondary">
                                  {z.modell_zuletzt ?? '–'}
                                  {eingestellt !== null ? ' · eingestellt' : ''} · Etat <Etat z={z} />
                                </Typography>
                              </TableCell>
                              <TableCell align="right">{z.aufrufe.toLocaleString('de-CH')}</TableCell>
                              <TableCell align="right">{tokensKurz(z.eingabe_tokens)}</TableCell>
                              <TableCell align="right">{tokensKurz(z.ausgabe_tokens)}</TableCell>
                              <TableCell align="right">{betrag(z.kosten, w)}</TableCell>
                              <TableCell>
                                <Button
                                  size="small"
                                  onClick={() => setRegler(regler === z.zweck ? null : z.zweck)}
                                >
                                  {regler === z.zweck ? 'Schliessen' : 'Einstellen'}
                                </Button>
                              </TableCell>
                            </TableRow>
                            {regler === z.zweck && (
                              <TableRow>
                                <TableCell colSpan={6} sx={{ pl: 4 }}>
                                  <Regler
                                    key={z.zweck}
                                    zweck={z.zweck}
                                    aktuell={bilanz.einstellungen.find((e) => e.zweck === z.zweck) ?? null}
                                    bilanz={bilanz}
                                    laeuft={laeuft}
                                    onEinstellung={onEinstellung}
                                  />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        )
                      })}
                    </>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Button size="small" onClick={() => setPreiseOffen(!preiseOffen)}>
            {preiseOffen ? 'Preise ausblenden' : `Preise je Modell (${bilanz.preise.length})`}
          </Button>
          <Typography variant="caption" color="text.secondary">
            je Million Tokens, aus der Anthropic-Preisliste — die Redaktion pflegt sie nach.
          </Typography>
        </Stack>
        {preiseOffen && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Modell</TableCell>
                <TableCell align="right">Eingabe</TableCell>
                <TableCell align="right">Ausgabe</TableCell>
                <TableCell align="right">Cache lesen</TableCell>
                <TableCell align="right">Cache schreiben</TableCell>
                <TableCell>Währung</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {bilanz.preise.map((p) => (
                <PreisZeile key={p.modell} preis={p} laeuft={laeuft} onPreis={onPreis} />
              ))}
              {bilanz.ohnePreis.map((modell) => (
                <PreisZeile
                  key={modell}
                  preis={{
                    modell,
                    eingabe_je_mio: 0,
                    ausgabe_je_mio: 0,
                    cache_lesen_je_mio: 0,
                    cache_schreiben_je_mio: 0,
                    waehrung: w ?? 'USD'
                  }}
                  laeuft={laeuft}
                  onPreis={onPreis}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Stack>
    </Paper>
  )
}
