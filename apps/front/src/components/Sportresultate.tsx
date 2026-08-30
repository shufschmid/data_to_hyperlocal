'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { AlleMeldungFelder, MeldungFelder, SpielFelder } from '@/graphql/redaktion'
import {
  berichtenswerteSpiele,
  formatiereZeitpunkt,
  resultat,
  statusText,
  teileSpiele
} from '@/lib/redaktion'
import { MeldungKarte, type MeldungAktion } from './MeldungKarte'

// Results and fixtures of the clubs the newsroom follows.
//
// The counterpart to the statistics feed: same idea, a source that publishes on
// its own schedule, watched daily. What differs is the shape — a statistic
// arrives once a year for every municipality at once, a match arrives every
// weekend for one club.
//
// Read-only. The connector writes these rows; nothing here edits them.

const ALLE = '__alle__'

export interface SportresultateProps {
  spiele: readonly SpielFelder[]
  laedt?: boolean
  /** The clock that separates played from upcoming. Injected by tests. */
  jetzt?: Date
  /** The reports themselves, so a match can show the text written about it. */
  berichte?: readonly AlleMeldungFelder[]
  /** Writes a report for every result that has none yet. */
  onMeldungenErzeugen?: () => Promise<void>
  /** Stellt alle fertigen Spielberichte auf einmal scharf. */
  onAllePublizieren?: () => Promise<void>
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion) => Promise<void>
  laeuft?: boolean
}

