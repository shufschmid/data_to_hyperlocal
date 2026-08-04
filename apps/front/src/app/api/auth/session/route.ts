import { proxyToDirectus } from '@/lib/proxy.server'

// GET /api/auth/session — who am I?
//
// Forwards to Directus `/users/me`, so the answer reflects the real session (and
// refreshes it if the access token just expired). 401 means "show the login form".
export async function GET() {
  return proxyToDirectus('/users/me?fields=id,email,first_name,last_name', { method: 'GET' })
}
