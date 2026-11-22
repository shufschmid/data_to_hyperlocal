'use client'

import { useState, type ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { Eingangskorb as Korb } from '@/lib/eingang'
import { EINGANG_TAGE } from '@/lib/eingang'
import type { ZeitleistenEintrag } from '@/lib/redaktion'
import { Zeitleiste, type ZeitleisteProps } from './Zeitleiste'

// Der Tisch «data to hyperlocal» als Eingangskorb.
//
// Sortiert nach dem, was zu tun ist, nicht nach dem Datum (`lib/eingang.ts`
// hat die Regel und ihre Herkunft). Zuoberst und offen steht nur, was einen
// Entscheid braucht — etwas daraus machen oder vergessen. Alles andere ist ein
// eingeklapptes Fach mit seiner Zahl: nichts ist weg, und jede Zeile hat in
// jedem Fach dieselben Knöpfe.

export interface EingangskorbProps extends Omit<ZeitleisteProps, 'ergebnis' | 'anmerkungen' | 'onMehr'> {
  korb: Korb
}

type Fach = 'inArbeit' | 'demnaechst' | 'liegenGeblieben' | 'erledigt' | 'suedanflugVerlauf'

function Abschnitt({
  titel,
  anzahl,
  offen,
  onUmschalten,
  hinweis,
  children
}: {
  titel: string
  anzahl: number
  offen: boolean
  onUmschalten: () => void
  hinweis?: string
  children: ReactNode
}) {
  return (
    <Box>
      <Button
        size="small"
        color="inherit"
        aria-expanded={offen}
        onClick={onUmschalten}
        sx={{ px: 0, fontWeight: 600, textTransform: 'none' }}
      >
        {offen ? '▾' : '▸'} {titel} ({anzahl})
      </Button>
      {/* Zugeklappt wird nichts gerendert: das Fach «Liegen geblieben» hält
          leicht hundert Zeilen, und die haben im DOM nichts verloren. */}
      {offen && (
        <Stack spacing={1} sx={{ pt: 0.5 }}>
          {hinweis !== undefined && (
            <Typography variant="caption" color="text.secondary">
              {hinweis}
            </Typography>
          )}
          {children}
        </Stack>
      )}
    </Box>
  )
}

export function Eingangskorb({ korb, ...zeile }: EingangskorbProps) {
  const [offen, setOffen] = useState<ReadonlySet<Fach>>(new Set())
  const [aeltere, setAeltere] = useState(false)
  const schalte = (fach: Fach) =>
    setOffen((bisher) => {
      const neu = new Set(bisher)
      if (neu.has(fach)) neu.delete(fach)
      else neu.add(fach)
      return neu
    })

  const liste = (eintraege: ZeitleistenEintrag[], ohneDatum: ZeitleistenEintrag[] = []) => (
    <Zeitleiste
      {...zeile}
      ergebnis={{ datiert: eintraege, ohneDatum, weitere: 0 }}
      anmerkungen={korb.anmerkungen}
      onMehr={() => undefined}
    />
  )

  const kommt = korb.demnaechst.length + korb.ohneTermin.length
  const erledigtGesamt = korb.erledigt.length + korb.erledigtAelter.length

  return (
    <Stack spacing={2}>
      <Stack spacing={1}>
        <Typography variant="h3" component="h3" sx={{ fontSize: '1rem' }}>
          Neu — entscheiden ({korb.neu.length})
        </Typography>
        {korb.neu.length === 0 ? (
          <Alert severity="success">
            Nichts Neues. Sobald eine Quelle neue Zahlen bringt, steht es hier — mit «Meldungen erzeugen» oder
            «Vergiss es».
          </Alert>
        ) : (
          liste(korb.neu)
        )}
      </Stack>

      {korb.inArbeit.length > 0 && (
        <Abschnitt
          titel="In Arbeit"
          anzahl={korb.inArbeit.length}
          offen={offen.has('inArbeit')}
          onUmschalten={() => schalte('inArbeit')}
          hinweis="Die Meldungen sind geschrieben, aber noch nicht alle publiziert oder verworfen. Unter jeder Zeile stehen ihre Berichte mit dem Griff für alle."
        >
          {liste(korb.inArbeit)}
        </Abschnitt>
      )}

      {kommt > 0 && (
        <Abschnitt
          titel="Demnächst"
          anzahl={kommt}
          offen={offen.has('demnaechst')}
          onUmschalten={() => schalte('demnaechst')}
          hinweis="Was angekündigt ist und noch keine Zahlen hat. Ein Abstimmungssonntag erscheint hier in der Woche davor."
        >
          {liste(korb.demnaechst, korb.ohneTermin)}
        </Abschnitt>
      )}

      {korb.liegenGeblieben.length > 0 && (
        <Abschnitt
          titel="Liegen geblieben"
          anzahl={korb.liegenGeblieben.length}
          offen={offen.has('liegenGeblieben')}
          onUmschalten={() => schalte('liegenGeblieben')}
          hinweis={`Älter als ${EINGANG_TAGE} Tage und nie entschieden, oder Entwürfe, die seit ${EINGANG_TAGE} Tagen niemand angefasst hat. Nichts ist weg: jede Zeile hat ihre Knöpfe.`}
        >
          {liste(korb.liegenGeblieben)}
        </Abschnitt>
      )}

      {korb.suedanflugVerlauf.length > 0 && (
        <Abschnitt
          titel="Südanflug-Quote — frühere Monate"
          anzahl={korb.suedanflugVerlauf.length}
          offen={offen.has('suedanflugVerlauf')}
          onUmschalten={() => schalte('suedanflugVerlauf')}
          hinweis="Monate ohne Meldung. Neu ist immer nur der jüngste Monat; ein revidierter Monat rückt mit seinem neuen Stand nach oben."
        >
          {liste(korb.suedanflugVerlauf)}
        </Abschnitt>
      )}

      {erledigtGesamt > 0 && (
        <Abschnitt
          titel="Erledigt"
          anzahl={erledigtGesamt}
          offen={offen.has('erledigt')}
          onUmschalten={() => schalte('erledigt')}
          hinweis={`Alles publiziert oder verworfen, oder abgelegt — die letzten ${EINGANG_TAGE} Tage, das Neueste zuerst.`}
        >
          {korb.erledigt.length > 0 ? (
            liste(korb.erledigt)
          ) : (
            <Typography variant="body2" color="text.secondary">
              In den letzten {EINGANG_TAGE} Tagen wurde nichts erledigt.
            </Typography>
          )}
          {korb.erledigtAelter.length > 0 && (
            <Box>
              <Button size="small" onClick={() => setAeltere(!aeltere)}>
                {aeltere ? 'Ältere ausblenden' : `${korb.erledigtAelter.length} ältere zeigen`}
              </Button>
            </Box>
          )}
          {aeltere && korb.erledigtAelter.length > 0 && liste(korb.erledigtAelter)}
        </Abschnitt>
      )}
    </Stack>
  )
}
