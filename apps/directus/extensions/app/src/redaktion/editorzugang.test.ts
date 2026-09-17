import { describe, expect, it } from 'vitest'
import {
  befundMeldung,
  herkunftVon,
  KEIN_KONTO,
  parseUserinfo,
  pruefeToken,
  rolleFuer
} from './editorzugang'

/** A JWT with the given payload and a signature nobody here verifies. */
function token(payload: Record<string, unknown>): string {
  const teil = (wert: unknown) =>
    Buffer.from(JSON.stringify(wert), 'utf8').toString('base64url')
  return `${teil({ alg: 'HS256', typ: 'JWT' })}.${teil(payload)}.unterschrift`
}

const JETZT = new Date('2026-09-17T10:00:00.000Z')

describe('herkunftVon', () => {
  it('reduces an address to scheme, host and port', () => {
    expect(herkunftVon('https://redaktion.example.ch/')).toBe(
      'https://redaktion.example.ch'
    )
    expect(herkunftVon('https://redaktion.example.ch:8443/tisch')).toBe(
      'https://redaktion.example.ch:8443'
    )
  })

  it('answers null for anything that is not an address', () => {
    expect(herkunftVon('')).toBeNull()
    expect(herkunftVon('redaktion.example.ch')).toBeNull()
  })
})

describe('pruefeToken', () => {
  const EIGEN = 'https://redaktion.example.ch'

  it('accepts a token addressed to this instance', () => {
    const befund = pruefeToken(
      token({ aud: EIGEN, exp: 1790_000_000, sub: 'u1' }),
      EIGEN,
      JETZT
    )
    expect(befund).toEqual({ ok: true, audience: EIGEN })
  })

  it('accepts an audience that differs only by a trailing slash', () => {
    const befund = pruefeToken(
      token({ aud: `${EIGEN}/`, exp: 1790_000_000 }),
      EIGEN,
      JETZT
    )
    expect(befund.ok).toBe(true)
  })

  it('refuses a token minted for another external app', () => {
    const befund = pruefeToken(
      token({ aud: 'https://andere-app.example.ch', exp: 1790_000_000 }),
      EIGEN,
      JETZT
    )
    expect(befund).toEqual({ ok: false, grund: 'fremde_audience' })
  })

  it('refuses an expired token without asking the editor', () => {
    const abgelaufen = Math.floor(JETZT.getTime() / 1000) - 60
    const befund = pruefeToken(
      token({ aud: EIGEN, exp: abgelaufen }),
      EIGEN,
      JETZT
    )
    expect(befund).toEqual({ ok: false, grund: 'abgelaufen' })
  })

  it('refuses anything that is not a readable JWT', () => {
    expect(pruefeToken('kein-token', EIGEN, JETZT)).toEqual({
      ok: false,
      grund: 'unlesbar'
    })
    expect(pruefeToken(undefined, EIGEN, JETZT)).toEqual({
      ok: false,
      grund: 'unlesbar'
    })
    expect(pruefeToken(token({ exp: 1790_000_000 }), EIGEN, JETZT)).toEqual({
      ok: false,
      grund: 'fremde_audience'
    })
  })

  it('says every refusal in German', () => {
    expect(befundMeldung('abgelaufen')).toContain('abgelaufen')
    expect(befundMeldung('fremde_audience')).not.toBe('')
    expect(befundMeldung('unlesbar')).not.toBe('')
  })
})

describe('parseUserinfo', () => {
  it('reads the user and the permissions of all their roles', () => {
    const nutzer = parseUserinfo({
      id: 'u1',
      email: 'Test.Redaktion@example.ch',
      name: 'Testkonto',
      roles: [
        { id: 'r1', name: 'Editor', permissionIDs: ['CAN_GET_ARTICLES'] },
        { id: 'r2', name: 'Chef', permissionIDs: ['CAN_PUBLISH_ARTICLE'] }
      ]
    })

    expect(nutzer).not.toBeNull()
    expect(nutzer?.email).toBe('test.redaktion@example.ch')
    expect(nutzer?.berechtigungen).toEqual([
      'CAN_GET_ARTICLES',
      'CAN_PUBLISH_ARTICLE'
    ])
  })

  it('answers null without an e-mail, because that is the only key we have', () => {
    expect(parseUserinfo({ id: 'u1', roles: [] })).toBeNull()
    expect(parseUserinfo(null)).toBeNull()
    expect(parseUserinfo({ id: 'u1', email: '', roles: [] })).toBeNull()
  })

  it('survives a roles list that is not a list of roles', () => {
    const nutzer = parseUserinfo({ id: 'u1', email: 'a@b.ch', roles: 'viele' })
    expect(nutzer?.berechtigungen).toEqual([])
  })
})

describe('rolleFuer', () => {
  const nutzer = (berechtigungen: string[]) => ({
    id: 'u1',
    email: 'a@b.ch',
    berechtigungen
  })

  it('lets somebody who may publish articles into the newsroom', () => {
    expect(rolleFuer(nutzer(['CAN_GET_ARTICLES', 'CAN_PUBLISH_ARTICLE']))).toBe(
      'redaktion'
    )
  })

  it('files somebody who may only read as a reader', () => {
    expect(rolleFuer(nutzer(['CAN_GET_ARTICLES']))).toBe('lesen')
  })

  it('turns away somebody with neither', () => {
    expect(rolleFuer(nutzer(['CAN_GET_COMMENTS']))).toBe('kein_zugang')
    expect(rolleFuer(nutzer([]))).toBe('kein_zugang')
  })
})

describe('the messages', () => {
  it('names the missing account without naming the person', () => {
    expect(KEIN_KONTO).toBe(
      'Für dieses Editor-Konto gibt es in der Redaktion noch keinen Zugang.'
    )
  })
})
