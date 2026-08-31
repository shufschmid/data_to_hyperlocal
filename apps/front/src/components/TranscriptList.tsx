'use client'

import ButtonBase from '@mui/material/ButtonBase'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { TranscriptParagraph } from '@/graphql/editions'

// Presentational: props in, callback out, no data fetching - keeps it trivially
// testable and independent from EditionCard.
export interface TranscriptListProps {
  paragraphs: TranscriptParagraph[]
  onSeek: (seconds: number) => void
}

export function TranscriptList({ paragraphs, onSeek }: TranscriptListProps) {
  return (
    <Stack spacing={1}>
      {paragraphs.map((paragraph) => (
        <ButtonBase
          key={paragraph.seconds}
          onClick={() => onSeek(paragraph.seconds)}
          sx={{ display: 'block', textAlign: 'left', borderRadius: 1, p: 0.5 }}
        >
          <Typography
            component="span"
            sx={{ color: 'primary.main', fontWeight: 700, mr: 1, fontVariantNumeric: 'tabular-nums' }}
          >
            {paragraph.timestamp}
          </Typography>
          <Typography component="span" variant="body2">
            {paragraph.text}
          </Typography>
        </ButtonBase>
      ))}
    </Stack>
  )
}
