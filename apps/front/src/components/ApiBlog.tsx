'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined'
import { Artikeltext } from './Artikeltext'
import { datumText } from '@/lib/amtsblatt'
import {
  antwortText,
  artikelPfad,
  freigabeText,
  gegenpruefungText,
  rubrikText,
  SEITE,
  siegelChip,
  standText,
  terminText,
  verlaengere,
  type ApiArtikel,
  type ApiGemeinde,
  type ApiGesundheit,
  type ApiListe
} from '@/lib/apiblog'
import { formatiereDatum } from '@/lib/redaktion'
import { sitzungsFetch } from '@/lib/marke.client'

// The blog as the Dorfkönig sees it.
//
// Reads `/api/v1/artikel` through the session proxy and shows what comes back
// — the articles, the envelope's count, a 503 when the switch is off. No
// GraphQL, no status filter, no own rule about what belongs here: whatever the
// API delivers is the blog, and whatever it refuses is said in its words.

const ALLE = '__alle__'

export interface ApiBlogProps {
  /** The municipality's slug, as the API names it (`?gemeinde=riehen`), or null for all. */
  gemeinde: string | null
  onGemeinde?: (slug: string | null) => void
  /** Injected in tests; the workspace reads through `sitzungsFetch`. */
  laden?: (pfad: string) => Promise<Response>
  grenze?: number
}

type Zustand =
  | { art: 'laedt' }
  | { art: 'liste'; artikel: ApiArtikel[]; gesamt: number; weitere: boolean; versatz: number }
  | { art: 'fehler'; status: number; text: string }

// ONE function for the whole module, not a default arrow in the parameter
// list: a default created per render is a new identity per render, the
// loader built on it changes with it, the effect that depends on the loader
// runs again, sets «laedt», and the render that follows makes the next one —
// measured in production on 12 October 2026 as a blog that flickered and
// never showed a line. The tests had passed because they inject a stable
// stub; `ApiBlog.standard.test.tsx` now walks the default path.
const standardLaden = (pfad: string): Promise<Response> => sitzungsFetch(pfad)

