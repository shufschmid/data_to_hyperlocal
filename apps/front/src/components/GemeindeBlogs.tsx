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
import type { AlleMeldungFelder } from '@/graphql/redaktion'
import { absaetze, blogDatum, formatiereDatum, gemeindeSlug, statusFarbe, statusText } from '@/lib/redaktion'
import type { GemeindeBlog } from '@/lib/redaktion'

// Ein Blog je Gemeinde.
//
// Die Gegenansicht zur Produktion: die Zeitleiste zeigt, woher das Material
// kommt, hier steht, was bei einer Gemeinde herausgekommen ist. Herkunftsblind
// mit Absicht — ob ein Beitrag aus einer Statistik oder einem Spiel entstand,
// interessiert beim Lesen niemanden, und weitere Quellen reihen sich spaeter
// ohne Aenderung ein.

const ALLE = '__alle__'

export interface GemeindeBlogsProps {
  blogs: readonly GemeindeBlog<AlleMeldungFelder>[]
  laedt?: boolean
  /** Slug der gewaehlten Gemeinde, null fuer alle. Kommt aus der URL. */
  auswahl?: string | null
  /** Meldet die Wahl nach oben, damit die URL mitgeht. */
  onAuswahl?: (slug: string | null) => void
  /**
   * Stellt einen einzelnen Beitrag scharf.
   *
   * Der zweite Weg zum selben Ziel: publiziert wird dort, wo der Beitrag
   * entstanden ist (Statistik, Sport) — und hier, wo man ihn als Gemeinde
   * liest. Beim Durchsehen eines Gemeindeblogs ist das der kuerzere Weg.
   */
  onPublizieren?: (id: string) => Promise<void>
  laeuft?: boolean
}

export function GemeindeBlogs({
  blogs,
  laedt = false,
  auswahl = null,
  onAuswahl,
  onPublizieren,
  laeuft = false
}: GemeindeBlogsProps) {
  // Unkontrolliert nutzbar (Tests), kontrolliert im Panel — dort haelt die URL
  // die Wahl, damit ein Link wie ?gemeinde=riehen direkt den Blog oeffnet.
  const [intern, setIntern] = useState<string | null>(auswahl)
  const gewaehlt = onAuswahl === undefined ? intern : auswahl

  const sichtbar = useMemo(
    () => (gewaehlt === null ? blogs : blogs.filter((b) => gemeindeSlug(b.gemeinde.name) === gewaehlt)),
    [blogs, gewaehlt]
  )

  if (blogs.length === 0 && !laedt) {
    return (
      <Alert severity="info">
        Noch keine Beiträge. Sobald ein Lauf oder ein Spielbericht geschrieben wurde, steht er hier.
      </Alert>
    )
  }

  return (
    <Stack spacing={2}>
      <TextField
        select
        size="small"
        label="Gemeinde"
        value={gewaehlt ?? ALLE}
        onChange={(e) => {
          const slug = e.target.value === ALLE ? null : e.target.value
          setIntern(slug)
          onAuswahl?.(slug)
        }}
        sx={{ maxWidth: 260 }}
      >
        <MenuItem value={ALLE}>Alle Gemeinden</MenuItem>
        {blogs.map((b) => (
          <MenuItem key={b.gemeinde.id} value={gemeindeSlug(b.gemeinde.name)}>
            {b.gemeinde.name} ({b.beitraege.length})
          </MenuItem>
        ))}
      </TextField>

      {gewaehlt !== null && sichtbar.length === 0 && (
        <Alert severity="info">Fuer diese Gemeinde gibt es noch keine Beitraege.</Alert>
      )}

      {sichtbar.map((blog) => (
        <Paper key={blog.gemeinde.id} sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
              <Typography variant="h3" component="h3" sx={{ fontSize: '1.1rem' }}>
                {blog.gemeinde.name}
              </Typography>
              <Chip
                size="small"
                label={blog.beitraege.length === 1 ? '1 Beitrag' : `${blog.beitraege.length} Beiträge`}
              />
            </Stack>

            <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />} spacing={1.5}>
              {blog.beitraege.map((beitrag) => (
                <Beitrag
                  key={beitrag.id}
                  beitrag={beitrag}
                  {...(onPublizieren === undefined ? {} : { onPublizieren })}
                  laeuft={laeuft}
                />
              ))}
            </Stack>
          </Stack>
        </Paper>
      ))}
    </Stack>
  )
}

function Beitrag({
  beitrag,
  onPublizieren,
  laeuft = false
}: {
  beitrag: AlleMeldungFelder
  onPublizieren?: (id: string) => Promise<void>
  laeuft?: boolean
}) {
  // Woher der Beitrag stammt, steht als Herkunftszeile darunter — nicht als
  // Trennung, sondern als Beleg.
  const herkunft =
    beitrag.spiel !== null
      ? `${beitrag.spiel.sportart} · ${beitrag.spiel.heim} – ${beitrag.spiel.gast}`
      : 'Statistik'

  // Nur was auch publiziert werden darf: „in_pruefung“ gehoert den
  // Gegenlesenden, „verworfen“ ist entschieden.
  const scharfstellbar = beitrag.status === 'entwurf' || beitrag.status === 'freigegeben'

  return (
    <Box sx={{ pt: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          {formatiereDatum(blogDatum(beitrag))}
        </Typography>
        <Chip size="small" color={statusFarbe(beitrag.status)} label={statusText(beitrag.status)} />
        <Chip size="small" variant="outlined" label={herkunft} />
        {onPublizieren !== undefined && scharfstellbar && (
          <Button
            size="small"
            variant="outlined"
            disabled={laeuft}
            onClick={() => void onPublizieren(beitrag.id)}
          >
            Publizieren
          </Button>
        )}
      </Stack>

      <Typography variant="body2" sx={{ fontWeight: 700, mt: 0.5 }}>
        {beitrag.titel ?? '(ohne Titel)'}
      </Typography>
      {beitrag.lead !== null && (
        <Typography variant="body2" sx={{ fontStyle: 'italic', mb: 0.5 }}>
          {beitrag.lead}
        </Typography>
      )}
      {absaetze(beitrag.text).map((absatz, i) => (
        <Typography key={i} variant="body2" sx={{ mb: 0.5 }}>
          {absatz}
        </Typography>
      ))}
    </Box>
  )
}
