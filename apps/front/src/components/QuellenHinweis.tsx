'use client'

import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import type { QuelleFelder } from '@/graphql/redaktion'
import { formatiereDatum } from '@/lib/redaktion'
import { kannVonHand, kurzerFehler, laufFuer } from '@/lib/quellenhinweis'

// A source that could not be read is news, and it belongs on the front page.
//
// The agenda host sits behind a Cloudflare Managed Challenge. We identify
// ourselves honestly and try a few times; when all of them are turned away, the
// run records why — and until now that record lived only in the Directus admin,
// which is the one place an editor never opens. The result was the worst
// possible shape of a failure: the agenda tab simply showed nothing new, and
// nothing said whether that meant "nothing was published" or "we were not let
// in".
//
// **Zwei Zeilen, nicht fuenf.** Am 21. September 2026 stand die Zeile des
// EuroAirports dreizeilig auf dem Bildschirm und sagte zweimal dasselbe
// („nicht erreichbar: fetch failed — auch über den Crawler nicht: Crawler
// nicht erreichbar: fetch failed"), dazu einen Satz darueber, was ein
// Ausfall bedeutet. Das weiss die Redaktion. Geblieben sind der Name, die
// gekuerzte Ursache und das Datum; die Knoepfe stehen rechts daneben, wo sie
// keine Zeile kosten.
//
// **Und der wichtigste Knopf ist neu.** Eine gestoerte Quelle war eine
// Sackgasse mit einem Link darauf; jetzt startet ein Griff genau den Lauf,
// der diese Zeile geschrieben hat (`laufFuer`). Abgetippt wird nur noch dort,
// wo es etwas zum Abtippen gibt (`kannVonHand`).

export interface QuellenHinweisProps {
  quellen: readonly QuelleFelder[]
  /** Jumps to the tab where an entry can be typed in. */
  onErfassen: () => void
  /** Startet den Lauf, der diese Quelle liest — den, den `laufFuer` nennt. */
  onNochmals?: (lauf: string) => Promise<void> | void
  laeuft?: boolean
}

export function QuellenHinweis({ quellen, onErfassen, onNochmals, laeuft = false }: QuellenHinweisProps) {
  const gestoert = quellen.filter((q) => q.letzter_fehler !== null && q.letzter_fehler.trim() !== '')

  if (gestoert.length === 0) return null

  return (
    <Stack spacing={1}>
      {gestoert.map((quelle) => {
        const lauf = laufFuer(quelle.typ)
        return (
          <Alert
            key={quelle.id}
            severity="warning"
            sx={{ py: 0.5, '& .MuiAlert-message': { py: 0.5 } }}
            action={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Button
                  size="small"
                  color="inherit"
                  component={Link}
                  href={quelle.basis_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Seite öffnen
                </Button>
                {kannVonHand(quelle.typ) && (
                  <Button size="small" color="inherit" onClick={onErfassen}>
                    Von Hand
                  </Button>
                )}
                {lauf !== null && onNochmals !== undefined && (
                  <Button
                    size="small"
                    variant="contained"
                    disabled={laeuft}
                    onClick={() => void onNochmals(lauf)}
                  >
                    Nochmals versuchen
                  </Button>
                )}
              </Stack>
            }
          >
            <AlertTitle sx={{ mb: 0 }}>{quelle.name} konnte nicht gelesen werden</AlertTitle>
            {kurzerFehler(quelle.letzter_fehler)}
            {quelle.letzte_pruefung !== null && ` · zuletzt ${formatiereDatum(quelle.letzte_pruefung)}`}
          </Alert>
        )
      })}
    </Stack>
  )
}
