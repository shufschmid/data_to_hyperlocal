import { NextResponse, type NextRequest } from 'next/server'
import { login } from '@/lib/directus.server'
import { problem } from '@/lib/proxy.server'
import { writeSession } from '@/lib/session.server'

interface LoginBody {
  email?: unknown
  password?: unknown
}

// POST /api/auth/login — exchanges credentials for a session cookie pair.
//
// The tokens are set as httpOnly cookies and never returned in the body, so the
// browser can use the session without any script being able to read it.
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

  try {
    const tokens = await login(email, password)
    const response = NextResponse.json(
      { data: { authenticated: true } },
      { headers: { 'Cache-Control': 'no-store' } }
    )
    writeSession(response, tokens)
    return response
  } catch {
    // Deliberately vague: distinguishing "unknown user" from "wrong password"
    // hands an attacker a way to enumerate accounts.
    return problem(401, 'Anmeldung fehlgeschlagen.')
  }
}
