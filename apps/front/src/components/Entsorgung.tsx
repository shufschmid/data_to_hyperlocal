'use client'

import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type {
  AlleMeldungFelder,
  EntsorgungskalenderFelder,
  EntsorgungsterminFelder,
  GemeindeFelder
} from '@/graphql/redaktion'
import { EntsorgungKalender } from './EntsorgungKalender'
import { EntsorgungMeldungen } from './EntsorgungMeldungen'
import { KalenderErfassen } from './KalenderErfassen'
import type { MeldungAktion } from './MeldungKarte'
import { erinnerungenZuGemeinde } from '@/lib/entsorgung'

// The Entsorgung tab: one calendar at a time.
//
// A municipality-and-year picker rather than a list of everything, because the
// unit of work here is one printed calendar: read it, confirm its dates, write
// its year. Showing eighty-seven at once would be a directory, not a workbench.

export interface EntsorgungProps {
  gemeinden: readonly GemeindeFelder[]
  kalender: readonly EntsorgungskalenderFelder[]
  termine: readonly EntsorgungsterminFelder[]
  meldungen: readonly AlleMeldungFelder[]
  /** Which calendar's termine are loaded — the parent fetches them. */
  gewaehlt: string | null
  onWaehlen: (kalender: string | null) => void
  onAnlegen: (eingabe: {
    gemeinde: string
    jahr: number
    url?: string
    datei?: { name: string; base64: string }
  }) => Promise<void>
  onAuslesen: (kalender: string) => Promise<void>
  onBestaetigen: (kalender: string, termine?: string[]) => Promise<void>
  onMeldungen: (kalender: string) => Promise<void>
  onFreigeben: (kalender: string) => Promise<void>
  onChat: (id: string, anweisung: string) => Promise<void>
  onAktion: (id: string, aktion: MeldungAktion) => Promise<void>
  laeuft?: boolean
  jetzt?: Date
}

export function Entsorgung({
  gemeinden,
  kalender,
  termine,
  meldungen,
  gewaehlt,
  onWaehlen,
  onAnlegen,
  onAuslesen,
  onBestaetigen,
  onMeldungen,
  onFreigeben,
  onChat,
  onAktion,
  laeuft = false,
  jetzt
}: EntsorgungProps) {
  const [ansicht, setAnsicht] = useState<'termine' | 'meldungen'>('termine')

  const aktueller = useMemo(
    () => kalender.find((eintrag) => eintrag.id === gewaehlt) ?? null,
    [kalender, gewaehlt]
  )

  const erinnerungen = useMemo(
    () => erinnerungenZuGemeinde(meldungen, aktueller?.gemeinde?.id ?? null),
    [meldungen, aktueller]
  )

  return (
    <Stack spacing={2}>
      <KalenderErfassen
        gemeinden={gemeinden}
        onAnlegen={onAnlegen}
        laeuft={laeuft}
        {...(jetzt === undefined ? {} : { jetzt })}
      />

      {kalender.length === 0 ? (
        <Alert severity="info">
          Noch kein Abfuhrkalender erfasst. Der gedruckte Kalender einer Gemeinde ist die Grundlage — er wird
          einmal im Jahr erfasst und liefert die Erinnerungen fuer alle aussergewoehnlichen Termine.
        </Alert>
      ) : (
        <Paper sx={{ p: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Kalender"
              value={gewaehlt ?? ''}
              onChange={(e) => onWaehlen(e.target.value === '' ? null : e.target.value)}
              size="small"
              sx={{ minWidth: 260 }}
            >
              {kalender.map((eintrag) => (
                <MenuItem key={eintrag.id} value={eintrag.id}>
                  {eintrag.gemeinde?.name ?? 'Ohne Gemeinde'} {eintrag.jahr}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Ansicht"
              value={ansicht}
              onChange={(e) => setAnsicht(e.target.value as 'termine' | 'meldungen')}
              size="small"
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="termine">Termine</MenuItem>
              <MenuItem value="meldungen">Erinnerungen</MenuItem>
            </TextField>
          </Stack>
        </Paper>
      )}

      {aktueller === null ? (
        kalender.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            Waehlen Sie einen Kalender.
          </Typography>
        )
      ) : ansicht === 'termine' ? (
        <EntsorgungKalender
          kalender={aktueller}
          termine={termine}
          onAuslesen={() => onAuslesen(aktueller.id)}
          onBestaetigen={(ids) => onBestaetigen(aktueller.id, ids)}
          onMeldungen={() => onMeldungen(aktueller.id)}
          onFreigeben={() => onFreigeben(aktueller.id)}
          laeuft={laeuft}
        />
      ) : (
        <EntsorgungMeldungen
          meldungen={erinnerungen}
          onChat={onChat}
          onAktion={onAktion}
          laeuft={laeuft}
          {...(jetzt === undefined ? {} : { jetzt })}
        />
      )}
    </Stack>
  )
}
