'use client'

import { useMemo } from 'react'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type {
  AlleMeldungFelder,
  GeschwindigkeitskontrolleFelder,
  RadarstandortFelder
} from '@/graphql/redaktion'
import { MeldungKarte, type MeldungAktion, type MeldungAktionKoerper } from './MeldungKarte'
import {
  bilanzText,
  datumLang,
  meisteText,
  monatLang,
  ordneMonate,
  ordneStandorte,
  RADAR_SEITE,
  schnellsterText,
  standortDetails,
  standortTitel,
  type MonatMitMeldung,
  type StandortMitMeldung
} from '@/lib/verkehr'

// Der Verkehr-Tisch: zwei Stapel, beide vom 6-Uhr-Lauf gefuellt, beide ohne
// Modellaufruf, bis eine Redaktorin den Knopf drueckt. Oben die neuen
// Radaranlagen in bespielten Gemeinden (der Vorschlag des Laufs), darunter die
// Monatsblaetter der Geschwindigkeitskontrollen, neuester Monat zuerst. Das
// ganze Blatt des Kantons liegt eine Klick weit darunter — vollstaendig, nie
// vorgeschlagen.

export type VerkehrsArt = 'standorte' | 'kontrollen'

export interface VerkehrProps {
  standorte: readonly RadarstandortFelder[]
  monate: readonly GeschwindigkeitskontrolleFelder[]
  meldungen: readonly AlleMeldungFelder[]
  onMeldung: (art: VerkehrsArt, id: string) => Promise<void>
  onChat: (id: string, anweisung: string) => Promise<void>
  onAktion: (id: string, aktion: MeldungAktion, koerper?: MeldungAktionKoerper) => Promise<void>
  laeuft?: boolean
}

interface ZeilenProps {
  laeuft: boolean
  onMeldung: VerkehrProps['onMeldung']
  onChat: VerkehrProps['onChat']
  onAktion: VerkehrProps['onAktion']
}

