import type { Metadata } from 'next'
import Container from '@mui/material/Container'
import { FreigabeAnsicht } from '@/components/FreigabeAnsicht'

// The approval page.
//
// Outside AppShell's session gate on purpose: the person reading it has no
// account. It uses no Apollo either — a relative `/api/graphql` needs a
// session, and this page has none.

export const metadata: Metadata = {
  title: 'Meldung gegenlesen',
  // A link with a credential in it has no business in a search index.
  robots: { index: false, follow: false }
}

export default async function FreigabeSeite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  return (
    <Container maxWidth="sm" sx={{ py: 5 }}>
      <FreigabeAnsicht token={token} />
    </Container>
  )
}
