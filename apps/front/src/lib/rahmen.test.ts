import {
  eigeneHerkunft,
  istRahmenSitzung,
  MARKE_KOPFZEILE,
  markeAus,
  RAHMEN_KOPFZEILE,
  ursprungErlaubt
} from './rahmen'

function kopf(eintraege: Record<string, string>) {
  return {
    get: (name: string) => eintraege[name.toLowerCase()] ?? null
  }
}

describe('istRahmenSitzung', () => {
  it('is true when the request carries a marker', () => {
    expect(istRahmenSitzung(kopf({ [MARKE_KOPFZEILE]: 'abc' }))).toBe(true)
  })

  it('is true when the login form says it sits in the frame', () => {
    expect(istRahmenSitzung(kopf({ [RAHMEN_KOPFZEILE]: 'editor' }))).toBe(true)
  })

  it('is false for an ordinary request', () => {
    expect(istRahmenSitzung(kopf({}))).toBe(false)
    expect(istRahmenSitzung(kopf({ [MARKE_KOPFZEILE]: '   ' }))).toBe(false)
    expect(istRahmenSitzung(kopf({ [RAHMEN_KOPFZEILE]: 'nein' }))).toBe(false)
  })
})

describe('markeAus', () => {
  it('reads the marker and nothing else', () => {
    expect(markeAus(kopf({ [MARKE_KOPFZEILE]: ' abc ' }))).toBe('abc')
    expect(markeAus(kopf({}))).toBeNull()
    expect(markeAus(kopf({ [MARKE_KOPFZEILE]: '' }))).toBeNull()
  })
})

describe('eigeneHerkunft', () => {
  it('reads what the reverse proxy forwarded, not the container address', () => {
    expect(
      eigeneHerkunft(
        kopf({
          host: 'redaktion-front:3000',
          'x-forwarded-host': 'redaktion.example.ch',
          'x-forwarded-proto': 'https'
        })
      )
    ).toBe('https://redaktion.example.ch')
  })

  it('falls back to the plain Host header', () => {
    expect(eigeneHerkunft(kopf({ host: 'localhost:3000', 'x-forwarded-proto': 'http' }))).toBe(
      'http://localhost:3000'
    )
  })

  it('takes the first entry of a forwarded chain', () => {
    expect(eigeneHerkunft(kopf({ host: 'a.example.ch', 'x-forwarded-proto': 'https, http' }))).toBe(
      'https://a.example.ch'
    )
  })

  it('answers empty without a host, so nothing matches by accident', () => {
    expect(eigeneHerkunft(kopf({}))).toBe('')
  })
})

describe('ursprungErlaubt', () => {
  const EIGEN = 'https://redaktion.example.ch'
  const EDITOR = 'https://editor.example.ch https://zweiter.example.ch'

  it('allows the workspace itself', () => {
    expect(ursprungErlaubt(EIGEN, EIGEN, '')).toBe(true)
  })

  it('allows every origin that may frame it', () => {
    expect(ursprungErlaubt('https://editor.example.ch', EIGEN, EDITOR)).toBe(true)
    expect(ursprungErlaubt('https://zweiter.example.ch', EIGEN, EDITOR)).toBe(true)
  })

  it('refuses anybody else', () => {
    expect(ursprungErlaubt('https://boese.example.ch', EIGEN, EDITOR)).toBe(false)
  })

  it('refuses a request without an Origin, because that is the forged case', () => {
    expect(ursprungErlaubt(null, EIGEN, EDITOR)).toBe(false)
    expect(ursprungErlaubt('', EIGEN, EDITOR)).toBe(false)
  })

  it('reuses the embedding allow-list and drops what is not a bare https origin', () => {
    expect(ursprungErlaubt('http://editor.example.ch', EIGEN, 'http://editor.example.ch')).toBe(false)
    expect(ursprungErlaubt('https://editor.example.ch', EIGEN, 'https://editor.example.ch/pfad')).toBe(false)
  })
})
