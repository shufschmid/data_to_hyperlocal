'use client'

import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { EntsorgungskalenderFelder, EntsorgungsterminFelder } from '@/graphql/redaktion'
import {
  fristZeitText,
  kalenderStatusFarbe,
  kalenderStatusText,
  kurzesDatum,
  langesDatum,
  termineNachMonat
} from '@/lib/entsorgung'

// One municipality's year, as it stands in the printed calendar.
//
// Laid out by month rather than as one long list, because that is the unit an
// editor checks against the paper in front of them. The grid is the same
// construction as the timeline — no calendar library, and no <Collapse> inside
// a grid row, which measures its height wrongly there and clips the content.

export interface EntsorgungKalenderProps {
  kalender: EntsorgungskalenderFelder
  termine: readonly EntsorgungsterminFelder[]
  onAuslesen: () => Promise<void>
  onBestaetigen: (termine?: string[]) => Promise<void>
  onMeldungen: () => Promise<void>
  onFreigeben: () => Promise<void>
  laeuft?: boolean
}

export function EntsorgungKalender({
  kalender,
  termine,
  onAuslesen,
  onBestaetigen,
  onMeldungen,
  onFreigeben,
  laeuft = false
}: EntsorgungKalenderProps) {
  const gruppen = termineNachMonat(termine)
  // The extraction runs detached on the server and takes minutes; while it
  // does, every write to this calendar would race the diff it is computing.
  const liest =
    kalender.status === 'liest' || kalender.dokumente.some((dokument) => dokument.status === 'liest')
  const gesperrt = laeuft || liest
  const offen = termine.filter((termin) => !termin.geprueft).length
  const mitWarnung = termine.filter((termin) => termin.warnung !== null).length
  const mitMeldung = termine.filter((termin) => termin.meldung !== null).length
  // Ob die Gemeinde ueberhaupt Zonen kennt. Nur dann ist "ganze Gemeinde" eine
  // Aussage — sonst ist es der Normalfall und braucht kein Etikett.
  const hatZonen = termine.some((termin) => termin.zone !== null)

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
          >
            <Typography variant="h2" component="h2" sx={{ fontSize: '1.1rem' }}>
              {kalender.gemeinde?.name ?? 'Ohne Gemeinde'} {kalender.jahr}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Chip
                size="small"
                label={kalenderStatusText(kalender.status)}
                color={kalenderStatusFarbe(kalender.status)}
              />
              {termine.length > 0 && (
                <Chip size="small" variant="outlined" label={`${termine.length} Termine`} />
              )}
            </Stack>
          </Stack>

          {/* One row per PDF: municipalities like Riehen print one document per
              zone, and each reads (or fails) on its own. */}
          {kalender.dokumente.length > 0 && (
            <Stack spacing={0.5}>
              {kalender.dokumente.map((dokument) => (
                <Stack
                  key={dokument.id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Chip size="small" variant="outlined" label={dokument.zone ?? 'ganze Gemeinde'} />
                  <Chip
                    size="small"
                    label={kalenderStatusText(dokument.status)}
                    color={kalenderStatusFarbe(dokument.status)}
                  />
                  {dokument.quelle_url !== null && (
                    <Link
                      href={dokument.quelle_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="caption"
                    >
                      PDF oeffnen
                    </Link>
                  )}
                  {dokument.zusatz !== null && (
                    <Typography variant="caption" color="text.secondary">
                      {dokument.zusatz}
                    </Typography>
                  )}
                </Stack>
              ))}
            </Stack>
          )}

          {kalender.dokumente.some((dokument) => dokument.fehler !== null) && (
            <Alert severity="error">
              <AlertTitle>Ein PDF konnte nicht ausgelesen werden</AlertTitle>
              {kalender.dokumente
                .filter((dokument) => dokument.fehler !== null)
                .map((dokument) => (
                  <Box key={dokument.id}>
                    {dokument.zone ?? 'Ganze Gemeinde'}: {dokument.fehler}
                  </Box>
                ))}
            </Alert>
          )}

          {liest && (
            <Alert severity="info">
              Die PDFs werden gerade ausgelesen — das dauert einige Minuten. Die Ansicht aktualisiert sich von
              selbst.
            </Alert>
          )}

          {mitWarnung > 0 && (
            <Alert severity="warning">
              Bei {mitWarnung} {mitWarnung === 1 ? 'Termin' : 'Terminen'} passt der Wochentag im PDF nicht zum
              Datum. Bitte gegen den gedruckten Kalender pruefen.
            </Alert>
          )}

          {kalender.merkblatt !== null && kalender.merkblatt !== '' && (
            <Box>
              <Typography variant="subtitle2">Merkblatt</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
                {kalender.merkblatt}
              </Typography>
            </Box>
          )}

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button size="small" onClick={() => void onAuslesen()} disabled={gesperrt}>
              {liest
                ? 'Wird ausgelesen …'
                : kalender.dokumente.length > 1
                  ? termine.length === 0
                    ? 'PDFs auslesen'
                    : 'PDFs neu auslesen'
                  : termine.length === 0
                    ? 'PDF auslesen'
                    : 'PDF neu auslesen'}
            </Button>
            <Button size="small" onClick={() => void onBestaetigen()} disabled={gesperrt || offen === 0}>
              {offen === 0 ? 'Alle Termine bestaetigt' : `${offen} Termine bestaetigen`}
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => void onMeldungen()}
              disabled={gesperrt || kalender.status !== 'geprueft'}
            >
              Meldungen fuers Jahr erzeugen
            </Button>
            <Button size="small" onClick={() => void onFreigeben()} disabled={gesperrt || mitMeldung === 0}>
              Alle freigeben
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {termine.length === 0 ? (
        <Alert severity="info">
          Noch keine Termine. „PDF auslesen“ liest den Kalender und legt die aussergewoehnlichen Abfuhren an —
          die woechentliche Kehrichtabfuhr bleibt bewusst aussen vor.
        </Alert>
      ) : (
        gruppen.map((gruppe) => (
          <Paper key={gruppe.monat} sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {gruppe.monat}{' '}
              <Typography component="span" variant="caption" color="text.secondary">
                — {gruppe.eintraege.length}
              </Typography>
            </Typography>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {gruppe.eintraege.map((termin) => (
                <Box
                  key={termin.id}
                  component="li"
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '5.5rem 1fr', sm: '6rem 1fr auto' },
                    gap: 1,
                    py: 1,
                    borderTop: 1,
                    borderColor: 'divider',
                    '&:first-of-type': { borderTop: 0 }
                  }}
                >
                  <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {kurzesDatum(termin.datum)}
                  </Typography>

                  <Box>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {termin.kategorie}
                      </Typography>
                      {termin.zone !== null ? (
                        <Chip size="small" variant="outlined" label={termin.zone} />
                      ) : (
                        hatZonen && <Chip size="small" variant="outlined" label="ganze Gemeinde" />
                      )}
                      {termin.warnung !== null && (
                        <Chip size="small" color="warning" label="Wochentag pruefen" />
                      )}
                      {termin.meldung !== null && (
                        <Chip size="small" color="success" variant="outlined" label="Meldung" />
                      )}
                    </Stack>
                    {termin.anmeldeschluss !== null && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Anmeldung bis {langesDatum(termin.anmeldeschluss)}
                        {termin.anmeldeschluss_zeit !== null &&
                          `, ${fristZeitText(termin.anmeldeschluss_zeit)}`}
                      </Typography>
                    )}
                    {termin.warnung !== null && (
                      <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                        {termin.warnung}
                      </Typography>
                    )}
                  </Box>

                  <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
                    {termin.geprueft ? (
                      <Typography variant="caption" color="text.secondary">
                        bestaetigt
                      </Typography>
                    ) : (
                      <Button
                        size="small"
                        onClick={() => void onBestaetigen([termin.id])}
                        disabled={gesperrt}
                      >
                        Bestaetigen
                      </Button>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          </Paper>
        ))
      )}
    </Stack>
  )
}
