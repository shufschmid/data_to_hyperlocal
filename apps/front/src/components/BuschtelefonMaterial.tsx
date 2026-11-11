'use client'

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type {
  BuschtelefonBild,
  BuschtelefonFundFelder,
  BuschtelefonGeteilt,
  BuschtelefonVerlinkt
} from '@/graphql/redaktion'
import {
  bildKopf,
  bildStatusText,
  geteiltVon,
  kommentareKopf,
  kommentarStandText,
  kommentarZeilen
} from '@/lib/buschtelefon'

// The material of a Buschtelefon find, as the desk shows it AND as the
// Chefredaktion shows it for a lead: one way to render a post, its image
// texts, the post it shares, its links and its comments. Presentational —
// the comments' open state belongs to the caller, because the desk renders
// its rows as inner components that remount on every render of the desk.

export const WORTLAUT = {
  bgcolor: 'action.hover',
  borderRadius: 1,
  p: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere'
} as const

/** One image as its own block: its head and either the text read from it, or its state in words. */
export function Bildblock({ bild }: { bild: BuschtelefonBild }) {
  const status = bildStatusText(bild)
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {[bildKopf(bild), bild.beschreibung ?? null, status, bild.text_abgeschnitten ? 'Text gekürzt' : null]
          .filter((t): t is string => t !== null && t !== '')
          .join(' · ')}
      </Typography>
      {status === null && (
        <Typography variant="body2" sx={WORTLAUT}>
          {bild.text}
        </Typography>
      )}
    </Box>
  )
}

/** The post this post shares — kept apart from the sharer's own words, with whose it is. */
export function GeteiltBlock({ geteilt }: { geteilt: BuschtelefonGeteilt }) {
  return (
    <Box sx={{ pl: 1.5, borderLeft: 2, borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary">
        {[
          'Geteilter Beitrag',
          geteiltVon(geteilt),
          geteilt.text_abgeschnitten === true ? 'Text gekürzt' : null
        ]
          .filter((t): t is string => t !== null && t !== '')
          .join(' · ')}
      </Typography>
      {geteilt.text != null && geteilt.text.trim() !== '' && (
        <Typography variant="body2" sx={WORTLAUT}>
          {geteilt.text}
        </Typography>
      )}
      {(geteilt.bilder ?? []).map((b) => (
        <Bildblock key={b.nr} bild={b} />
      ))}
      {geteilt.link != null && geteilt.link !== '' && (
        <Link href={geteilt.link} target="_blank" rel="noopener noreferrer" variant="body2">
          Geteilten Beitrag öffnen
        </Link>
      )}
    </Box>
  )
}

/** The links the post carries — a short link says that its target is unknown. */
export function VerlinktListe({ verlinkt }: { verlinkt: readonly BuschtelefonVerlinkt[] }) {
  if (verlinkt.length === 0) return null
  return (
    <Stack spacing={0.25}>
      <Typography variant="caption" color="text.secondary">
        Im Beitrag verlinkt
      </Typography>
      {verlinkt.map((v) => (
        <Link
          key={v.url}
          href={v.url}
          target="_blank"
          rel="noopener noreferrer"
          variant="body2"
          sx={{ overflowWrap: 'anywhere' }}
        >
          {v.titel != null && v.titel.trim() !== '' ? v.titel : v.url}
          {v.kurzlink === true ? ' (Kurzlink, Ziel unbekannt)' : ''}
        </Link>
      ))}
    </Stack>
  )
}

/** The post itself: its own words (or that it has none), every image, the shared post, the links. */
export function BeitragWortlaut({
  fund
}: {
  fund: Pick<BuschtelefonFundFelder, 'text' | 'bilder' | 'geteilt' | 'verlinkt'>
}) {
  return (
    <>
      {fund.text !== null && fund.text.trim() !== '' ? (
        <Typography variant="body2" sx={WORTLAUT}>
          {fund.text}
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          Der Beitrag hat keinen eigenen Text.
        </Typography>
      )}
      {(fund.bilder ?? []).map((b) => (
        <Bildblock key={b.nr} bild={b} />
      ))}
      {fund.geteilt !== null && <GeteiltBlock geteilt={fund.geteilt} />}
      <VerlinktListe verlinkt={fund.verlinkt ?? []} />
    </>
  )
}

/**
 * The comments behind a toggle that says how many there are — and where the
 * platform shows more than came through the door, that it is incomplete.
 */
export function KommentarListe({
  fund,
  offen,
  onUmschalten
}: {
  fund: Pick<BuschtelefonFundFelder, 'kommentare' | 'kommentare_fehlend' | 'kommentare_stand'> &
    Partial<Pick<BuschtelefonFundFelder, 'neue_kommentare'>>
  offen: boolean
  onUmschalten: () => void
}) {
  const zeilen = kommentarZeilen({
    kommentare: fund.kommentare,
    neue_kommentare: fund.neue_kommentare ?? null
  })
  if (zeilen.length === 0) return null
  return (
    <Box>
      <Button size="small" variant="text" sx={{ px: 0 }} onClick={onUmschalten}>
        {kommentareKopf(fund)}
      </Button>
      {/* unmountOnExit: three hundred comments have no business in the DOM while the box is closed. */}
      <Collapse in={offen} unmountOnExit>
        <Stack spacing={1} sx={{ maxHeight: 420, overflowY: 'auto', pr: 1 }}>
          {zeilen.map(({ kommentar: k, tiefe, neu, verblasst, autor }) => {
            const standText = kommentarStandText(k.stand)
            return (
              <Box
                key={k.kennung}
                data-testid="kommentar"
                data-tiefe={tiefe}
                sx={{
                  ml: tiefe * 3,
                  pl: 1.5,
                  borderLeft: 2,
                  borderColor: neu ? 'info.main' : 'divider',
                  opacity: verblasst ? 0.55 : 1
                }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {autor}
                  </Typography>
                  {neu && <Chip size="small" color="info" label="neu" />}
                  {standText !== null && (
                    <Typography variant="caption" color="text.secondary">
                      {standText}
                    </Typography>
                  )}
                  {k.text_abgeschnitten === true && (
                    <Typography variant="caption" color="text.secondary">
                      gekürzt
                    </Typography>
                  )}
                </Stack>
                {k.text !== null && k.text !== '' && (
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {k.text}
                  </Typography>
                )}
                {(k.bilder ?? []).map((b) => (
                  <Bildblock key={b.nr} bild={b} />
                ))}
              </Box>
            )
          })}
        </Stack>
      </Collapse>
    </Box>
  )
}
