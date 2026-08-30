import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { readSession } from '@/lib/session.server'

// Server component: it renders the shell and nothing else. Data fetching happens
// below, in client components, through /api/graphql.
//
// The one exception is the municipality link. `/?gemeinde=riehen` opens the
// workspace filtered to that blog — useful for an editor, useless for a reader,
// who only ever sees the login form. A visitor without a session is therefore
// sent to the public blog at the same municipality: the address a colleague
// pastes into a chat works for whoever opens it, signed in or not.
export default async function HomePage({ searchParams }: { searchParams: Promise<{ gemeinde?: string }> }) {
  const { gemeinde } = await searchParams

  if (gemeinde !== undefined && gemeinde !== '') {
    const session = await readSession()
    if (session.accessToken === null && session.refreshToken === null) {
      redirect(`/blog?gemeinde=${encodeURIComponent(gemeinde)}`)
    }
  }

  return <AppShell />
}
