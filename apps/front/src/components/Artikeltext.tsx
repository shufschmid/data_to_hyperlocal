import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { absaetze, textStuecke } from '@/lib/redaktion'

// The body of an article, with its source link rendered as a link.
//
// Articles carry exactly one anchor: the source, put there by the backend and
// forced onto the address that was actually looked up (`redaktion/quelle.ts`) —
// never one the model invented. Rendering it needs markup, and the safe way to
// get markup out of model-written text is not `dangerouslySetInnerHTML` but
// `textStuecke`, which recognises that one shape and leaves everything else as
// text for React to escape. No sanitiser, because nothing raw is ever inserted.
//
// Shared by all three places an article is read: the public blog, the
// municipality blog in the workspace, and the editing card.

export interface ArtikeltextProps {
  text: string | null
  /** Matches the surrounding rhythm — the three call sites space differently. */
  abstand?: number
}

export function Artikeltext({ text, abstand = 1 }: ArtikeltextProps) {
  return (
    <>
      {absaetze(text).map((absatz, i) => (
        <Typography key={i} variant="body2" sx={{ mt: abstand }}>
          {textStuecke(absatz).map((stueck, j) =>
            stueck.art === 'link' ? (
              <Link key={j} href={stueck.url} target="_blank" rel="noopener noreferrer">
                {stueck.inhalt}
              </Link>
            ) : (
              stueck.inhalt
            )
          )}
        </Typography>
      ))}
    </>
  )
}
