'use client'

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import type { AlleMeldungFelder } from '@/graphql/redaktion'
import {
  formatiereDatum,
  nachQuartal,
  type ZeitleistenEintrag,
  type ZeitleistenErgebnis
} from '@/lib/redaktion'
import { LaufBerichte } from './LaufBerichte'

// Woher unser Material kommt — in einer Liste, nach Datum.
//
// Drei Quellen melden sich, und vorher war jede an einem anderen Ort: die Agenda
// im einen Reiter, das Portal im zweiten, die Katalogänderungen von data.bl.ch
// nirgends. Gerade die letzten sind der Grund für diese Ansicht: nur 9 von 188
// Datensätzen stehen in der Agenda, aus den übrigen entstehen Meldungen, deren
// Herkunft bisher nirgends stand.
//
// Angekündigte Einträge ohne Termin hängen unten, nach Quartal — so hat es das
// Amt auf seiner Seite, und dort ist die Gruppierung auch etwas wert. Sobald ein
// Datum kommt, rutscht der Eintrag von selbst nach oben.

const HERKUNFT: Record<
  ZeitleistenEintrag['herkunft'],
  { label: string; farbe: 'default' | 'info' | 'success' }
> = {
  agenda: { label: 'Agenda', farbe: 'info' },
  portal: { label: 'Portal', farbe: 'default' },
  datensatz: { label: 'data.bl.ch', farbe: 'success' }
}

export interface ZeitleisteProps {
  ergebnis: ZeitleistenErgebnis
  laeuft?: boolean
  /** Die Berichte je Lauf. Sie stehen jetzt unter ihrem Eintrag statt in einem eigenen Reiter. */
  berichteZuLauf?: Map<string, AlleMeldungFelder[]>
  /** Status je Lauf, fuer die Fortschrittszeile ueber den Berichten. */
  laufStatus?: Map<string, string>
  onStapelChat?: (laufId: string, anweisung: string) => Promise<void>
  onStapelAktion?: (laufId: string, aktion: 'pruefung' | 'publizieren') => Promise<void>
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: 'publizieren' | 'pruefung' | 'verwerfen') => Promise<void>
  onAuftrag: (eintrag: ZeitleistenEintrag) => void
  /** „Vergiss es" — dauerhaft, die tägliche Prüfung holt es nicht zurück. */
  onVerwerfen: (eintrag: ZeitleistenEintrag) => void
  onMehr: () => void
}