function StandortZeile({
  eintrag,
  laeuft,
  onMeldung,
  onChat,
  onAktion
}: ZeilenProps & { eintrag: StandortMitMeldung }) {
  const z = eintrag.standort
  const neu = z.vorschlag && eintrag.meldung === null
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {standortTitel(z)}
          </Typography>
          {z.gemeinde !== null && <Chip size="small" label={z.gemeinde.name} />}
          {neu && <Chip size="small" color="primary" label="Neu" />}
          {!z.aktiv && <Chip size="small" variant="outlined" label="nicht mehr auf dem Blatt" />}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {standortDetails(z)}
          {z.oertlichkeit === null ? '' : ` · ${z.oertlichkeit}`}
        </Typography>
        {z.vorschlag_begruendung !== null && (
          <Typography variant="body2">{z.vorschlag_begruendung}</Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          Standortliste der Polizei Basel-Landschaft
          {z.publikation_am === null ? '' : `, Stand ${datumLang(z.publikation_am)}`} ·{' '}
          <Link href={RADAR_SEITE} target="_blank" rel="noreferrer">
            Seite des Kantons
          </Link>
        </Typography>
        {eintrag.meldung !== null ? (
          <MeldungKarte
            meldung={eintrag.meldung}
            onChat={onChat}
            onAktion={onAktion}
            laeuft={laeuft}
            kompakt
          />
        ) : z.gemeinde !== null ? (
          <Stack direction="row">
            <Button
              size="small"
              variant={neu ? 'contained' : 'outlined'}
              disabled={laeuft}
              onClick={() => void onMeldung('standorte', z.id)}
            >
              Meldung erzeugen
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  )
}

function MonatZeile({
  eintrag,
  laeuft,
  onMeldung,
  onChat,
  onAktion
}: ZeilenProps & { eintrag: MonatMitMeldung }) {
  const m = eintrag.monat
  const meiste = eintrag.bilanz === null ? null : meisteText(eintrag.bilanz)
  const schnellster = eintrag.bilanz === null ? null : schnellsterText(eintrag.bilanz)
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Geschwindigkeitskontrollen {monatLang(m.jahr, m.monat)}
          </Typography>
          {m.gemeinde !== null && <Chip size="small" label={m.gemeinde.name} />}
          {eintrag.meldung === null && <Chip size="small" color="primary" label="ohne Meldung" />}
        </Stack>
        {eintrag.bilanz === null ? (
          <Alert severity="warning">Das Blatt trägt keine lesbare Bilanz — der Lauf hat es gemeldet.</Alert>
        ) : (
          <>
            <Typography variant="body2">{bilanzText(eintrag.bilanz)}</Typography>
            {meiste !== null && (
              <Typography variant="body2" color="text.secondary">
                {meiste}
              </Typography>
            )}
            {schnellster !== null && (
              <Typography variant="body2" color="text.secondary">
                {schnellster}
              </Typography>
            )}
          </>
        )}
        {(m.hinweise ?? []).map((hinweis) => (
          <Typography key={hinweis} variant="caption" color="warning.main">
            {hinweis}
          </Typography>
        ))}
        <Typography variant="caption" color="text.secondary">
          {m.polizei ?? 'Gemeindepolizei'}
          {m.stand === null ? '' : `, Blatt vom ${datumLang(m.stand)}`}
          {m.quelle_url === null ? null : (
            <>
              {' · '}
              <Link href={m.quelle_url} target="_blank" rel="noreferrer">
                PDF
              </Link>
            </>
          )}
        </Typography>
        {eintrag.meldung !== null ? (
          <MeldungKarte
            meldung={eintrag.meldung}
            onChat={onChat}
            onAktion={onAktion}
            laeuft={laeuft}
            kompakt
          />
        ) : (
          <Stack direction="row">
            <Button
              size="small"
              variant="contained"
              disabled={laeuft || eintrag.bilanz === null}
              onClick={() => void onMeldung('kontrollen', m.id)}
            >
              Meldung erzeugen
            </Button>
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}

export function Verkehr({
  standorte,
  monate,
  meldungen,
  onMeldung,
  onChat,
  onAktion,
  laeuft = false
}: VerkehrProps) {
  const gruppen = useMemo(() => ordneStandorte(standorte, meldungen), [standorte, meldungen])
  const monatsliste = useMemo(() => ordneMonate(monate, meldungen), [monate, meldungen])
  // Eine Anlage, deren Meldung in Arbeit ist, bleibt sichtbar — hier wird sie
  // redigiert. Publizierte und solche ohne Meldung falten sich weg.
  const inArbeit = gruppen.bespielt.filter((e) => e.meldung !== null && e.meldung.status !== 'publiziert')
  const uebrige = gruppen.bespielt.filter((e) => !inArbeit.includes(e))
  const zeilenProps = { laeuft, onMeldung, onChat, onAktion }

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Typography variant="h6">Radaranlagen der Polizei Basel-Landschaft</Typography>
        {standorte.length === 0 ? (
          <Alert severity="info">
            Noch kein Standortblatt gelesen. Der 6-Uhr-Lauf holt es, «Quellen jetzt prüfen» im Reiter
            Gemeinden ebenfalls.
          </Alert>
        ) : (
          <>
            {gruppen.vorschlaege.length === 0 && inArbeit.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Keine neue Anlage in einer bespielten Gemeinde.
              </Typography>
            )}
            {gruppen.vorschlaege.map((e) => (
              <StandortZeile key={e.standort.id} eintrag={e} {...zeilenProps} />
            ))}
            {inArbeit.map((e) => (
              <StandortZeile key={e.standort.id} eintrag={e} {...zeilenProps} />
            ))}
            {uebrige.length > 0 && (
              <Accordion disableGutters>
                <AccordionSummary>
                  <Typography variant="body2">
                    Weitere Anlagen in bespielten Gemeinden ({uebrige.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1}>
                    {uebrige.map((e) => (
                      <StandortZeile key={e.standort.id} eintrag={e} {...zeilenProps} />
                    ))}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            )}
            {gruppen.andere.length > 0 && (
              <Accordion disableGutters>
                <AccordionSummary>
                  <Typography variant="body2">
                    Alle anderen Standorte im Kanton ({gruppen.andere.length}) — nie vorgeschlagen
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={0.5}>
                    {gruppen.andere.map((z) => (
                      <Typography
                        key={z.id}
                        variant="body2"
                        color={z.aktiv ? 'text.primary' : 'text.secondary'}
                      >
                        {standortTitel(z)} · {standortDetails(z)}
                        {z.aktiv ? '' : ' · nicht mehr auf dem Blatt'}
                      </Typography>
                    ))}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            )}
          </>
        )}
      </Stack>

      <Stack spacing={1}>
        <Typography variant="h6">Geschwindigkeitskontrollen der Gemeindepolizei</Typography>
        {monate.length === 0 ? (
          <Alert severity="info">
            Noch kein Monatsblatt gelesen. Der 6-Uhr-Lauf holt die Monate der registrierten Seite.
          </Alert>
        ) : (
          monatsliste.map((e) => <MonatZeile key={e.monat.id} eintrag={e} {...zeilenProps} />)
        )}
      </Stack>
    </Stack>
  )
}
