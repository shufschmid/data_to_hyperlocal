import {
  holeMarke,
  loescheMarke,
  setzeMarke,
  sitzungsFetch,
  uebernehmeFragment,
  rahmenFehler
} from './marke.client'

function adresse(href: string) {
  window.history.replaceState(null, '', href)
}

/** The headers of the call the stub received. */
function gesendet(roh: jest.Mock): Headers {
  const init = roh.mock.calls[0]?.[1] as RequestInit | undefined
  return new Headers(init?.headers)
}

/** jsdom has `Headers` but no `Response`, so the answer is a stub. */
function antwort(status = 200, kopf: Record<string, string> = {}): Response {
  return {
    status,
    headers: { get: (name: string) => kopf[name.toLowerCase()] ?? null }
  } as unknown as Response
}

beforeEach(() => {
  loescheMarke()
  adresse('/')
})

describe('uebernehmeFragment', () => {
  it('takes the marker out of the address and keeps it in memory only', () => {
    adresse('/?rahmen=editor#m=abc123')

    uebernehmeFragment()

    expect(holeMarke()).toBe('abc123')
    expect(window.location.hash).toBe('')
    // The query stays: it is how the login form knows it sits in the frame.
    expect(window.location.search).toBe('?rahmen=editor')
  })

  it('keeps a refusal from the entry route for the screen', () => {
    adresse('/?rahmen=editor#fehler=Kein%20Zugang')

    uebernehmeFragment()

    expect(rahmenFehler()).toBe('Kein Zugang')
    expect(holeMarke()).toBeNull()
    expect(window.location.hash).toBe('')
  })

  it('does nothing without a fragment', () => {
    adresse('/?rahmen=editor')
    uebernehmeFragment()
    expect(holeMarke()).toBeNull()
    expect(rahmenFehler()).toBeNull()
  })
})

describe('sitzungsFetch', () => {
  it('sends nothing extra outside the frame', async () => {
    const roh = jest.fn(async () => antwort())
    await sitzungsFetch('/api/auth/session', {}, roh as unknown as typeof fetch)

    const kopf = gesendet(roh)
    expect(kopf.get('x-sitzungsmarke')).toBeNull()
    expect(kopf.get('x-rahmen')).toBeNull()
  })

  it('announces the frame before a marker exists, so the login answers with one', async () => {
    adresse('/?rahmen=editor')
    const roh = jest.fn(async () => antwort())

    await sitzungsFetch('/api/auth/login', { method: 'POST' }, roh as unknown as typeof fetch)

    expect(gesendet(roh).get('x-rahmen')).toBe('editor')
  })

  it('carries the marker and picks up a renewed one', async () => {
    setzeMarke('alt')
    const roh = jest.fn(async () => antwort(200, { 'x-sitzungsmarke': 'neu' }))

    await sitzungsFetch('/api/graphql', { method: 'POST' }, roh as unknown as typeof fetch)

    expect(gesendet(roh).get('x-sitzungsmarke')).toBe('alt')
    expect(holeMarke()).toBe('neu')
  })

  it('drops the marker when the session is refused', async () => {
    setzeMarke('alt')
    const roh = jest.fn(async () => antwort(401))

    await sitzungsFetch('/api/graphql', { method: 'POST' }, roh as unknown as typeof fetch)

    expect(holeMarke()).toBeNull()
  })

  it('leaves the existing headers of the caller alone', async () => {
    setzeMarke('alt')
    const roh = jest.fn(async () => antwort())

    await sitzungsFetch(
      '/api/redaktion/tabellen',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      roh as unknown as typeof fetch
    )

    const kopf = gesendet(roh)
    expect(kopf.get('content-type')).toBe('application/json')
    expect(kopf.get('x-sitzungsmarke')).toBe('alt')
  })
})
