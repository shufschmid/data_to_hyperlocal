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
import { MeldungKarte, type MeldungAktion, type MeldungAktionKoerper } from './MeldungKarte'

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
  datensatz: { label: 'data.bl.ch', farbe: 'success' },
  suedanflug: { label: 'EuroAirport', farbe: 'default' }
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
  onAktion?: (id: string, aktion: MeldungAktion, koerper?: MeldungAktionKoerper) => Promise<void>
  onAuftrag: (eintrag: ZeitleistenEintrag) => void
  /** „Vergiss es" — dauerhaft, die tägliche Prüfung holt es nicht zurück. */
  onVerwerfen: (eintrag: ZeitleistenEintrag) => void
  onMehr: () => void
  /**
   * Die Gemeinden unter der Anflugschneise — redaktionelles Wissen, kein Feld
   * der Quelle. Leer heisst: die Quote steht da, aber niemand ist erfasst, und
   * die Zeile sagt das statt einen Knopf ins Leere zu zeigen.
   */
  suedanflugGemeinden?: readonly { id: string; name: string }[]
  /** Die Meldungen je Monatsblatt, eine je Gemeinde. */
  berichteZuSuedanflug?: Map<string, AlleMeldungFelder[]>
  onSuedanflugMeldung?: (quoteId: string, gemeindeId: string) => Promise<void>
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
  onMehr,
  suedanflugGemeinden,
  berichteZuSuedanflug,
  onSuedanflugMeldung
}: ZeitleisteProps) {
  // Einmal gebuendelt statt in jeder Zeile: `Zeile` bekommt nur, was sie
  // betrifft, und die Signatur bleibt lesbar.
  const berichte = {
    zuLauf: berichteZuLauf,
    status: laufStatus,
    onStapelChat,
    onStapelAktion,
    onChat,
    onAktion,
    suedanflugGemeinden,
    zuSuedanflug: berichteZuSuedanflug,
    onSuedanflugMeldung
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
  onAktion?: (id: string, aktion: MeldungAktion, koerper?: MeldungAktionKoerper) => Promise<void>
  suedanflugGemeinden?: readonly { id: string; name: string }[]
  zuSuedanflug?: Map<string, AlleMeldungFelder[]>
  onSuedanflugMeldung?: (quoteId: string, gemeindeId: string) => Promise<void>
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
        {/* Der Titel fuehrt zu den Daten, sobald wir ihre Adresse kennen —
            nicht erst, wenn eine Meldung existiert. Ein Portal-Zweig verlinkt
            seine Seite, ein Datensatz das Portal, ein Agenda-Eintrag den
            Artikel des Amts. */}
        {eintrag.link === null ? (
          <Typography variant="body2">{eintrag.titel}</Typography>
        ) : (
          <Link
            href={eintrag.link}
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

      {eintrag.herkunft === 'suedanflug' && (
        <Box sx={{ gridColumn: '1 / -1', minWidth: 0 }}>
          <Suedanflug
            eintrag={eintrag}
            laeuft={laeuft}
            gemeinden={berichte.suedanflugGemeinden ?? []}
            meldungen={eintrag.quoteId === null ? [] : (berichte.zuSuedanflug?.get(eintrag.quoteId) ?? [])}
            onMeldung={berichte.onSuedanflugMeldung}
            onChat={berichte.onChat}
            onAktion={berichte.onAktion}
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

interface SuedanflugProps {
  eintrag: ZeitleistenEintrag
  laeuft: boolean
  gemeinden: readonly { id: string; name: string }[]
  meldungen: readonly AlleMeldungFelder[]
  onMeldung?: (quoteId: string, gemeindeId: string) => Promise<void>
  onChat?: (id: string, anweisung: string) => Promise<void>
  onAktion?: (id: string, aktion: MeldungAktion, koerper?: MeldungAktionKoerper) => Promise<void>
}

/**
 * Was unter einer Monatszeile steht.
 *
 * Ein Knopf je betroffener Gemeinde, und sobald eine Meldung existiert, ihre
 * Karte an derselben Stelle — das Muster der Presseschau. Die Gemeinden kommen
 * aus `gemeinden.suedanflug` und nicht aus der Quelle: der Flughafen erhebt
 * eine Quote fuer sich, nicht je Gemeinde. Ist keine erfasst, sagt die Zeile
 * das, statt einen Knopf ins Leere zu zeigen.
 */
function Suedanflug({ eintrag, laeuft, gemeinden, meldungen, onMeldung, onChat, onAktion }: SuedanflugProps) {
  const quoteId = eintrag.quoteId
  if (quoteId === null) return null

  return (
    <Stack spacing={1} sx={{ pt: 0.5 }}>
      {eintrag.befunde.length > 0 && (
        <Typography variant="body2" color="warning.main">
          {eintrag.befunde.join(' · ')}
        </Typography>
      )}

      {gemeinden.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Keine Gemeinde ist als Südanflug-Gemeinde erfasst. Trage sie in der Gemeinden-Karte ein.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {gemeinden.map((gemeinde) => {
            const meldung = meldungen.find((m) => m.gemeinde?.id === gemeinde.id)
            if (meldung !== undefined) {
              return (
                <MeldungKarte
                  key={gemeinde.id}
                  meldung={meldung}
                  laeuft={laeuft}
                  kompakt
                  onChat={async (id, anweisung) => {
                    await onChat?.(id, anweisung)
                  }}
                  onAktion={async (id, was, koerper) => {
                    await onAktion?.(id, was, koerper)
                  }}
                />
              )
            }
            return (
              <Box key={gemeinde.id}>
                <Button
                  size="small"
                  variant={eintrag.vorschlag ? 'contained' : 'outlined'}
                  disabled={laeuft}
                  onClick={() => void onMeldung?.(quoteId, gemeinde.id)}
                >
                  Meldung erzeugen · {gemeinde.name}
                </Button>
              </Box>
            )
          })}
        </Stack>
      )}
    </Stack>
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

  // Die Suedanflug-Zeile traegt ihre Knoepfe darunter, einen je betroffener
  // Gemeinde. Hier oben steht nur, ob eine Schwelle gerissen wurde — das ist
  // der Vorschlag, und er ist eine Markierung, keine Meldung.
  if (eintrag.herkunft === 'suedanflug') {
    if (!eintrag.vorschlag) return null
    return (
      <Tooltip title={eintrag.hinweis ?? ''}>
        <Chip size="small" color="warning" label="Schwelle überschritten" />
      </Tooltip>
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
