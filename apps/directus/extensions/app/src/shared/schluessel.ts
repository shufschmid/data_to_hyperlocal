import { createHash, timingSafeEqual } from 'node:crypto'

// The one gate for a shared secret in a custom header — used by the Sokrates
// door (`X-Sokrates-Key`) and by the consumer's confirmation on the public
// API (`X-Abnehmer-Key`). Pure, so the three states are unit tests.

export type Zugang = 'ok' | 'nicht_konfiguriert' | 'verweigert'

/**
 * An empty key means the door is not configured — 503, never a silent yes
 * (the same stance as `BLOG_API_OFFEN`). A configured key is compared
 * timing-safe: both sides are hashed to a fixed length first, so neither
 * content nor length leaks through the comparison time.
 *
 * The key travels in a header of its own, NOT in `Authorization` — measured
 * on the running instance: Directus' own auth middleware runs before every
 * custom endpoint and rejects any Bearer token it cannot resolve as one of
 * its own, so a foreign key in that header never reaches this code (401
 * INVALID_CREDENTIALS from Directus itself).
 */
export function pruefeZugang(kopfzeile: unknown, schluessel: string): Zugang {
  if (schluessel === '') return 'nicht_konfiguriert'
  if (typeof kopfzeile !== 'string' || kopfzeile === '') return 'verweigert'
  return gleich(kopfzeile.trim(), schluessel) ? 'ok' : 'verweigert'
}

function gleich(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
