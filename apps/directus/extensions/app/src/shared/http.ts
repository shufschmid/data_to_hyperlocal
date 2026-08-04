import type { Accountability } from '@directus/types'
import type { Request } from 'express'

// Directus attaches `accountability` to every request after authentication. It is
// not part of the Express type, so endpoints use this widened type. Reuse the
// Directus `Accountability` type rather than declaring your own — the services
// expect exactly that shape.
export interface ApiRequest extends Request {
  accountability?: Accountability
}

/**
 * True for a request made by a logged-in user or a static token.
 *
 * Endpoints are public by default — Directus mounts them before its permission
 * layer. Every endpoint that reads or writes data must decide explicitly who may
 * call it; forgetting this is the most common security bug in a Directus extension.
 */
export function isAuthenticated(req: ApiRequest): boolean {
  return (
    typeof req.accountability?.user === 'string' &&
    req.accountability.user !== ''
  )
}
