import { describe, expect, it, vi } from 'vitest'
import { editorZugang, type EditorzugangDeps } from './editorzugang'
import {
  EDITOR_SCHWEIGT,
  KEIN_KONTO,
  KEIN_ZUGANG,
  NICHT_KONFIGURIERT
} from '../../redaktion/editorzugang'

const EIGEN = 'https://redaktion.example.ch'
const JETZT = new Date('2026-09-17T10:00:00.000Z')

function jwt(payload: Record<string, unknown>): string {
  const teil = (wert: unknown) =>
    Buffer.from(JSON.stringify(wert), 'utf8').toString('base64url')
  return `${teil({ alg: 'HS256', typ: 'JWT' })}.${teil(payload)}.unterschrift`
}

/** A real `userinfo` answer, with a test account and no real person's name. */
const USERINFO = {
  id: 'e8a1c2d4-0000-4000-8000-000000000001',
  email: 'redaktion.test@example.ch',
  name: 'Testkonto Redaktion',
  firstName: 'Testkonto',
  flair: null,
  roles: [
    {
      id: 'b1c2d3e4-0000-4000-8000-000000000002',
      name: 'Editor',
      description: 'Editor role',
      permissionIDs: [
        'CAN_GET_ARTICLES',
        'CAN_CREATE_ARTICLE',
        'CAN_PUBLISH_ARTICLE'
      ]
    }
  ]
}

const GUELTIG = jwt({ aud: EIGEN, exp: 1790_000_000, sub: USERINFO.id })

function deps(
  ueberschreibungen: Partial<EditorzugangDeps> = {}
): EditorzugangDeps {
  return {
    editorApiUrl: () => 'https://editor.example.ch',
    eigeneHerkunft: () => EIGEN,
    holeUserinfo: async () => USERINFO,
    findeBenutzer: async () => ({ id: 'd1', status: 'active' }),
    stelleSitzungAus: async () => ({
      accessToken: 'zugang',
      refreshToken: 'erneuerung',
      expires: 900_000
    }),
    jetzt: () => JETZT,
    ...ueberschreibungen
  }
}

describe('editorZugang', () => {
  it('hands out a Directus session pair for a valid token', async () => {
    const antwort = await editorZugang({ token: GUELTIG }, deps())

    expect(antwort.status).toBe(200)
    expect(antwort.koerper).toEqual({
      data: {
        access_token: 'zugang',
        refresh_token: 'erneuerung',
        expires: 900_000
      }
    })
  })

  it('looks the user up by the e-mail the editor reported, lower-cased', async () => {
    const findeBenutzer = vi.fn(async () => ({ id: 'd1', status: 'active' }))
    await editorZugang(
      { token: GUELTIG },
      deps({
        findeBenutzer,
        holeUserinfo: async () => ({
          ...USERINFO,
          email: 'Redaktion.Test@Example.ch'
        })
      })
    )

    expect(findeBenutzer).toHaveBeenCalledWith('redaktion.test@example.ch')
  })

  it('stays silent and says so when the door is not configured', async () => {
    const ohneUrl = await editorZugang(
      { token: GUELTIG },
      deps({ editorApiUrl: () => '' })
    )
    expect(ohneUrl.status).toBe(503)
    expect(ohneUrl.koerper).toEqual({
      errors: [{ message: NICHT_KONFIGURIERT }]
    })

    const ohneHerkunft = await editorZugang(
      { token: GUELTIG },
      deps({ eigeneHerkunft: () => '' })
    )
    expect(ohneHerkunft.status).toBe(503)
  })

  it('never asks the editor about a token addressed elsewhere', async () => {
    const holeUserinfo = vi.fn(async () => USERINFO)
    const antwort = await editorZugang(
      { token: jwt({ aud: 'https://andere.example.ch', exp: 1790_000_000 }) },
      deps({ holeUserinfo })
    )

    expect(antwort.status).toBe(401)
    expect(holeUserinfo).not.toHaveBeenCalled()
  })

  it('refuses an expired token with its own reason', async () => {
    const antwort = await editorZugang(
      { token: jwt({ aud: EIGEN, exp: 1789_000_000 }) },
      deps()
    )
    expect(antwort.status).toBe(401)
    expect(JSON.stringify(antwort.koerper)).toContain('abgelaufen')
  })

  it('refuses a body without a token', async () => {
    expect((await editorZugang({}, deps())).status).toBe(401)
    expect((await editorZugang(null, deps())).status).toBe(401)
  })

  it('says the editor did not confirm when userinfo answers nothing usable', async () => {
    const stumm = await editorZugang(
      { token: GUELTIG },
      deps({ holeUserinfo: async () => null })
    )
    expect(stumm.koerper).toEqual({ errors: [{ message: EDITOR_SCHWEIGT }] })
    expect(stumm.status).toBe(401)

    const ohneMail = await editorZugang(
      { token: GUELTIG },
      deps({ holeUserinfo: async () => ({ id: 'x', roles: [] }) })
    )
    expect(ohneMail.status).toBe(401)
  })

  it('turns away an editor account that may not publish articles', async () => {
    const antwort = await editorZugang(
      { token: GUELTIG },
      deps({
        holeUserinfo: async () => ({
          ...USERINFO,
          roles: [
            { id: 'r', name: 'Leser', permissionIDs: ['CAN_GET_ARTICLES'] }
          ]
        })
      })
    )

    expect(antwort.status).toBe(403)
    expect(JSON.stringify(antwort.koerper)).toContain('Leserolle')
  })

  it('turns away an editor account with no article permission at all', async () => {
    const antwort = await editorZugang(
      { token: GUELTIG },
      deps({
        holeUserinfo: async () => ({
          ...USERINFO,
          roles: [
            { id: 'r', name: 'Gast', permissionIDs: ['CAN_GET_COMMENTS'] }
          ]
        })
      })
    )

    expect(antwort.koerper).toEqual({ errors: [{ message: KEIN_ZUGANG }] })
    expect(antwort.status).toBe(403)
  })

  it('never creates a user that does not exist here', async () => {
    const stelleSitzungAus = vi.fn()
    const antwort = await editorZugang(
      { token: GUELTIG },
      deps({ findeBenutzer: async () => null, stelleSitzungAus })
    )

    expect(antwort.status).toBe(403)
    expect(antwort.koerper).toEqual({ errors: [{ message: KEIN_KONTO }] })
    expect(stelleSitzungAus).not.toHaveBeenCalled()
  })

  it('treats a suspended Directus user like a missing one', async () => {
    const antwort = await editorZugang(
      { token: GUELTIG },
      deps({ findeBenutzer: async () => ({ id: 'd1', status: 'suspended' }) })
    )
    expect(antwort.status).toBe(403)
  })
})