export function Sportresultate({
  spiele,
  laedt = false,
  jetzt,
  berichte = [],
  onMeldungenErzeugen,
  onAllePublizieren,
  onChat,
  onAktion,
  laeuft = false
}: SportresultateProps) {
  const [gemeinde, setGemeinde] = useState(ALLE)
  const [sportart, setSportart] = useState(ALLE)

  // Options come from the data, not a fixed list: a sport shows up here the
  // moment its first match is recorded.
  const gemeinden = useMemo(() => {
    const namen = new Map<string, string>()
    for (const spiel of spiele) {
      if (spiel.gemeinde !== null) namen.set(spiel.gemeinde.id, spiel.gemeinde.name)
    }
    return [...namen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'de-CH'))
  }, [spiele])

  const sportarten = useMemo(
    () => [...new Set(spiele.map((s) => s.sportart))].sort((a, b) => a.localeCompare(b, 'de-CH')),
    [spiele]
  )

  const gefiltert = useMemo(
    () =>
      spiele.filter(
        (spiel) =>
          (gemeinde === ALLE || spiel.gemeinde?.id === gemeinde) &&
          (sportart === ALLE || spiel.sportart === sportart)
      ),
    [spiele, gemeinde, sportart]
  )

  const { vergangen, kommend } = useMemo(
    () => teileSpiele(gefiltert, jetzt ?? new Date()),
    [gefiltert, jetzt]
  )

  // Counted across every match, not just the filtered view: the button writes
  // for all of them, so a count that followed the filter would promise less
  // than it does.
  const nachSpiel = useMemo(() => {
    const karte = new Map<string, AlleMeldungFelder>()
    for (const bericht of berichte) {
      if (bericht.spiel !== null) karte.set(bericht.spiel.id, bericht)
    }
    return karte
  }, [berichte])
  // Nur was ueberhaupt einen Bericht bekaeme: die erste Mannschaft je Verein.
  // Ohne diese Einschraenkung zaehlte der Knopf dauerhaft Spiele mit, die das
  // Backend nie schreibt — er blieb aktiv und meldete jedes Mal „nichts zu tun".
  const offen = useMemo(() => {
    const berichtenswert = berichtenswerteSpiele(spiele)
    return spiele.filter(
      (spiel) =>
        spiel.tore_heim !== null &&
        spiel.tore_gast !== null &&
        !nachSpiel.has(spiel.id) &&
        berichtenswert.has(spiel)
    ).length
  }, [spiele, nachSpiel])
  // Was ein Klick scharf stellen wuerde. „in_pruefung“ zaehlt bewusst nicht mit:
  // eine Meldung beim Gegenlesen darf nicht hinter dem Ruecken der Pruefenden
  // publiziert werden — der Endpoint lehnt sie ohnehin ab.
  const bereit = useMemo(
    () => berichte.filter((b) => b.status === 'entwurf' || b.status === 'freigegeben').length,
    [berichte]
  )

  return (
    <Stack spacing={2}>
      {spiele.length === 0 && !laedt && (
        <Alert severity="info">
          Noch keine Spiele erfasst. Der Lauf „Sportresultate holen“ trägt sie ein, sobald der Verband die
          nächsten Begegnungen aufschaltet.
        </Alert>
      )}

      {(onMeldungenErzeugen !== undefined || onAllePublizieren !== undefined) && (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          {onMeldungenErzeugen !== undefined && (
            <Button
              variant="contained"
              disabled={laeuft || offen === 0}
              onClick={() => void onMeldungenErzeugen()}
            >
              {laeuft ? 'Wird geschrieben …' : 'Meldungen erzeugen'}
            </Button>
          )}
          {onAllePublizieren !== undefined && (
            <Button disabled={laeuft || bereit === 0} onClick={() => void onAllePublizieren()}>
              Alle Meldungen publizieren
            </Button>
          )}
          <Typography variant="body2" color="text.secondary">
            {offen === 0
              ? 'Alle vorliegenden Resultate haben eine Meldung.'
              : `${offen} ${offen === 1 ? 'Resultat wartet' : 'Resultate warten'} auf eine Meldung.`}
            {bereit > 0 &&
              ` ${bereit} ${bereit === 1 ? 'Meldung ist' : 'Meldungen sind'} bereit zum Publizieren.`}
          </Typography>
        </Stack>
      )}

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Gemeinde"
          value={gemeinde}
          onChange={(e) => setGemeinde(e.target.value)}
          sx={{ minWidth: 190 }}
        >
          <MenuItem value={ALLE}>Alle Gemeinden</MenuItem>
          {gemeinden.map(([id, name]) => (
            <MenuItem key={id} value={id}>
              {name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Sportart"
          value={sportart}
          onChange={(e) => setSportart(e.target.value)}
          sx={{ minWidth: 190 }}
        >
          <MenuItem value={ALLE}>Alle Sportarten</MenuItem>
          {sportarten.map((art) => (
            <MenuItem key={art} value={art}>
              {art}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <SpielListe
        titel="Resultate"
        spiele={vergangen}
        leer="Noch keine gespielten Begegnungen."
        berichte={nachSpiel}
        laeuft={laeuft}
        onChat={onChat}
        onAktion={onAktion}
      />
      <SpielListe
        titel="Kommende Begegnungen"
        spiele={kommend}
        leer="Zurzeit sind keine Spiele angesetzt."
        berichte={nachSpiel}
        laeuft={laeuft}
        onChat={onChat}
        onAktion={onAktion}
      />
    </Stack>
  )
}

function SpielListe({
  titel,
  spiele,
  leer,
  berichte,
  laeuft,
  onChat,
  onAktion
}: {
  titel: string
  spiele: readonly SpielFelder[]
  leer: string
  berichte: Map<string, AlleMeldungFelder>
  laeuft: boolean
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion) => Promise<void>
}) {
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="h3" component="h3" sx={{ fontSize: '1rem' }}>
          {titel}
        </Typography>
        <Chip size="small" label={spiele.length} />
      </Stack>

      {spiele.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {leer}
        </Typography>
      ) : (
        <Paper sx={{ p: 1 }}>
          <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
            {spiele.map((spiel) => (
              <SpielZeile
                key={spiel.id}
                spiel={spiel}
                bericht={berichte.get(spiel.id) ?? null}
                laeuft={laeuft}
                onChat={onChat}
                onAktion={onAktion}
              />
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  )
}

function SpielZeile({
  spiel,
  bericht,
  laeuft,
  onChat,
  onAktion
}: {
  spiel: SpielFelder
  bericht: AlleMeldungFelder | null
  laeuft: boolean
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion) => Promise<void>
}) {
  const [zeigeBericht, setZeigeBericht] = useState(false)
  const offen = spiel.tore_heim === null || spiel.tore_gast === null

  return (
    <Box sx={{ py: 0.75, px: 1 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {spiel.heim} — {spiel.gast}
        </Typography>
        <Typography
          variant="body2"
          sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: offen ? 400 : 700 }}
          color={offen ? 'text.secondary' : 'text.primary'}
        >
          {resultat(spiel.tore_heim, spiel.tore_gast)}
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Die Sportart zuerst: sobald mehrere Verbaende liefern, ist sie das
            Erste, was eine Zeile einordnet. */}
        <Chip size="small" variant="outlined" label={spiel.sportart} />
        <Typography variant="caption" color="text.secondary">
          {formatiereZeitpunkt(spiel.datum)}
          {spiel.gemeinde === null ? '' : ` · ${spiel.gemeinde.name}`} · {spiel.wettbewerb}
          {spiel.ort === null ? '' : ` · ${spiel.ort}`}
        </Typography>
        {spiel.status !== null && <Chip size="small" color="warning" label={spiel.status} />}
        {bericht !== null && (
          <Button size="small" onClick={() => setZeigeBericht(!zeigeBericht)} aria-expanded={zeigeBericht}>
            {zeigeBericht ? 'Bericht zuklappen' : `Bericht anzeigen (${statusText(bericht.status)})`}
          </Button>
        )}
      </Stack>

      {/* Der Bericht steht bei seinem Spiel — als vollwertige Karte mit Chat
          und Einzelaktionen, dieselbe wie bei den Statistik-Meldungen. Erst auf
          Klick, weil ein Wochenende sechs Berichte in die Liste stellt. */}
      {bericht !== null && zeigeBericht && (
        <Box sx={{ mt: 1 }}>
          <MeldungKarte
            meldung={bericht as unknown as MeldungFelder}
            laeuft={laeuft}
            onChat={async (id, anweisung) => {
              await onChat?.(id, anweisung)
            }}
            onAktion={async (id, was) => {
              await onAktion?.(id, was)
            }}
          />
        </Box>
      )}
    </Box>
  )
}
