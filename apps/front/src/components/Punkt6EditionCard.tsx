'use client'

import { useEffect, useRef } from 'react'
import type HlsType from 'hls.js'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { Punkt6EditionFields } from '@/graphql/punkt6-editions'
import { formatPunkt6BroadcastDate } from '@/lib/punkt6-editions'
import { TranscriptList } from './TranscriptList'
import { SendungsKandidat, type SendungsKandidatProps } from './SendungsKandidat'
import type { AlleMeldungFelder, SendungskandidatFelder } from '@/graphql/redaktion'
import { bleibtOffen } from '@/lib/sendungen'

// Presentational: props in, callback out - one Sendung, one shared video, same
// "main story + extra_topics, one player, seek links jump within it" shape as
// EditionCard. Unlike EditionCard's <audio>, telebasel.ch's video is HLS
// (adaptive bitrate, audio as a separate rendition group - see the comment on
// TelebaselEpisode.videoUrl) - a plain <video src> to it does not work, so this
// attaches hls.js for browsers without native HLS support (everything but Safari).
export interface Punkt6EditionCardProps {
  edition: Punkt6EditionFields
  /** Gemeinde-Vorschläge zu diesem Beitrag — leer bei den allermeisten. */
  kandidaten?: readonly SendungskandidatFelder[]
  meldungen?: Map<string, AlleMeldungFelder>
  laeuft?: boolean
  onKandidat?: Partial<SendungsKandidatProps>
}

export function Punkt6EditionCard({
  edition,
  kandidaten = [],
  meldungen,
  laeuft,
  onKandidat
}: Punkt6EditionCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<HlsType | null>(null)

  const hasVideo = edition.video_url !== null

  useEffect(() => {
    const video = videoRef.current
    const url = edition.video_url
    if (!video || url === null) return

    let cancelled = false

    // hls.js's own isSupported() (real MediaSource Extensions support), not
    // video.canPlayType(), decides this - verified against real Chrome that
    // canPlayType('application/vnd.apple.mpegurl') can return a non-empty,
    // false-positive answer there (Chrome parses just enough of an HLS manifest
    // to answer the mime-type query, then fails outright at actual playback with
    // "no supported source" once given a real multi-bitrate manifest with a
    // separate audio track, like telebasel.ch's). This is hls.js's own
    // documented detection order - prefer it whenever it's actually supported,
    // fall back to a native <video src> only when it genuinely is not (older
    // Safari/iOS).
    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return
      if (Hls.isSupported()) {
        const hls = new Hls()
        hls.loadSource(url)
        hls.attachMedia(video)
        hlsRef.current = hls
      } else if (video.canPlayType('application/vnd.apple.mpegurl') !== '') {
        video.src = url
      }
    })

    return () => {
      cancelled = true
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [edition.video_url])

  function seekTo(seconds: number) {
    const video = videoRef.current
    if (!video) return
    video.currentTime = seconds
    void video.play()
  }

  // Ein Beitrag kann mehrere Kandidaten tragen (eine Sendung, mehrere
  // Gemeinden) — darum eine Liste, nicht einer.
  const meineKandidaten = kandidaten.filter((k) => bleibtOffen(k, meldungen?.get(k.id)?.status ?? null))

  return (
    <Box component="article" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {formatPunkt6BroadcastDate(edition.broadcast_date)}
      </Typography>

      <Typography variant="h2" sx={{ mb: 1 }}>
        {edition.headline}
      </Typography>

      {edition.lead !== null && (
        <Typography variant="body1" sx={{ mb: 1.5 }}>
          {edition.lead}{' '}
          {hasVideo && (
            <Link
              component="button"
              type="button"
              onClick={() => seekTo(edition.main_start_seconds ?? 0)}
              sx={{ fontWeight: 400 }}
            >
              🎬 Beitrag ansehen
            </Link>
          )}
        </Typography>
      )}

      {/* telebasel.ch traegt die Beitragsmarken erst nachtraeglich ein — bis
          dahin gibt es Video und Transkript, aber keine Themenbloecke. Der
          taegliche Lauf versucht es von selbst erneut. */}
      {hasVideo &&
        edition.main_start_seconds === null &&
        (edition.extra_topics === null || edition.extra_topics.length === 0) && (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1.5 }}>
            telebasel.ch hat zu dieser Sendung noch keine Beitragsmarken publiziert — darum vorerst nur Video
            und Transkript. Die Aufbereitung nach Themen wird automatisch nachgeholt.
          </Typography>
        )}

      {edition.extra_topics !== null && edition.extra_topics.length > 0 && (
        <Stack spacing={1.5} sx={{ mb: 1.5 }}>
          {edition.extra_topics.map((topic) => (
            <Box key={topic.headline} sx={{ pl: 1.5, borderLeft: 2, borderColor: 'divider' }}>
              <Typography variant="subtitle2">{topic.headline}</Typography>
              {topic.summary !== null && (
                <Typography variant="body2" color="text.secondary">
                  {topic.summary}{' '}
                  {hasVideo && (
                    <Link
                      component="button"
                      type="button"
                      onClick={() => seekTo(topic.startSeconds)}
                      sx={{ fontWeight: 700 }}
                    >
                      🎬 Beitrag ansehen
                    </Link>
                  )}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}

      {hasVideo ? (
        <>
          <video
            ref={videoRef}
            controls
            preload="metadata"
            style={{ width: '100%', marginBottom: 12, display: 'block', borderRadius: 4 }}
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
          Video konnte nicht aufgelöst werden.
        </Typography>
      )}

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'flex-end', mt: 1.5 }}>
        {edition.episode_url !== null && (
          <Link href={edition.episode_url} target="_blank" rel="noopener noreferrer" variant="body2">
            Ganze Sendung auf telebasel.ch
          </Link>
        )}
      </Stack>
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
