import { darfLesen, darfSchreiben } from '@/lib/aktionen'
import { proxyToDirectus, problem } from '@/lib/proxy.server'

// Forwards the editorial actions to the extension endpoint, with the signed-in
// user's token. A proxy and nothing else: no rule, no prompt, no calculation.
//
// One handler instead of eight near-identical files, which only works because
// the shapes live in `@/lib/aktionen` as an allowlist rather than a
// pass-through, and are tested there against what the workspace actually calls.

export async function GET(_request: Request, { params }: { params: Promise<{ pfad: string[] }> }) {
  const { pfad } = await params
  const ziel = pfad.join('/')

  if (!darfLesen(ziel)) {
    return problem(404, 'Unbekannte Aktion.')
  }

  return proxyToDirectus(`/redaktion/${ziel}`, { method: 'GET' })
}

export async function POST(request: Request, { params }: { params: Promise<{ pfad: string[] }> }) {
  const { pfad } = await params
  const ziel = pfad.join('/')

  if (!darfSchreiben(ziel)) {
    return problem(404, 'Unbekannte Aktion.')
  }

  // A string, not a stream — proxyToDirectus replays the request after a token
  // refresh, and a consumed stream cannot be replayed.
  const body = await request.text()

  return proxyToDirectus(`/redaktion/${ziel}`, {
    method: 'POST',
    ...(body === '' ? {} : { body })
  })
}
