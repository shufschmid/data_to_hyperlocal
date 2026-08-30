import type { Metadata } from 'next'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Container from '@mui/material/Container'
import Divider from '@mui/material/Divider'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { holeBlog, type BlogBeitrag } from '@/lib/public.server'
import { formatiereDatum, gemeindeSlug } from '@/lib/redaktion'
import { Artikeltext } from '@/components/Artikeltext'

// The public blog — published articles only, no account needed.
//
// Outside AppShell's session gate like the approval page, but with the opposite
// indexing stance: an approval link carries a credential and hides from search
// engines, a published article is meant to be found. The narrowness lives in
// the backend — the endpoint this renders from cannot return a draft.
//
// A server component on purpose: the reader gets finished HTML, and the filter
// is a link (`/blog?gemeinde=riehen`), so every view has a shareable address —
// the same slugs the internal workspace uses.

export const metadata: Metadata = {
  title: 'Blog — Die Redaktion'
}

export default async function BlogSeite({ searchParams }: { searchParams: Promise<{ gemeinde?: string }> }) {
  const { gemeinde } = await searchParams
  const alle = await holeBlog()

  const beitraege =
    gemeinde === undefined
      ? alle
      : alle.filter((b) => b.gemeinde !== null && gemeindeSlug(b.gemeinde.name) === gemeinde)

  // The nav names only municipalities that have something to read — an empty
  // link would be a dead end for a visitor.
  const gemeinden = [
    ...new Map(
      alle
        .filter((b) => b.gemeinde !== null)
        .map((b) => [
          gemeindeSlug((b.gemeinde as { name: string }).name),
          (b.gemeinde as { name: string }).name
        ])
    ).entries()
  ].sort((a, b) => a[1].localeCompare(b[1], 'de-CH'))

  return (
    <Container maxWidth="md" sx={{ py: 5 }}>
      <Stack spacing={3}>
        <Stack spacing={1}>
          <Typography variant="h1" sx={{ fontSize: '1.8rem', fontWeight: 700 }}>
            {gemeinde === undefined
              ? 'Aus den Gemeinden'
              : (gemeinden.find(([slug]) => slug === gemeinde)?.[1] ?? 'Aus den Gemeinden')}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Chip
              size="small"
              label="Alle"
              component="a"
              href="/blog"
              clickable
              color={gemeinde === undefined ? 'primary' : 'default'}
            />
            {gemeinden.map(([slug, name]) => (
              <Chip
                key={slug}
                size="small"
                label={name}
                component="a"
                href={`/blog?gemeinde=${slug}`}
                clickable
                color={slug === gemeinde ? 'primary' : 'default'}
              />
            ))}
          </Stack>
        </Stack>

        {beitraege.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Noch keine publizierten Beiträge.
          </Typography>
        ) : (
          <Stack spacing={3} divider={<Divider />}>
            {beitraege.map((beitrag) => (
              <Beitrag key={beitrag.id} beitrag={beitrag} />
            ))}
          </Stack>
        )}

        <Typography variant="caption" color="text.secondary">
          Automatisch erstellte Beiträge aus öffentlichen Daten, redaktionell geprüft. —{' '}
          <Link href="/" underline="hover">
            Redaktion
          </Link>
        </Typography>
      </Stack>
    </Container>
  )
}

function Beitrag({ beitrag }: { beitrag: BlogBeitrag }) {
  return (
    <Box component="article">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          {formatiereDatum(beitrag.publiziert_am)}
        </Typography>
        {beitrag.gemeinde !== null && (
          <Typography variant="caption" color="text.secondary">
            · {beitrag.gemeinde.name}
          </Typography>
        )}
        {beitrag.spiel !== null && <Chip size="small" variant="outlined" label={beitrag.spiel.sportart} />}
      </Stack>

      <Typography variant="h2" sx={{ fontSize: '1.25rem', fontWeight: 700, mt: 0.5 }}>
        {beitrag.titel}
      </Typography>
      {beitrag.lead !== null && (
        <Typography variant="body1" sx={{ fontWeight: 500, mt: 0.5 }}>
          {beitrag.lead}
        </Typography>
      )}
      <Artikeltext text={beitrag.text} />
    </Box>
  )
}
