import {
  createRefreshCache,
  isTokenRejected,
  ROTATION_GRACE_MS,
  type SessionTokens
} from '@/lib/sessionRefresh'

function tokens(n: number): SessionTokens {
  return { accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expires: 900_000 }
}

describe('createRefreshCache', () => {
  it('rotates once for a burst of requests carrying the same refresh token', async () => {
    const cache = createRefreshCache()
    let calls = 0
    const rotate = async () => {
      calls += 1
      return tokens(calls)
    }

    const results = await Promise.all([
      cache.renew('alt', rotate),
      cache.renew('alt', rotate),
      cache.renew('alt', rotate)
    ])

    expect(calls).toBe(1)
    expect(results.map((r) => r.accessToken)).toEqual(['access-1', 'access-1', 'access-1'])
  })

  it('still answers a straggler that left before the new cookie arrived', async () => {
    const cache = createRefreshCache()
    let calls = 0
    const rotate = async () => {
      calls += 1
      return tokens(calls)
    }

    const first = await cache.renew('alt', rotate)
    const late = await cache.renew('alt', rotate)

    expect(calls).toBe(1)
    expect(late).toEqual(first)
  })

  it('rotates again once the grace window has passed', async () => {
    let clock = 1_000
    const cache = createRefreshCache(() => clock)
    let calls = 0
    const rotate = async () => {
      calls += 1
      return tokens(calls)
    }

    await cache.renew('alt', rotate)
    clock += ROTATION_GRACE_MS
    const later = await cache.renew('alt', rotate)

    expect(calls).toBe(2)
    expect(later.accessToken).toBe('access-2')
  })

  it('does not remember a failed rotation', async () => {
    const cache = createRefreshCache()
    let calls = 0
    const rotate = async () => {
      calls += 1
      if (calls === 1) throw new Error('Directus refresh failed with 401')
      return tokens(calls)
    }

    await expect(cache.renew('alt', rotate)).rejects.toThrow()
    expect(cache.size).toBe(0)

    await expect(cache.renew('alt', rotate)).resolves.toEqual(tokens(2))
    expect(calls).toBe(2)
  })

  it('shares one failure with everyone waiting on it', async () => {
    const cache = createRefreshCache()
    let calls = 0
    const rotate = async () => {
      calls += 1
      throw new Error('Directus refresh failed with 401')
    }

    const results = await Promise.allSettled([cache.renew('alt', rotate), cache.renew('alt', rotate)])

    expect(calls).toBe(1)
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
  })

  it('treats a rotated token as a rotation of its own', async () => {
    const cache = createRefreshCache()
    let calls = 0
    const rotate = async () => {
      calls += 1
      return tokens(calls)
    }

    const first = await cache.renew('alt', rotate)
    await cache.renew(first.refreshToken, rotate)

    expect(calls).toBe(2)
  })

  it('forgets on request', async () => {
    const cache = createRefreshCache()
    let calls = 0
    const rotate = async () => {
      calls += 1
      return tokens(calls)
    }

    await cache.renew('alt', rotate)
    cache.forget('alt')
    await cache.renew('alt', rotate)

    expect(calls).toBe(2)
  })

  it('stays bounded', async () => {
    const cache = createRefreshCache()
    const rotate = async (token: string) => ({ ...tokens(1), refreshToken: token })

    for (let i = 0; i < 200; i += 1) await cache.renew(`token-${i}`, rotate)

    expect(cache.size).toBeLessThanOrEqual(64)
  })
})

describe('isTokenRejected', () => {
  const invalid = JSON.stringify({
    errors: [{ message: 'Invalid token.', extensions: { code: 'INVALID_TOKEN' } }]
  })
  const forbidden = JSON.stringify({
    errors: [{ message: 'You don’t have permission to access this.', extensions: { code: 'FORBIDDEN' } }]
  })

  it('replays an expired token', () => {
    expect(
      isTokenRejected(401, JSON.stringify({ errors: [{ extensions: { code: 'TOKEN_EXPIRED' } }] }))
    ).toBe(true)
  })

  it('replays the 403 Directus sends for a session that no longer exists', () => {
    expect(isTokenRejected(403, invalid)).toBe(true)
  })

  it('leaves a permission error alone', () => {
    expect(isTokenRejected(403, forbidden)).toBe(false)
  })

  it('leaves an ordinary answer alone', () => {
    expect(isTokenRejected(200, JSON.stringify({ data: {} }))).toBe(false)
    expect(isTokenRejected(400, invalid)).toBe(false)
  })

  it('survives a body that is not the shape we expect', () => {
    expect(isTokenRejected(403, '<html>gateway</html>')).toBe(false)
    expect(isTokenRejected(403, 'null')).toBe(false)
    expect(isTokenRejected(403, '{"errors":null}')).toBe(false)
    expect(isTokenRejected(403, '{"errors":[null,{"extensions":{"code":42}}]}')).toBe(false)
    expect(isTokenRejected(401, '')).toBe(true)
  })

  it('finds the code among several errors', () => {
    const body = JSON.stringify({
      errors: [{ extensions: { code: 'FORBIDDEN' } }, { extensions: { code: 'INVALID_TOKEN' } }]
    })
    expect(isTokenRejected(403, body)).toBe(true)
  })
})