export function ApiBlog({ gemeinde, onGemeinde, laden = standardLaden, grenze = SEITE }: ApiBlogProps) {
  const [zustand, setZustand] = useState<Zustand>({ art: 'laedt' })
  const [nachladen, setNachladen] = useState(false)
  const [gemeinden, setGemeinden] = useState<ApiGemeinde[]>([])
  const [gesundheit, setGesundheit] = useState<ApiGesundheit | null>(null)

  /** One page from the API, as the next state — the caller decides whether it still applies. */
  const ladeSeite = useCallback(
    async (versatz: number, bisher: readonly ApiArtikel[]): Promise<Zustand> => {
      const antwort = await laden(artikelPfad(gemeinde, versatz, grenze))
      const koerper = (await antwort.json().catch(() => null)) as unknown
      if (!antwort.ok) {
        return { art: 'fehler', status: antwort.status, text: antwortText(antwort.status, koerper) }
      }
      const liste = koerper as ApiListe
      return {
        art: 'liste',
        artikel: verlaengere(bisher, liste.artikel ?? []),
        gesamt: liste.gesamt ?? 0,
        weitere: liste.weitere === true,
        versatz: versatz + (liste.anzahl ?? 0)
      }
    },
    [gemeinde, grenze, laden]
  )

  // The first page, and again whenever the municipality changes. An answer
  // that arrives after the municipality moved on is dropped, not shown.
  useEffect(() => {
    let aktiv = true
    setZustand({ art: 'laedt' })
    ladeSeite(0, [])
      .then((naechster) => {
        if (aktiv) setZustand(naechster)
      })
      .catch((fehler: unknown) => {
        if (aktiv)
          setZustand({
            art: 'fehler',
            status: 0,
            text: fehler instanceof Error ? fehler.message : String(fehler)
          })
      })
    return () => {
      aktiv = false
    }
  }, [ladeSeite])

  // The municipalities as the API names them, and whether it is on at all —
  // once per mount; both change rarely.
  useEffect(() => {
    void (async () => {
      try {
        const g = await laden('/api/v1/gemeinden')
        if (g.ok) {
          const liste = (await g.json()) as { gemeinden?: ApiGemeinde[] }
          setGemeinden(liste.gemeinden ?? [])
        }
      } catch {
        // The dropdown then lists nothing but «Alle» — the list itself still says what is wrong.
      }
      try {
        const h = await laden('/api/v1/gesundheit')
        setGesundheit((await h.json()) as ApiGesundheit)
      } catch {
        setGesundheit(null)
      }
    })()
  }, [laden])

  const name = useMemo(
    () => gemeinden.find((g) => g.gemeinde === gemeinde)?.name ?? gemeinde,
    [gemeinden, gemeinde]
  )

  async function mehr() {
    if (zustand.art !== 'liste' || !zustand.weitere) return
    setNachladen(true)
    try {
      setZustand(await ladeSeite(zustand.versatz, zustand.artikel))
    } finally {
      setNachladen(false)
    }
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <TextField
          select
          size="small"
          label="Gemeinde"
          value={gemeinde ?? ALLE}
          onChange={(e) => onGemeinde?.(e.target.value === ALLE ? null : e.target.value)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value={ALLE}>Alle Gemeinden</MenuItem>
          {gemeinden.map((g) => (
            <MenuItem key={g.gemeinde} value={g.gemeinde}>
              {g.name}
            </MenuItem>
          ))}
          {gemeinde !== null && !gemeinden.some((g) => g.gemeinde === gemeinde) && (
            <MenuItem value={gemeinde}>{gemeinde}</MenuItem>
          )}
        </TextField>
        <Typography variant="body2" color="text.secondary">
          {zustand.art === 'liste' ? standText(zustand.artikel.length, zustand.gesamt) : ''}
        </Typography>
        {gesundheit !== null && (
          <Chip
            size="small"
            variant="outlined"
            color={gesundheit.bereit ? 'success' : 'error'}
            label={
              gesundheit.bereit
                ? `Schnittstelle offen · ${gesundheit.medium} · ${gesundheit.version}`
                : gesundheit.offen
                  ? 'Schnittstelle nicht bereit (Datenbank)'
                  : 'Schnittstelle abgeschaltet'
            }
          />
        )}
      </Stack>

      {zustand.art === 'laedt' && <CircularProgress size={24} />}

      {zustand.art === 'fehler' && (
        <Alert severity={zustand.status === 503 ? 'warning' : 'error'}>{zustand.text}</Alert>
      )}

      {zustand.art === 'liste' && zustand.artikel.length === 0 && (
        <Alert severity="info">
          {gemeinde === null
            ? 'Die Schnittstelle liefert noch keinen Beitrag.'
            : `Die Schnittstelle liefert für ${name ?? gemeinde} noch keinen Beitrag.`}
        </Alert>
      )}

      {zustand.art === 'liste' && zustand.artikel.length > 0 && (
        <Stack spacing={2} divider={<Divider />}>
          {zustand.artikel.map((a) => (
            <Beitrag key={a.id} artikel={a} />
          ))}
        </Stack>
      )}

      {zustand.art === 'liste' && zustand.weitere && (
        <Box>
          <Button variant="outlined" disabled={nachladen} onClick={() => void mehr()}>
            {nachladen
              ? 'Lädt …'
              : `Weitere laden (${Math.max(zustand.gesamt - zustand.artikel.length, 0)} weitere)`}
          </Button>
        </Box>
      )}
    </Stack>
  )
}

/** One article, every field the Dorfkönig gets — the text, and the seal beside it. */
function Beitrag({ artikel }: { artikel: ApiArtikel }) {
  const [hinweiseOffen, setHinweiseOffen] = useState(false)
  const siegel = siegelChip(artikel.pruefsiegel)
  const gegen = gegenpruefungText(artikel.pruefsiegel)
  const termin = terminText(artikel.termin, datumText)

  return (
    <Box component="article">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {formatiereDatum(artikel.publiziert_am)}
        </Typography>
        {artikel.gemeinde_name !== null && <Chip size="small" label={artikel.gemeinde_name} />}
        <Chip size="small" variant="outlined" label={rubrikText(artikel.rubrik)} />
        {artikel.perle && <Chip size="small" color="secondary" variant="outlined" label="Perle" />}
        <Chip
          size="small"
          variant="outlined"
          color={siegel.farbe}
          label={siegel.text}
          onClick={siegel.hinweise.length === 0 ? undefined : () => setHinweiseOffen((o) => !o)}
        />
        {gegen !== null && <Chip size="small" variant="outlined" label={gegen} />}
      </Stack>

      {hinweiseOffen && siegel.hinweise.length > 0 && (
        <Stack spacing={0.25} sx={{ mt: 0.5 }}>
          {siegel.hinweise.map((h, i) => (
            <Typography key={i} variant="caption" color="warning.main">
              {h}
            </Typography>
          ))}
        </Stack>
      )}

      <Typography variant="body1" sx={{ fontWeight: 700, mt: 0.5 }}>
        {artikel.titel ?? '(ohne Titel)'}
      </Typography>
      {artikel.lead !== null && (
        <Typography variant="body2" sx={{ fontStyle: 'italic', mb: 0.5 }}>
          {artikel.lead}
        </Typography>
      )}
      <Artikeltext text={artikel.text} abstand={0.5} />

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        {[
          artikel.quelle_name === null ? null : `Quelle: ${artikel.quelle_name}`,
          termin,
          freigabeText(artikel.pruefsiegel),
          `Medium: ${artikel.medium}`
        ]
          .filter((t): t is string => t !== null)
          .join(' · ')}
        {artikel.quelle_url !== null && (
          <>
            {' · '}
            <Link
              href={artikel.quelle_url}
              target="_blank"
              rel="noopener"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
            >
              <OpenInNewOutlined fontSize="inherit" /> quelle_url
            </Link>
          </>
        )}
      </Typography>
    </Box>
  )
}
