import { publicToDirectus, problemOeffentlich } from '@/lib/public.server'

// Records the decision. The token travels in the body, never in the URL, so
// using the link does not leave it in an access log or a Referer header.
export async function POST(request: Request) {
  const roh = await request.text()

  let body: { token?: unknown; entscheidung?: unknown; kommentar?: unknown }
  try {
    body = JSON.parse(roh) as typeof body
  } catch {
    return problemOeffentlich(400, 'Ungueltige Anfrage.')
  }

  if (typeof body.token !== 'string' || body.token.length < 20) {
    return problemOeffentlich(404, 'Dieser Link ist nicht gueltig.')
  }
  if (body.entscheidung !== 'ja' && body.entscheidung !== 'nein') {
    return problemOeffentlich(400, 'Bitte freigeben oder ablehnen.')
  }

  return publicToDirectus('/redaktion/freigabe', { method: 'POST', body: roh })
}
