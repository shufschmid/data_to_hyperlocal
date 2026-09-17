import { NextResponse, type NextRequest } from 'next/server'
import { login } from '@/lib/directus.server'
import { versiegle, markeMoeglich } from '@/lib/marke.server'
import { problem } from '@/lib/proxy.server'
import { istRahmenSitzung } from '@/lib/rahmen'
import { writeSession } from '@/lib/session.server'

interface LoginBody {
  email?: unknown
  password?: unknown
}

// POST /api/auth/login — exchanges credentials for a session.
//
// Outside the editor's frame that session is the two httpOnly cookies and the
// tokens are never in the body, so no script can read them.
//
// Inside the frame there is no usable cookie (Safari blocks third-party
// cookies outright), so the answer carries the sealed marker instead — in the
// BODY, because the page has to put it into its own memory and a header of a
// `fetch` response it cannot always read. The marker is opaque: it is the same
// pair, encrypted with a key that never leaves this server.
export async function POST(request: NextRequest) {
  let body: LoginBody

  try {
    body = (await request.json()) as LoginBody
  } catch {
    return problem(400, 'Ungueltige Anfrage.')
  }

  const { email, password } = body

  if (typeof email !== 'string' || typeof password !== 'string' || email === '' || password === '') {
    return problem(400, 'E-Mail und Passwort sind erforderlich.')
  }

  const imRahmen = istRahmenSitzung(request.headers)

  if (imRahmen && !markeMoeglich()) {
    return problem(
      503,
      'Die Anmeldung im Editor-Rahmen ist auf dieser Instanz nicht eingerichtet (SITZUNGSMARKE_SCHLUESSEL fehlt).'
    )
  }

  try {
    const tokens = await login(email, password)
    const marke = imRahmen ? await versiegle(tokens, Date.now()) : null

    const response = NextResponse.json(
      { data: { authenticated: true, ...(marke === null ? {} : { marke }) } },
      { headers: { 'Cache-Control': 'no-store' } }
    )
    await writeSession(response, tokens, imRahmen)
    return response
  } catch {
    // Deliberately vague: distinguishing "unknown user" from "wrong password"
    // hands an attacker a way to enumerate accounts.
    return problem(401, 'Anmeldung fehlgeschlagen.')
  }
}