export function Zeitleiste({
  ergebnis,
  laeuft = false,
  berichteZuLauf,
  laufStatus,
  onStapelChat,
  onStapelAktion,
  onChat,
  onAktion,
  onAuftrag,
  onVerwerfen,
  onMehr
}: ZeitleisteProps) {
  // Einmal gebuendelt statt in jeder Zeile: `Zeile` bekommt nur, was sie
  // betrifft, und die Signatur bleibt lesbar.
  const berichte = {
    zuLauf: berichteZuLauf,
    status: laufStatus,
    onStapelChat,
    onStapelAktion,
    onChat,
    onAktion
  }
  const quartale = nachQuartal(ergebnis.ohneDatum)

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {ergebnis.datiert.map((eintrag) => (
            <Zeile
              key={eintrag.id}
              eintrag={eintrag}
              laeuft={laeuft}
              berichte={berichte}
              onAuftrag={onAuftrag}
              onVerwerfen={onVerwerfen}
            />
          ))}
        </Box>

        {ergebnis.weitere > 0 && (
          <Box sx={{ pt: 1 }}>
            <Button size="small" onClick={onMehr}>
              {ergebnis.weitere} weitere anzeigen
            </Button>
          </Box>
        )}
      </Paper>

      {quartale.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h3" component="h3" sx={{ fontSize: '1rem' }}>
            Angekündigt, noch ohne Termin
          </Typography>
          {quartale.map(({ quartal, eintraege }) => (
            <Paper key={quartal} sx={{ p: 2 }}>
              <Stack spacing={0.5}>
                <Typography variant="body2" color="text.secondary">
                  {quartal} — {eintraege.length}
                </Typography>
                <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                  {eintraege.map((eintrag) => (
                    <Zeile
                      key={eintrag.id}
                      eintrag={eintrag}
                      laeuft={laeuft}
                      berichte={berichte}
                      onAuftrag={onAuftrag}
                      onVerwerfen={onVerwerfen}
                    />
                  ))}
                </Box>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  )
}

interface BerichteBuendel {
  zuLauf?: Map<string, AlleMeldungFelder[]>
  status?: Map<string, string>
  onStapelChat?: (laufId: string, anweisung: string) => Promise<void>
  onStapelAktion?: (laufId: string, aktion: 'pruefung' | 'publizieren') => Promise<void>
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: 'publizieren' | 'pruefung' | 'verwerfen') => Promise<void>
}

interface ZeileProps {
  eintrag: ZeitleistenEintrag
  laeuft: boolean
  berichte: BerichteBuendel
  onAuftrag: (eintrag: ZeitleistenEintrag) => void
  onVerwerfen: (eintrag: ZeitleistenEintrag) => void
}

function Zeile({ eintrag, laeuft, berichte, onAuftrag, onVerwerfen }: ZeileProps) {
  const herkunft = HERKUNFT[eintrag.herkunft]

  return (
    <Box
      component="li"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '5.5rem 1fr', sm: '7rem 6rem 1fr' },
        alignItems: 'baseline',
        columnGap: 2,
        rowGap: 0.5,
        py: 0.75,
        borderTop: 1,
        borderColor: 'divider',
        '&:first-of-type': { borderTop: 0 }
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {eintrag.datum === null ? '—' : formatiereDatum(eintrag.datum)}
      </Typography>

      <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
        <Chip size="small" variant="outlined" color={herkunft.farbe} label={herkunft.label} />
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        {eintrag.pfad === null ? (
          <Typography variant="body2">{eintrag.titel}</Typography>
        ) : (
          <Link
            href={`https://statistik.bl.ch/web_portal/${eintrag.pfad}`}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            underline="hover"
          >
            {eintrag.titel}
          </Link>
        )}

        <Box sx={{ flexGrow: 1 }} />

        <Aktion eintrag={eintrag} laeuft={laeuft} onAuftrag={onAuftrag} />

        {eintrag.datensatzId !== null && (
          <Tooltip title="Dauerhaft aussortieren. Auch neue Zahlen holen ihn nicht zurück.">
            <span>
              <Button size="small" color="inherit" disabled={laeuft} onClick={() => onVerwerfen(eintrag)}>
                Vergiss es
              </Button>
            </span>
          </Tooltip>
        )}
      </Stack>

      {eintrag.laufId !== null && berichte.zuLauf !== undefined && (
        <Box sx={{ gridColumn: '1 / -1', minWidth: 0 }}>
          <LaufBerichte
            meldungen={berichte.zuLauf.get(eintrag.laufId) ?? []}
            laufStatus={berichte.status?.get(eintrag.laufId) ?? null}
            laeuft={laeuft}
            onStapelChat={async (anweisung) => {
              await berichte.onStapelChat?.(eintrag.laufId as string, anweisung)
            }}
            onStapelAktion={async (aktion) => {
              await berichte.onStapelAktion?.(eintrag.laufId as string, aktion)
            }}
            onChat={async (id, anweisung) => {
              await berichte.onChat?.(id, anweisung)
            }}
            onAktion={async (id, was) => {
              await berichte.onAktion?.(id, was)
            }}
          />
        </Box>
      )}

      {/* Was der Katalog über den Datensatz sagt — damit sich das „vergiss es"
          auf etwas stützt und nicht auf den Titel allein. */}
      {eintrag.herkunft === 'datensatz' && (
        <Box sx={{ gridColumn: { xs: '1 / -1', sm: '3' } }}>
          <Typography variant="body2" color="text.secondary">
            {[
              eintrag.rhythmus === null ? null : rhythmusText(eintrag.rhythmus),
              eintrag.zeilen === null ? null : `${eintrag.zeilen.toLocaleString('de-CH')} Zeilen`,
              eintrag.beschreibung
            ]
              .filter((t): t is string => t !== null && t !== '')
              .join(' · ')
              .slice(0, 220)}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

const RHYTHMUS: Record<string, string> = {
  annual: 'jährlich',
  quarterly: 'quartalsweise',
  monthly: 'monatlich',
  weekly: 'wöchentlich',
  daily: 'täglich',
  hourly: 'stündlich',
  continuous: 'laufend',
  irregular: 'unregelmässig',
  'as needed': 'nach Bedarf',
  quinquennial: 'alle fünf Jahre',
  bidecennial: 'alle zwanzig Jahre',
  'every fifteen minutes': 'alle 15 Minuten'
}

function rhythmusText(rhythmus: string): string {
  return RHYTHMUS[rhythmus.toLowerCase()] ?? rhythmus
}

function Aktion({ eintrag, laeuft, onAuftrag }: Pick<ZeileProps, 'eintrag' | 'laeuft' | 'onAuftrag'>) {
  // Ein Eintrag mit Lauf braucht hier keinen Knopf mehr: seine Berichte stehen
  // direkt darunter und sagen selbst, wie viele es sind. Frueher sprang von
  // hier ein „Meldungen ansehen" in einen eigenen Reiter — den Umweg gibt es
  // nicht mehr.
  if (eintrag.laufId !== null) return null

  // Eine Portalzeile ist eine Meldung über den Zweig, nicht über eine Tabelle —
  // welche sich geändert hat, steht unter „alle Zweige anzeigen".
  if (eintrag.herkunft === 'portal') {
    return (
      <Typography variant="body2" color="text.disabled">
        geändert
      </Typography>
    )
  }

  // Angekuendigt heisst: es gibt noch nichts zu schreiben. Auch dann nicht,
  // wenn der Datensatz schon zugeordnet ist — er traegt dann die Zahlen des
  // letzten Jahrgangs, und daraus eine Meldung zu erzeugen waere eine Meldung
  // ueber alte Zahlen unter neuer Ueberschrift.
  if (eintrag.datum === null) {
    return <Chip size="small" variant="outlined" color="warning" label="noch keine Daten" />
  }

  return (
    <Tooltip title={eintrag.hinweis ?? ''}>
      <span>
        <Button size="small" variant="outlined" disabled={laeuft} onClick={() => onAuftrag(eintrag)}>
          {eintrag.datensatzId === null ? 'Datensatz wählen' : 'Meldungen erzeugen'}
        </Button>
      </span>
    </Tooltip>
  )
}
