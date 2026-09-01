'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@apollo/client/react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import LinearProgress from '@mui/material/LinearProgress'
import { EDITIONS_QUERY, type EditionsQueryResult } from '@/graphql/editions'
import { DOSSIERS_QUERY, type DossiersQueryResult } from '@/graphql/dossiers'
import { PUNKT6_DOSSIERS_QUERY, type Punkt6DossiersQueryResult } from '@/graphql/punkt6-dossiers'
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
  /** Holt die Dossiers. Antwortet mit den neu angelegten Zeilen. */
  onPostfach?: () => Promise<{ created: number; dossierIds: string[] } | null>
  /** Verarbeitet EIN Dossier — je Aufruf eine Anfrage, damit kein Proxy-Timeout droht. */
  onVerarbeiten?: (dossierId: string) => Promise<boolean>
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
  onVerarbeiten,
  onMeldung,
  onAblehnen,
  onWeiterreichen,
  onChat,
  onAktion
}: SendungsDurchsichtProps) {
  const istPunkt6 = sendung === 'punkt6'
  const [holt, setHolt] = useState(false)
  // Was der letzte Knopfdruck bewirkt hat. Ohne das war der Knopf stumm: er
  // holte fuenf Dossiers und auf dem Bildschirm aenderte sich nichts.
  const [bericht, setBericht] = useState<string | null>(null)
  const [fortschritt, setFortschritt] = useState<{ fertig: number; gesamt: number } | null>(null)

  const rj = useQuery<EditionsQueryResult>(EDITIONS_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY,
    skip: istPunkt6
  })
  const p6 = useQuery<Punkt6EditionsQueryResult>(PUNKT6_EDITIONS_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY,
    skip: !istPunkt6
  })

  const rjDossiers = useQuery<DossiersQueryResult>(DOSSIERS_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY,
    skip: istPunkt6
  })
  const p6Dossiers = useQuery<Punkt6DossiersQueryResult>(PUNKT6_DOSSIERS_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY,
    skip: !istPunkt6
  })

  const abfrage = istPunkt6 ? p6 : rj
  const offeneDossiers = istPunkt6
    ? (p6Dossiers.data?.punkt6_dossiers ?? [])
    : (rjDossiers.data?.dossiers ?? [])
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

  // `geholt` ist nur beim Postfach-Weg gesetzt — der Aufraeum-Knopf holt nichts,
  // und "14 Dossiers geholt" ohne Postfachlauf hat schon einmal in die Irre gefuehrt.
  async function verarbeiteAlle(ids: readonly string[], geholt: number | null): Promise<void> {
    let fertig = 0
    let gescheitert = 0
    for (const id of ids) {
      setFortschritt({ fertig, gesamt: ids.length })
      const ok = (await onVerarbeiten?.(id)) ?? false
      if (ok) fertig += 1
      else gescheitert += 1
    }
    setFortschritt(null)
    await Promise.all([abfrage.refetch(), istPunkt6 ? p6Dossiers.refetch() : rjDossiers.refetch()])
    const auftakt =
      geholt === null
        ? `${fertig} von ${ids.length} Dossier${ids.length === 1 ? '' : 's'} verarbeitet`
        : `${geholt} Dossier${geholt === 1 ? '' : 's'} geholt, ${fertig} verarbeitet`
    setBericht(auftakt + (gescheitert === 0 ? '.' : `, ${gescheitert} fehlgeschlagen.`))
  }

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
              setBericht(null)
              try {
                const ergebnis = await onPostfach()
                if (ergebnis === null) {
                  setBericht('Das Postfach konnte nicht abgefragt werden.')
                  return
                }
                if (ergebnis.created === 0) {
                  setBericht('Nichts Neues im Postfach.')
                  return
                }
                // Holen und Verarbeiten sind im Backend zwei Schritte — mehrere
                // 15-35-Sekunden-Laeufe in einer Anfrage reissen den
                // Proxy-Timeout. Die Reihenfolge fahren wir hier, eine Anfrage
                // je Dossier, mit sichtbarem Fortschritt.
                await verarbeiteAlle(ergebnis.dossierIds, ergebnis.created)
              } finally {
                setHolt(false)
                setFortschritt(null)
              }
            }}
          >
            {holt ? 'Prüft …' : 'Postfach jetzt prüfen'}
          </Button>
        )}
      </Stack>

      {fortschritt !== null && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            Verarbeite Dossier {fortschritt.fertig + 1} von {fortschritt.gesamt} — das dauert pro Sendung eine
            halbe Minute.
          </Typography>
          <LinearProgress
            variant="determinate"
            value={(fortschritt.fertig / Math.max(1, fortschritt.gesamt)) * 100}
          />
        </Box>
      )}

      {bericht !== null && fortschritt === null && (
        <Alert severity="info" onClose={() => setBericht(null)}>
          {bericht}
        </Alert>
      )}

      {/* Nachzuegler: was ein frueherer Lauf angelegt, aber nicht verarbeitet
          hat — sonst laege es unsichtbar in der Datenbank. */}
      {offeneDossiers.length > 0 && fortschritt === null && (
        <Alert
          severity="warning"
          action={
            onVerarbeiten === undefined ? null : (
              <Button
                size="small"
                disabled={laeuft || holt}
                onClick={async () => {
                  setHolt(true)
                  try {
                    await verarbeiteAlle(
                      offeneDossiers.map((d) => d.id),
                      null
                    )
                  } finally {
                    setHolt(false)
                    setFortschritt(null)
                  }
                }}
              >
                Jetzt verarbeiten
              </Button>
            )
          }
        >
          {offeneDossiers.length} Dossier{offeneDossiers.length === 1 ? '' : 's'} noch nicht verarbeitet
          {offeneDossiers.some((d) => d.status === 'failed') ? ' — darunter fehlgeschlagene.' : '.'}
        </Alert>
      )}

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
