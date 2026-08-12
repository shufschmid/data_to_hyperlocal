'use client'

import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { QuelleFelder } from '@/graphql/redaktion'
import { formatiereDatum } from '@/lib/redaktion'

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
// So the banner does two things: it says which source is silent since when, and
// it hands over the two ways to carry on by hand — open the page, and type in
// what is there.

export interface QuellenHinweisProps {
  quellen: readonly QuelleFelder[]
  /** Jumps to the tab where an entry can be typed in. */
  onErfassen: () => void
}

export function QuellenHinweis({ quellen, onErfassen }: QuellenHinweisProps) {
  const gestoert = quellen.filter((q) => q.letzter_fehler !== null && q.letzter_fehler.trim() !== '')

  if (gestoert.length === 0) return null

  return (
    <Stack spacing={1}>
      {gestoert.map((quelle) => (
        <Alert key={quelle.id} severity="warning">
          <AlertTitle>{quelle.name} konnte nicht gelesen werden</AlertTitle>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {quelle.letzter_fehler}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Letzter Versuch:{' '}
            {quelle.letzte_pruefung === null ? 'unbekannt' : formatiereDatum(quelle.letzte_pruefung)}. Bis das
            wieder geht, erfährst du von hier nichts Neues — auch dann nicht, wenn etwas publiziert wurde.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              component={Link}
              href={quelle.basis_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Seite öffnen
            </Button>
            <Button size="small" variant="contained" onClick={onErfassen}>
              Eintrag von Hand erfassen
            </Button>
          </Stack>
        </Alert>
      ))}
    </Stack>
  )
}
