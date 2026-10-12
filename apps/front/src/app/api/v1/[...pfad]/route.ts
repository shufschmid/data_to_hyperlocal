import { darfV1Lesen, v1Abfrage } from '@/lib/apiblog'
import { proxyToDirectus, problem } from '@/lib/proxy.server'

// The workspace's window onto the public API — the blog as the Dorfkönig
// sees it. A proxy and nothing else, with the signed-in user's token: the
// API ignores a valid token (SCHNITTSTELLE.md), so the answer is byte for
// byte what a consumer gets, and a 503 from the switch arrives as a 503.
//
// Read-only by shape, not by promise: only the paths in `V1_LESBAR` and only
// the reading parameters pass (`v1Abfrage`) — `abnehmer` never does, because
// the one thing this view must not do is look like a consumer, let alone
// move one's bookmark.

export async function GET(request: Request, { params }: { params: Promise<{ pfad: string[] }> }) {
  const { pfad } = await params
  const ziel = pfad.join('/')

  if (!darfV1Lesen(ziel)) {
    return problem(404, 'Unbekannter Pfad.')
  }

  const { search } = new URL(request.url)
  return proxyToDirectus(`/api/v1/${ziel}${v1Abfrage(search)}`, { method: 'GET' })
}
