import 'server-only'
import type { DirectusSessionTokens } from './directus.server'

// The session marker — the session, carried in a header instead of a cookie.
//
// **Why it exists.** With `EDITOR_EINBETTUNG` set, the workspace runs inside
// the We.Publish editor's iframe, which makes it a third-party context. Safari
// blocks third-party cookies outright and Firefox partitions them, so the
// `SameSite=None` cookies of `session.server.ts` simply never arrive and the
// embedded workspace looks logged out with no error anywhere (measured
// 16 September 2026, apps/front/CLAUDE.md). A cookie flag cannot fix that.
//
// **What it is.** The very same token pair that lives in those two cookies,
// sealed into one opaque string: AES-256-GCM over a compact JSON, with a
// 12-byte IV in front, base64url. The key is `SITZUNGSMARKE_SCHLUESSEL`.
// Nothing new is trusted to the browser — the marker is unreadable without the
// key, which never leaves this server process.
//
// **What it costs.** The marker lives in the page's memory (a module variable),
// never in `localStorage` and never in the address after the entry. A reload
// inside the frame therefore loses it, and the editor hands out a fresh token
// instead — 240 minutes' worth. That is the deal, and it is written down here
// rather than discovered later.
//
// Empty key means off, never half on: `versiegle` answers null and the page
// says the frame login is not configured (the `CRAWLER_KEY` bargain).

/** As long as the refresh token lives — `REFRESH_TOKEN_TTL` in the backend. */
export const MARKE_LEBENSDAUER_MS = 7 * 24 * 60 * 60 * 1000

const IV_BYTES = 12
const SCHLUESSEL_BYTES = 32

interface Inhalt {
  a: string
  r: string
  e: number
  /** Epoch milliseconds at which this marker stops being one. */
  g: number
}

function schluesselAusUmgebung(): string {
  return process.env.SITZUNGSMARKE_SCHLUESSEL ?? ''
}

/** True when this instance can carry a session in a frame at all. */
export function markeMoeglich(roh: string = schluesselAusUmgebung()): boolean {
  return rohschluessel(roh) !== null
}

function rohschluessel(roh: string): ArrayBuffer | null {
  const text = roh.trim()
  if (text === '') return null
  try {
    const bytes = Buffer.from(text, 'base64')
    // Exactly 32 bytes, never padded or cut: a key of the wrong length is a
    // configuration mistake, and silently repairing it would hide it for good.
    if (bytes.length !== SCHLUESSEL_BYTES) return null
    // Copied out of Node's pooled buffer: `Buffer` is a view into a shared
    // allocation, and Web Crypto wants a buffer of its own.
    const eigen = new ArrayBuffer(bytes.length)
    new Uint8Array(eigen).set(bytes)
    return eigen
  } catch {
    return null
  }
}

async function ladeSchluessel(roh: string): Promise<CryptoKey | null> {
  const bytes = rohschluessel(roh)
  if (bytes === null) return null
  try {
    return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
  } catch {
    return null
  }
}

/**
 * Seals a token pair into a marker, or answers null when this instance has no
 * key. Never throws: a caller must be able to treat "no marker" as an ordinary
 * answer rather than an exception to remember.
 */
export async function versiegle(
  tokens: DirectusSessionTokens,
  jetzt: number,
  schluessel: string = schluesselAusUmgebung()
): Promise<string | null> {
  const key = await ladeSchluessel(schluessel)
  if (key === null) return null

  const inhalt: Inhalt = {
    a: tokens.accessToken,
    r: tokens.refreshToken,
    e: tokens.expires,
    g: jetzt + MARKE_LEBENSDAUER_MS
  }

  try {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const klartext = new TextEncoder().encode(JSON.stringify(inhalt))
    const geheim = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, klartext)

    const ganz = new Uint8Array(IV_BYTES + geheim.byteLength)
    ganz.set(iv, 0)
    ganz.set(new Uint8Array(geheim), IV_BYTES)
    return Buffer.from(ganz).toString('base64url')
  } catch {
    return null
  }
}

/**
 * Opens a marker, or answers null.
 *
 * Expired, tampered with, sealed with another key, not a marker at all, no key
 * configured — all of them are the same answer, and none of them is an
 * exception that reaches a route handler. A caller that gets null falls back to
 * the cookies, exactly as if nothing had been sent.
 */
export async function oeffne(
  marke: string,
  jetzt: number,
  schluessel: string = schluesselAusUmgebung()
): Promise<DirectusSessionTokens | null> {
  const key = await ladeSchluessel(schluessel)
  if (key === null || marke.trim() === '') return null

  try {
    const ganz = Uint8Array.from(Buffer.from(marke.trim(), 'base64url'))
    if (ganz.length <= IV_BYTES) return null

    const iv = ganz.slice(0, IV_BYTES)
    const geheim = ganz.slice(IV_BYTES)
    const klartext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, geheim)

    const inhalt = JSON.parse(new TextDecoder().decode(klartext)) as Partial<Inhalt>
    if (
      typeof inhalt.a !== 'string' ||
      typeof inhalt.r !== 'string' ||
      typeof inhalt.e !== 'number' ||
      typeof inhalt.g !== 'number'
    ) {
      return null
    }
    if (inhalt.g <= jetzt) return null

    return { accessToken: inhalt.a, refreshToken: inhalt.r, expires: inhalt.e }
  } catch {
    return null
  }
}
