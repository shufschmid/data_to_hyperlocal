import { publicToDirectus, problemOeffentlich } from '@/lib/public.server'

// Reads one article for the approval page. No session, by design.
//
// Deliberately GET-only and deliberately read-only: link scanners fetch this,
// and a GET that recorded a decision would approve articles nobody looked at.
// The decision lives in the sibling route, as a POST.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  // Same shape the backend mints — anything else never becomes a request.
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(token)) {
    return problemOeffentlich(404, 'Dieser Link ist nicht gueltig.')
  }

  return publicToDirectus(`/redaktion/freigabe/${token}`, { method: 'GET' })
}
