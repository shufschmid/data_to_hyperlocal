'use client'

import { useRef } from 'react'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { EditionFields } from '@/graphql/editions'
import { formatBroadcastDate } from '@/lib/editions'
import { TranscriptList } from './TranscriptList'
import { SendungsKandidat, type SendungsKandidatProps } from './SendungsKandidat'
import type { AlleMeldungFelder, SendungskandidatFelder } from '@/graphql/redaktion'
import { bleibtOffen } from '@/lib/sendungen'

// Presentational: props in, callback out. The one piece of local state
// (the audio element ref) is UI-only - not data, so it stays here rather than
// being lifted to the fetching component.
export interface EditionCardProps {
  edition: EditionFields
  /** Gemeinde-Vorschläge zu diesem Beitrag — leer bei den allermeisten. */
  kandidaten?: readonly SendungskandidatFelder[]
  meldungen?: Map<string, AlleMeldungFelder>
  laeuft?: boolean
  onKandidat?: Partial<SendungsKandidatProps>
}

export function EditionCard({ edition, kandidaten = [], meldungen, laeuft, onKandidat }: EditionCardProps) {
  const audioRef = useRef<HTMLAudioElement>(null)

  function seekTo(seconds: number) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = seconds
    void audio.play()
  }

  const lead = edition.lead ?? edition.teaser_blocks?.[0] ?? null
  const hasAudio = edition.audio_url !== null

  // Ein Beitrag kann mehrere Kandidaten tragen (eine Sendung, mehrere
  // Gemeinden) — darum eine Liste, nicht einer.
  const meineKandidaten = kandidaten.filter((k) => bleibtOffen(k, meldungen?.get(k.id)?.status ?? null))

  return (
    <Box component="article" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {formatBroadcastDate(edition)}
        </Typography>
        {edition.edition_label !== null && (
          <Chip label={edition.edition_label} color="primary" size="small" />
        )}
      </Stack>

      <Typography variant="h2" sx={{ mb: 1 }}>
        {edition.headline}
      </Typography>

      {lead !== null && (
        <Typography variant="body1" sx={{ mb: 1.5 }}>
          {lead}{' '}
          {hasAudio && (
            <Link component="button" type="button" onClick={() => seekTo(0)} sx={{ fontWeight: 400 }}>
              🎧 Beitrag anhören
            </Link>
          )}
        </Typography>
      )}

      {edition.extra_topics !== null && edition.extra_topics.length > 0 && (
        <Stack spacing={1.5} sx={{ mb: 1.5 }}>
          {edition.extra_topics.map((topic) => {
            const seconds = topic.paragraphSeconds
            return (
              <Box key={topic.headline} sx={{ pl: 1.5, borderLeft: 2, borderColor: 'divider' }}>
                <Typography variant="subtitle2">{topic.headline}</Typography>
                {topic.summary !== null && (
                  <Typography variant="body2" color="text.secondary">
                    {topic.summary}{' '}
                    {seconds !== null && hasAudio && (
                      <Link
                        component="button"
                        type="button"
                        onClick={() => seekTo(seconds)}
                        sx={{ fontWeight: 700 }}
                      >
                        🎧 Beitrag anhören
                      </Link>
                    )}
                  </Typography>
                )}
              </Box>
            )
          })}
        </Stack>
      )}

      {hasAudio ? (
        <>
          <audio
            ref={audioRef}
            controls
            preload="none"
            src={edition.audio_url ?? undefined}
            style={{ width: '100%', marginBottom: 12, display: 'block' }}
          />
          {edition.transcript !== null && edition.transcript.length > 0 && (
            <Accordion disableGutters elevation={0} sx={{ '&::before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="body2" color="primary" sx={{ fontWeight: 600 }}>
                  Transkript der ganzen Sendung
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <TranscriptList paragraphs={edition.transcript} onSeek={seekTo} />
              </AccordionDetails>
            </Accordion>
          )}
        </>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1.5 }}>
          Audio konnte nicht aufgelöst werden.
        </Typography>
      )}

      {meineKandidaten.map((kandidat) => (
        <SendungsKandidat
          key={kandidat.id}
          kandidat={kandidat}
          meldung={meldungen?.get(kandidat.id)}
          laeuft={laeuft ?? false}
          {...onKandidat}
        />
      ))}
    </Box>
  )
}
