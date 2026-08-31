'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@apollo/client/react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { EDITIONS_QUERY, type EditionsQueryResult } from '@/graphql/editions'
import { PUNKT6_EDITIONS_QUERY, type Punkt6EditionsQueryResult } from '@/graphql/punkt6-editions'
import type { AlleMeldungFelder, SendungskandidatFelder } from '@/graphql/redaktion'
import { LIVE_FETCH_POLICY } from '@/lib/apollo'
import { kandidatenJeEdition, meldungJeKandidat } from '@/lib/sendungen'
import { EditionCard } from './EditionCard'
import { Punkt6EditionCard } from './Punkt6EditionCard'
import type { SendungsKandidatProps } from './SendungsKandidat'
import type { MeldungAktion } from './MeldungKarte'

export interface SendungsDurchsichtProps {
  sendung: 'regionaljournal' | 'punkt6'
  kandidaten: readonly SendungskandidatFelder[]
  meldungen: readonly AlleMeldungFelder[]
  laeuft?: boolean
  onPostfach?: () => Promise<void> | void
  onMeldung?: (id: string) => Promise<void> | void
  onAblehnen?: (id: string, grund: string, kommentar: string | null) => Promise<void> | void
  onWeiterreichen?: (id: string, begruendung: string | null) => Promise<void> | void
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion) => Promise<void>
}

/**
 * The review of one show — the ported view, unchanged in shape.
 *
 * Both shows read the same way: newest broadcast first, one card per
 * contribution, the player and its timestamp jumps. What the newsroom added is
 * the highlighted candidate block inside a card, and only where there is one:
 * the people who use this view to keep an eye on the region are not necessarily
 * the ones writing municipality news.
 */
export function SendungsDurchsicht({
  sendung,
  kandidaten,
  meldungen,
  laeuft = false,
  onPostfach,
  onMeldung,
  onAblehnen,
  onWeiterreichen,
  onChat,
  onAktion
}: SendungsDurchsichtProps) {
  const istPunkt6 = sendung === 'punkt6'
  const [holt, setHolt] = useState(false)

  const rj = useQuery<EditionsQueryResult>(EDITIONS_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY,
    skip: istPunkt6
  })
  const p6 = useQuery<Punkt6EditionsQueryResult>(PUNKT6_EDITIONS_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY,
    skip: !istPunkt6
  })

  const abfrage = istPunkt6 ? p6 : rj
  const jeEdition = useMemo(() => kandidatenJeEdition(kandidaten), [kandidaten])
  const jeKandidat = useMemo(() => meldungJeKandidat(meldungen), [meldungen])

  const weiterreichen: Partial<SendungsKandidatProps> = {
    ...(onMeldung === undefined ? {} : { onMeldung }),
    ...(onAblehnen === undefined ? {} : { onAblehnen }),
    ...(onWeiterreichen === undefined ? {} : { onWeiterreichen }),
    ...(onChat === undefined ? {} : { onChat }),
    ...(onAktion === undefined ? {} : { onAktion })
  }

  const beitraege = istPunkt6 ? (p6.data?.punkt6_editions ?? []) : (rj.data?.editions ?? [])

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {istPunkt6 ? 'punkt6 (Telebasel)' : 'Regionaljournal Basel Baselland'}
        </Typography>
        {onPostfach !== undefined && (
          <Button
            variant="outlined"
            disabled={laeuft || holt}
            onClick={async () => {
              setHolt(true)
              try {
                await onPostfach()
                await abfrage.refetch()
              } finally {
                setHolt(false)
              }
            }}
          >
            {holt ? 'Prüft …' : 'Postfach jetzt prüfen'}
          </Button>
        )}
      </Stack>

      {abfrage.error !== undefined && (
        <Alert severity="error">Sendungen konnten nicht geladen werden: {abfrage.error.message}</Alert>
      )}

      {abfrage.loading && beitraege.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!abfrage.loading && beitraege.length === 0 && abfrage.error === undefined && (
        <Alert severity="info">
          Noch keine Sendungen. Der tägliche Lauf holt die Dossiers aus dem Postfach; „Postfach jetzt prüfen“
          macht dasselbe von Hand.
        </Alert>
      )}

      {istPunkt6
        ? (p6.data?.punkt6_editions ?? []).map((edition) => (
            <Punkt6EditionCard
              key={edition.id}
              edition={edition}
              kandidaten={jeEdition.get(edition.id) ?? []}
              meldungen={jeKandidat}
              laeuft={laeuft}
              onKandidat={weiterreichen}
            />
          ))
        : (rj.data?.editions ?? []).map((edition) => (
            <EditionCard
              key={edition.id}
              edition={edition}
              kandidaten={jeEdition.get(edition.id) ?? []}
              meldungen={jeKandidat}
              laeuft={laeuft}
              onKandidat={weiterreichen}
            />
          ))}
    </Stack>
  )
}
