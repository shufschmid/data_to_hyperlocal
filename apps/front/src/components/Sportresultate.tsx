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
  ordneSpiele,
  resultat,
  statusFarbe,
  statusText
} from '@/lib/redaktion'
import { MeldungKarte, type MeldungAktion } from './MeldungKarte'

// Results and fixtures of the clubs the newsroom follows.
//
// The counterpart to the statistics feed: same idea, a source that publishes on
// its own schedule, watched daily. What differs is the shape — a statistic
// arrives once a year for every municipality at once, a match arrives every
// weekend for one club.
//
// Three sections, in the order the editor works (see `ordneSpiele`): the fresh
// results with their reports OPEN on the page — a report is a short notice, and
// hiding it behind a click made every morning start with six clicks — then
// everything still open, then the archive, where the reports fold away again.
//
// Read-only towards the fixtures. The connector writes those rows; only the
// reports are acted on here.

const ALLE = '__alle__'

export interface SportresultateProps {
  spiele: readonly SpielFelder[]
  laedt?: boolean
  /** The clock that separates the sections. Injected by tests. */
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

  // Nur die erste Mannschaft je Verein — Frauenteams und untere Ligen gehoeren
  // nicht auf diesen Tisch. Der Konnektor speichert sie seit dem Wechsel gar
  // nicht mehr und raeumt die vorhandenen im naechsten Lauf weg; bis dahin
  // (und falls ein Verein inzwischen abgeschaltet wurde) blendet das hier sie
  // aus, statt sie liegen zu lassen.
  const gefuehrt = useMemo(() => {
    const behalten = berichtenswerteSpiele(spiele)
    return spiele.filter((spiel) => behalten.has(spiel))
  }, [spiele])

