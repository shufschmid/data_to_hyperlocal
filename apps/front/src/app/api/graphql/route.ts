import type { NextRequest } from 'next/server'
import { proxyToDirectus } from '@/lib/proxy.server'

// POST /api/graphql — the single data endpoint the browser knows about.
//
// Apollo Client points here (see src/lib/apollo.ts); this forwards to Directus'
// GraphQL API with the signed-in user's token. Directus resolves permissions, so a
// query can never return more than the user is allowed to see.
export async function POST(request: NextRequest) {
  return proxyToDirectus('/graphql', { method: 'POST', body: await request.text() })
}
