import { AppShell } from '@/components/AppShell'

// Server component: it renders the shell and nothing else. Data fetching happens
// below, in client components, through /api/graphql.
export default function HomePage() {
  return <AppShell />
}