  // Options come from the data, not a fixed list: a sport shows up here the
  // moment its first match is recorded.
  const gemeinden = useMemo(() => {
    const namen = new Map<string, string>()
    for (const spiel of gefuehrt) {
      if (spiel.gemeinde !== null) namen.set(spiel.gemeinde.id, spiel.gemeinde.name)
    }
    return [...namen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'de-CH'))
  }, [gefuehrt])

  const sportarten = useMemo(
    () => [...new Set(gefuehrt.map((s) => s.sportart))].sort((a, b) => a.localeCompare(b, 'de-CH')),
    [gefuehrt]
  )

  const gefiltert = useMemo(
    () =>
      gefuehrt.filter(
        (spiel) =>
          (gemeinde === ALLE || spiel.gemeinde?.id === gemeinde) &&
          (sportart === ALLE || spiel.sportart === sportart)
      ),
    [gefuehrt, gemeinde, sportart]
  )

  const { aktuelle, anstehend, archiv } = useMemo(
    () => ordneSpiele(gefiltert, jetzt ?? new Date()),
    [gefiltert, jetzt]
  )

  const nachSpiel = useMemo(() => {
    const karte = new Map<string, AlleMeldungFelder>()
    for (const bericht of berichte) {
      if (bericht.spiel !== null) karte.set(bericht.spiel.id, bericht)
    }
    return karte
  }, [berichte])
  // Gezaehlt wird ueber alle gefuehrten Spiele, nicht ueber die gefilterte
  // Ansicht: der Knopf schreibt fuer alle, ein Zaehler entlang des Filters
  // verspraeche weniger, als er tut.
  const offen = useMemo(
    () =>
      gefuehrt.filter(
        (spiel) => spiel.tore_heim !== null && spiel.tore_gast !== null && !nachSpiel.has(spiel.id)
      ).length,
    [gefuehrt, nachSpiel]
  )
  // Was ein Klick scharf stellen wuerde. „in_pruefung“ zaehlt bewusst nicht mit:
  // eine Meldung beim Gegenlesen darf nicht hinter dem Ruecken der Pruefenden
  // publiziert werden — der Endpoint lehnt sie ohnehin ab.
  const bereit = useMemo(
    () => berichte.filter((b) => b.status === 'entwurf' || b.status === 'freigegeben').length,
    [berichte]
  )

  return (
    <Stack spacing={2}>
      {gefuehrt.length === 0 && !laedt && (
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
        titel="Aktuelle Resultate"
        spiele={aktuelle}
        leer="Keine Resultate aus den letzten fünf Tagen."
        berichte={nachSpiel}
        berichtAnzeige="offen"
        laeuft={laeuft}
        onChat={onChat}
        onAktion={onAktion}
      />
      <SpielListe
        titel="Kommende Begegnungen"
        spiele={anstehend}
        leer="Zurzeit sind keine Spiele angesetzt."
        hinweis="Das nächste zuerst — zuoberst gespielte Partien, deren Resultat der Verband noch nicht publiziert hat."
        berichte={nachSpiel}
        berichtAnzeige="klappbar"
        laeuft={laeuft}
        onChat={onChat}
        onAktion={onAktion}
      />
      <SpielListe
        titel="Spiele-Archiv"
        spiele={archiv}
        leer="Noch nichts im Archiv."
        berichte={nachSpiel}
        berichtAnzeige="klappbar"
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
  hinweis,
  berichte,
  berichtAnzeige,
  laeuft,
  onChat,
  onAktion
}: {
  titel: string
  spiele: readonly SpielFelder[]
  leer: string
  hinweis?: string
  berichte: Map<string, AlleMeldungFelder>
  /** "offen": der Bericht steht ausgeklappt da. "klappbar": erst auf Klick. */
  berichtAnzeige: 'offen' | 'klappbar'
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
        {hinweis !== undefined && spiele.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {hinweis}
          </Typography>
        )}
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
                berichtAnzeige={berichtAnzeige}
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
  berichtAnzeige,
  laeuft,
  onChat,
  onAktion
}: {
  spiel: SpielFelder
  bericht: AlleMeldungFelder | null
  berichtAnzeige: 'offen' | 'klappbar'
  laeuft: boolean
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion) => Promise<void>
}) {
  const [aufgeklappt, setAufgeklappt] = useState(false)
  const offen = spiel.tore_heim === null || spiel.tore_gast === null
  const zeigeBericht = bericht !== null && (berichtAnzeige === 'offen' || aufgeklappt)

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
        {/* Die drei Einordnungen als Chips nebeneinander: Sportart, Gemeinde,
            und — wo eine Meldung existiert — ihr Redaktionsstatus. */}
        <Chip size="small" variant="outlined" label={spiel.sportart} />
        {spiel.gemeinde !== null && <Chip size="small" variant="outlined" label={spiel.gemeinde.name} />}
        {bericht !== null && (
          <Chip size="small" color={statusFarbe(bericht.status)} label={statusText(bericht.status)} />
        )}
        {spiel.status !== null && <Chip size="small" color="warning" label={spiel.status} />}
        <Typography variant="caption" color="text.secondary">
          {formatiereZeitpunkt(spiel.datum)} · {spiel.wettbewerb}
          {spiel.ort === null ? '' : ` · ${spiel.ort}`}
        </Typography>
        {bericht !== null && berichtAnzeige === 'klappbar' && (
          <Button size="small" onClick={() => setAufgeklappt(!aufgeklappt)} aria-expanded={aufgeklappt}>
            {aufgeklappt ? 'Bericht zuklappen' : 'Bericht anzeigen'}
          </Button>
        )}
      </Stack>

      {/* Der Bericht steht bei seinem Spiel — als vollwertige Karte mit Chat und
          Einzelaktionen, verkleinert, weil Gemeinde und Status schon als Chips
          auf der Zeile stehen. Bei den aktuellen Resultaten offen, weil eine
          kurze Notiz hinter einem Klick nur Klicks kostet; im Archiv klappbar,
          weil dort die Geschichte liegt. */}
      {zeigeBericht && bericht !== null && (
        <Box sx={{ mt: 1, mb: 0.5 }}>
          <MeldungKarte
            meldung={bericht as unknown as MeldungFelder}
            kompakt
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
