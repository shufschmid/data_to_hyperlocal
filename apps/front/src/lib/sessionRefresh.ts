// Two requests must never rotate the same refresh token.
//
// Directus rotates on every `/auth/refresh`: the new pair invalidates the old
// refresh token *and* every access token issued alongside it. A page load fires a
// dozen GraphQL requests at once, and once the access cookie has expired each of
// them would otherwise refresh on its own — the second rotation kills the first
// one's brand-new access token, so Directus answers some of the burst with
// `403 INVALID_TOKEN` while their siblings get 200. That is the mixed wall of
// green and purple in the network panel.
//
// So: one rotation per refresh token, shared by everyone who arrives holding it.
// The result is kept for a moment afterwards, because the browser only learns the
// new cookie when the first response reaches it — a request that left before that
// still carries the old token and must be handed the same answer rather than
// triggering a second rotation.
//
// This is process-local state, which is the right scope: it is a lock on an
// in-flight fetch, not something to remember. A second frontend replica would
// simply have its own, and the retry below still covers the seam.

export interface SessionTokens {
  accessToken: string
  refreshToken: string
  /** Lifetime of the access token in milliseconds, as reported by Directus. */
  expires: number
}

/** How long a finished rotation keeps answering for the token it replaced. */
export const ROTATION_GRACE_MS = 60_000

/** Far more than any burst needs; a ceiling so a long-lived process cannot grow. */
const MAX_ROTATIONS = 64

interface Rotation {
  startedAt: number
  tokens: Promise<SessionTokens>
}

export interface RefreshCache {
  /** Rotates `refreshToken`, or joins the rotation someone else already started. */
  renew(refreshToken: string, rotate: (token: string) => Promise<SessionTokens>): Promise<SessionTokens>
  forget(refreshToken: string): void
  readonly size: number
}

export function createRefreshCache(now: () => number = Date.now): RefreshCache {
  const rotations = new Map<string, Rotation>()

  return {
    renew(refreshToken, rotate) {
      for (const [token, rotation] of rotations) {
        if (now() - rotation.startedAt >= ROTATION_GRACE_MS) rotations.delete(token)
      }

      const running = rotations.get(refreshToken)
      if (running !== undefined) return running.tokens

      const tokens = rotate(refreshToken)
      rotations.set(refreshToken, { startedAt: now(), tokens })

      // A failed rotation must not be remembered: the next request deserves a real
      // attempt, and handing a rejected promise to a later caller would read as a
      // dead session to someone who never asked.
      tokens.catch(() => rotations.delete(refreshToken))

      // A Map iterates in insertion order, so the front of it is the oldest.
      while (rotations.size > MAX_ROTATIONS) {
        const oldest = rotations.keys().next()
        if (oldest.done === true) break
        rotations.delete(oldest.value)
      }

      return tokens
    },

    forget(refreshToken) {
      rotations.delete(refreshToken)
    },

    get size() {
      return rotations.size
    }
  }
}

/**
 * Did Directus turn this request away over the *token*, or over what the user is
 * allowed to see?
 *
 * The distinction costs one JSON parse and is the whole point of this module's
 * other half. `401 TOKEN_EXPIRED` and `403 INVALID_TOKEN` are worth a refresh and
 * a replay; `403 FORBIDDEN` is the permission system doing its job and replaying
 * it would only produce the same answer twice. Reading the status alone gets this
 * wrong in both directions.
 */
export function isTokenRejected(status: number, body: string): boolean {
  if (status === 401) return true
  if (status !== 403) return false

  return errorCodes(body).includes('INVALID_TOKEN')
}

/** The `errors[].extensions.code` list, for both the REST and the GraphQL shape. */
function errorCodes(body: string): string[] {
  let payload: unknown

  try {
    payload = JSON.parse(body)
  } catch {
    return []
  }

  if (typeof payload !== 'object' || payload === null) return []

  const { errors } = payload as { errors?: unknown }
  if (!Array.isArray(errors)) return []

  return errors.flatMap((error: unknown) => {
    if (typeof error !== 'object' || error === null) return []

    const { extensions } = error as { extensions?: unknown }
    if (typeof extensions !== 'object' || extensions === null) return []

    const { code } = extensions as { code?: unknown }
    return typeof code === 'string' ? [code] : []
  })
}
