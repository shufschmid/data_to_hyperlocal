import { proxyToDirectus, problem } from '@/lib/proxy.server'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return problem(400, 'Ungueltige Dossier-ID.')

  return proxyToDirectus(`/punkt6-dossier-process/${id}`, { method: 'POST' })
}
