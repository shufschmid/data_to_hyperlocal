import { NextResponse } from 'next/server'
import { logout } from '@/lib/directus.server'
import { clearSession, readSession } from '@/lib/session.server'

// POST /api/auth/logout — revokes the refresh token in Directus and clears the
// cookies. The cookies go regardless of what Directus answers: a session the user
// asked to end must end locally even if the backend call fails.
export async function POST() {
  const { refreshToken } = await readSession()

  if (refreshToken !== null) await logout(refreshToken)

  const response = NextResponse.json(
    { data: { authenticated: false } },
    { headers: { 'Cache-Control': 'no-store' } }
  )
  clearSession(response)
  return response
}
