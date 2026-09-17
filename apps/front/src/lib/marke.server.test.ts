/**
 * @jest-environment node
 *
 * Node, not jsdom: the marker is sealed with Web Crypto, and `crypto.subtle` is
 * undefined in this project's jsdom environment (measured 17 September 2026).
 * The module is server-only anyway — it never runs in a browser.
 */
import { MARKE_LEBENSDAUER_MS, oeffne, versiegle } from './marke.server'

const SCHLUESSEL = Buffer.alloc(32, 7).toString('base64')
const ANDERER = Buffer.alloc(32, 9).toString('base64')
const JETZT = new Date('2026-09-17T10:00:00.000Z').getTime()

/** A marker, or a failed test — never a `string | null` the assertions ignore. */
async function marker(jetzt: number, schluessel: string): Promise<string> {
  const marke = await versiegle(TOKENS, jetzt, schluessel)
  if (marke === null) throw new Error('versiegle hat keine Marke geliefert')
  return marke
}

const TOKENS = {
  accessToken: 'zugangs-token',
  refreshToken: 'erneuerungs-token',
  expires: 900_000
}

describe('versiegle / oeffne', () => {
  it('gives the same tokens back', async () => {
    const marke = await marker(JETZT, SCHLUESSEL)
    expect(await oeffne(marke, JETZT, SCHLUESSEL)).toEqual(TOKENS)
  })

  it('never produces the same marker twice for the same tokens', async () => {
    const a = await marker(JETZT, SCHLUESSEL)
    const b = await marker(JETZT, SCHLUESSEL)
    expect(a).not.toBe(b)
  })

  it('lives exactly as long as the refresh token', async () => {
    const marke = await marker(JETZT, SCHLUESSEL)

    expect(await oeffne(marke, JETZT + MARKE_LEBENSDAUER_MS - 1000, SCHLUESSEL)).toEqual(TOKENS)
    expect(await oeffne(marke, JETZT + MARKE_LEBENSDAUER_MS + 1000, SCHLUESSEL)).toBeNull()
  })

  it('answers null for one flipped byte instead of throwing', async () => {
    const marke = await marker(JETZT, SCHLUESSEL)
    const roh = Buffer.from(marke, 'base64url')
    roh[roh.length - 3] = (roh[roh.length - 3] ?? 0) ^ 0xff

    await expect(oeffne(roh.toString('base64url'), JETZT, SCHLUESSEL)).resolves.toBeNull()
  })

  it('answers null for a marker sealed with another key', async () => {
    const marke = await marker(JETZT, SCHLUESSEL)
    expect(await oeffne(marke, JETZT, ANDERER)).toBeNull()
  })

  it('answers null for anything that is not a marker', async () => {
    expect(await oeffne('', JETZT, SCHLUESSEL)).toBeNull()
    expect(await oeffne('nicht-base64url!!', JETZT, SCHLUESSEL)).toBeNull()
    expect(await oeffne('kurz', JETZT, SCHLUESSEL)).toBeNull()
  })

  it('is switched off without a key, and never half on', async () => {
    expect(await versiegle(TOKENS, JETZT, '')).toBeNull()
    expect(await oeffne('irgendwas', JETZT, '')).toBeNull()
  })

  it('refuses a key that is not 32 bytes rather than shortening it', async () => {
    const zuKurz = Buffer.alloc(16, 3).toString('base64')
    expect(await versiegle(TOKENS, JETZT, zuKurz)).toBeNull()
  })
})
