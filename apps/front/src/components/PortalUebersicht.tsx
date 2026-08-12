'use client'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import type { PortalBereichFelder, PortalSeiteFelder } from '@/graphql/redaktion'
import { formatiereDatum } from '@/lib/redaktion'

// What the statistics portal holds, and what of it needs watching.
//
// The rule behind this screen is the newsroom's: check daily only what is
// broken down by municipality, is not in the open-data portal, and has no
// agenda entry. Everything else already arrives through those channels.
//
// So the interesting column is not "how many tables" but "why is this one not
// covered" — and every row says it, because a watch list nobody can question is
// a watch list nobody trusts.

export interface PortalUebersichtProps {
  bereiche: readonly PortalBereichFelder[]
  seiten: readonly PortalSeiteFelder[]
  /** Pages the inventory has not visited yet. */
  offen: number
  laeuft?: boolean
  onBeobachten: (id: string, beobachten: boolean) => void
}

export function PortalUebersicht({
  bereiche,
  seiten,
  offen,
  laeuft = false,
  onBeobachten
}: PortalUebersichtProps) {
  const beobachtet = bereiche.filter((b) => b.beobachten)
  const uebrige = bereiche.filter((b) => !b.beobachten)
  const gemeindetabellen = seiten.filter((s) => s.gemeindeebene)

  return (
    <Stack spacing={2}>
      {offen > 0 && (
        <Alert severity="info">
          Die Inventur läuft: noch {offen} Seiten zu lesen. Sie geht das Portal seitenweise durch und setzt
          bei jedem Lauf fort — die Liste unten wächst also noch.
          <LinearProgress sx={{ mt: 1 }} />
        </Alert>
      )}

      <Typography variant="body2" color="text.secondary">
        {bereiche.length} Zweige im Portal, {gemeindetabellen.length} Tabellen mit Gemeindedaten. Täglich
        geprüft werden {beobachtet.length} Zweige — die übrigen sind über data.bl.ch oder die Agenda
        abgedeckt.
      </Typography>

      {beobachtet.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h3" component="h3" sx={{ fontSize: '1rem' }}>
            Täglich geprüft
          </Typography>
          {beobachtet.map((bereich) => (
            <BereichZeile
              key={bereich.id}
              bereich={bereich}
              seiten={gemeindetabellen.filter((s) => s.bereich?.id === bereich.id)}
              laeuft={laeuft}
              onBeobachten={onBeobachten}
            />
          ))}
        </Stack>
      )}

      <Stack spacing={1}>
        <Typography variant="h3" component="h3" sx={{ fontSize: '1rem' }}>
          Nicht überwacht
        </Typography>
        {uebrige.map((bereich) => (
          <BereichZeile
            key={bereich.id}
            bereich={bereich}
            seiten={gemeindetabellen.filter((s) => s.bereich?.id === bereich.id)}
            laeuft={laeuft}
            onBeobachten={onBeobachten}
          />
        ))}
      </Stack>
    </Stack>
  )
}

interface BereichZeileProps {
  bereich: PortalBereichFelder
  seiten: readonly PortalSeiteFelder[]
  laeuft: boolean
  onBeobachten: (id: string, beobachten: boolean) => void
}

function BereichZeile({ bereich, seiten, laeuft, onBeobachten }: BereichZeileProps) {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Switch
            size="small"
            checked={bereich.beobachten}
            disabled={laeuft}
            onChange={(e) => onBeobachten(bereich.id, e.target.checked)}
            slotProps={{
              input: { 'aria-label': `Zweig ${bereich.pfad} täglich prüfen` }
            }}
          />
          <Box sx={{ flexGrow: 1 }}>
            <Link
              href={`https://statistik.bl.ch/web_portal/${bereich.pfad}`}
              target="_blank"
              rel="noopener noreferrer"
              variant="body2"
              underline="hover"
            >
              {bereich.pfad}
              {bereich.titel === '' ? '' : ` — ${bereich.titel}`}
            </Link>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {bereich.stand === null ? '—' : formatiereDatum(bereich.stand)}
          </Typography>
          {bereich.inventur_offen && (
            <Tooltip title="Die Inventur hat diesen Zweig noch nicht fertig gelesen.">
              <Chip size="small" variant="outlined" label="in Arbeit" />
            </Tooltip>
          )}
        </Stack>

        {seiten.length > 0 && (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, pl: 5 }}>
            {seiten.map((seite) => (
              <Box component="li" key={seite.id} sx={{ py: 0.25 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Link
                    href={`https://statistik.bl.ch/web_portal/${seite.pfad}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="body2"
                    underline="hover"
                  >
                    {seite.titel === '' ? seite.pfad : seite.titel}
                  </Link>
                  <Abdeckung seite={seite} />
                </Stack>
              </Box>
            ))}
          </Box>
        )}
      </Stack>
    </Paper>
  )
}

/** Why this table is watched — or what already covers it. */
function Abdeckung({ seite }: { seite: PortalSeiteFelder }) {
  if (seite.ods_datensatz !== null) {
    return (
      <Tooltip title={seite.hinweis ?? ''}>
        <Chip size="small" label={`Open Data ${seite.ods_datensatz}`} color="success" />
      </Tooltip>
    )
  }

  if (seite.ankuendigung !== null) {
    return (
      <Tooltip title={seite.hinweis ?? ''}>
        <Chip size="small" label={`Agenda: ${seite.ankuendigung.titel}`} color="info" />
      </Tooltip>
    )
  }

  if (seite.beobachten) {
    return (
      <Tooltip title={seite.hinweis ?? ''}>
        <Chip size="small" label="nur hier" color="warning" />
      </Tooltip>
    )
  }

  return (
    <Tooltip title={seite.hinweis ?? 'Noch nicht auf Abdeckung geprüft.'}>
      <Chip size="small" variant="outlined" label="noch offen" />
    </Tooltip>
  )
}
