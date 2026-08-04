import { proxyToDirectus, problem } from '@/lib/proxy.server'

// POST /api/notes/:id/summary
//
// Calls the `notes-summary` endpoint of the Directus extension bundle
// (apps/directus/extensions/app/src/endpoints/notes-summary). The Claude call, the
// prompt and the write to the collection all happen there — this route only carries
// the request across, with the user's token.
//
// This is the shape to copy for every custom backend operation: a thin proxy here,
// the logic in the extension. Never call the Claude API from the frontend: the key
// would have to live in this app, and the logic would end up outside the backend
// where Flows, hooks and tests cannot reach it.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (!/^[0-9a-f-]{36}$/i.test(id)) return problem(400, 'Ungueltige Notiz-ID.')

  return proxyToDirectus(`/notes-summary/${id}`, { method: 'POST' })
}
