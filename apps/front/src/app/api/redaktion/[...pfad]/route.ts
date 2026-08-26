import { proxyToDirectus, problem } from '@/lib/proxy.server'

// Forwards the editorial actions to the extension endpoint, with the signed-in
// user's token. A proxy and nothing else: no rule, no prompt, no calculation.
//
// One handler instead of eight near-identical files, which only works because
// the shapes below are an allowlist rather than a pass-through. Without it this
// would forward any path a caller invented straight into Directus, as the
// signed-in user.
const ERLAUBT: RegExp[] = [
  /^tabellen$/i,
  /^spielberichte$/i,
  /^ankuendigungen$/i,
  /^datensaetze\/[0-9a-f-]{36}\/lauf$/i,
  /^laeufe\/[0-9a-f-]{36}\/(chat|publizieren|pruefung|verwerfen)$/i,
  /^meldungen\/[0-9a-f-]{36}\/(chat|publizieren|pruefung|verwerfen|freigeben)$/i,
  /^entsorgung\/kalender$/i,
  /^entsorgung\/kalender\/[0-9a-f-]{36}\/(extrahieren|pruefen|meldungen|freigeben)$/i,
  /^quellen\/lauf$/i,
  /^wochenblaetter$/i,
  /^wochenblaetter\/pruefen$/i,
  /^ausgaben\/[0-9a-f-]{36}\/inventar$/i,
  /^kandidaten\/[0-9a-f-]{36}\/(meldung|ablehnen|gemeinde)$/i,
  /^hinweise\/[0-9a-f-]{36}\/bewerten$/i
]

// The one read this proxy carries: the state of a hand-started scrape run.
// Everything else the workspace reads goes through GraphQL.
const LESBAR: RegExp[] = [/^quellen\/lauf$/i]

export async function GET(_request: Request, { params }: { params: Promise<{ pfad: string[] }> }) {
  const { pfad } = await params
  const ziel = pfad.join('/')

  if (!LESBAR.some((muster) => muster.test(ziel))) {
    return problem(404, 'Unbekannte Aktion.')
  }

  return proxyToDirectus(`/redaktion/${ziel}`, { method: 'GET' })
}

export async function POST(request: Request, { params }: { params: Promise<{ pfad: string[] }> }) {
  const { pfad } = await params
  const ziel = pfad.join('/')

  if (!ERLAUBT.some((muster) => muster.test(ziel))) {
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
