import { createHash, randomBytes } from 'node:crypto'

// The approval link, and why it is built this way.
//
// A person outside the newsroom gets a link, opens it, reads the article and
// says yes or no. They have no account, so the link itself is the credential —
// which makes every detail below load-bearing.
//
// The rule that shapes the rest: **a GET must never record a decision.**
// Link scanners fetch these. WhatsApp builds a preview, Outlook SafeLinks
// pre-fetches, corporate proxies inspect. A link that approves on GET would
// approve articles nobody ever looked at, silently, and the counter-check would
// become theatre. So the link opens a page; the decision is a POST from a
// button, with the token in the body.

/** Test seam, so a test can pin the token instead of guessing it. */
export type ZufallsQuelle = (bytes: number) => Buffer

const echterZufall: ZufallsQuelle = (bytes) => randomBytes(bytes)

/** 256 bits. Not a uuid, and certainly not Math.random. */
export const TOKEN_BYTES = 32

export function createToken(zufall: ZufallsQuelle = echterZufall): string {
  return zufall(TOKEN_BYTES).toString('base64url')
}

/**
 * What goes in the database.
 *
 * Only the digest is stored, never the token. A database dump, an over-broad
 * read policy or a screenshot of the admin UI must not hand out the power to
 * approve.
 *
 * SHA-256 and deliberately not bcrypt or argon: the input is 256 bits of
 * entropy, not a password. There is nothing to brute-force, and a slow hash
 * would only make every lookup slow.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export type TokenBefund =
  | { gueltig: true }
  | { gueltig: false; grund: 'unbekannt' | 'abgelaufen' | 'verbraucht' }

export interface TokenZustand {
  /** Null once the token has been consumed. */
  hash: string | null
  ablauf: string | Date | null
  freigegebenAm: string | Date | null
}

function alsZeit(wert: string | Date | null): number | null {
  if (wert === null) return null
  const datum = wert instanceof Date ? wert : new Date(wert)
  return Number.isNaN(datum.getTime()) ? null : datum.getTime()
}

/**
 * Judges a token that has already been looked up by its hash.
 *
 * Note what is *not* here: comparing the token to anything. The lookup is an
 * indexed equality on a digest, so there is no string comparison against a
 * secret and no timing surface to speak of.
 */
export function evaluateToken(zustand: TokenZustand, jetzt: Date): TokenBefund {
  if (zustand.hash === null) return { gueltig: false, grund: 'verbraucht' }
  if (alsZeit(zustand.freigegebenAm) !== null) {
    return { gueltig: false, grund: 'verbraucht' }
  }

  const ablauf = alsZeit(zustand.ablauf)
  if (ablauf !== null && ablauf <= jetzt.getTime()) {
    return { gueltig: false, grund: 'abgelaufen' }
  }

  return { gueltig: true }
}

/**
 * What the person on the other end is told.
 *
 * "Unknown" and "wrong" are the same thing here — the token is unguessable, so
 * there is nothing to leak by being vague, and nothing to gain either. Expired
 * and already-used get their own message because that is genuinely useful and
 * equally unexploitable.
 */
export function befundText(befund: TokenBefund): string {
  if (befund.gueltig) return ''

  switch (befund.grund) {
    case 'abgelaufen':
      return 'Dieser Link ist abgelaufen. Bitte bei der Redaktion einen neuen anfordern.'
    case 'verbraucht':
      return 'Ueber diese Meldung wurde bereits entschieden.'
    default:
      return 'Dieser Link ist nicht gueltig.'
  }
}

export function ablaufDatum(jetzt: Date, tage: number): Date {
  return new Date(jetzt.getTime() + tage * 24 * 60 * 60 * 1000)
}

/**
 * The link that goes out.
 *
 * It points at the frontend, not at the API: the page is what a bot may safely
 * fetch, and the decision lives behind a button on it.
 */
export function freigabeLink(basisUrl: string, token: string): string {
  return `${basisUrl.replace(/\/+$/, '')}/freigabe/${encodeURIComponent(token)}`
}
