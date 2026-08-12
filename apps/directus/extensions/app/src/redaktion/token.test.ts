import { describe, expect, it } from 'vitest'
import {
  ablaufDatum,
  befundText,
  createToken,
  evaluateToken,
  freigabeLink,
  hashToken,
  TOKEN_BYTES
} from './token'

const JETZT = new Date('2026-08-11T10:00:00.000Z')

describe('createToken', () => {
  it('nimmt 256 Bit Zufall', () => {
    let angefordert = 0
    createToken((bytes) => {
      angefordert = bytes
      return Buffer.alloc(bytes)
    })
    expect(angefordert).toBe(TOKEN_BYTES)
  })

  it('liefert etwas URL-sicheres ohne Fuellzeichen', () => {
    const token = createToken()

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token).not.toContain('=')
    expect(encodeURIComponent(token)).toBe(token)
  })

  it('liefert bei jedem Aufruf etwas anderes', () => {
    const menge = new Set(Array.from({ length: 50 }, () => createToken()))
    expect(menge.size).toBe(50)
  })
})

describe('hashToken', () => {
  it('ist stabil', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
  })

  it('unterscheidet verschiedene Token', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })

  // The point of hashing at all: what is stored must not be usable as a
  // credential by whoever can read the table.
  it('gibt den Token nicht preis', () => {
    const token = createToken()
    const hash = hashToken(token)

    expect(hash).not.toContain(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('evaluateToken', () => {
  const gueltig = {
    hash: 'abc',
    ablauf: '2026-08-25T10:00:00.000Z',
    freigegebenAm: null
  }

  it('laesst einen frischen Token durch', () => {
    expect(evaluateToken(gueltig, JETZT)).toEqual({ gueltig: true })
  })

  // Single use. The conditional UPDATE that consumes the token nulls the hash
  // in the same statement, so a replayed link finds nothing.
  it('lehnt einen verbrauchten Token ab', () => {
    expect(evaluateToken({ ...gueltig, hash: null }, JETZT)).toEqual({
      gueltig: false,
      grund: 'verbraucht'
    })
  })

  it('lehnt ab, was schon entschieden wurde', () => {
    expect(
      evaluateToken(
        { ...gueltig, freigegebenAm: '2026-08-12T09:00:00Z' },
        JETZT
      )
    ).toEqual({ gueltig: false, grund: 'verbraucht' })
  })

  it('lehnt einen abgelaufenen Token ab', () => {
    expect(
      evaluateToken({ ...gueltig, ablauf: '2026-08-01T10:00:00.000Z' }, JETZT)
    ).toEqual({ gueltig: false, grund: 'abgelaufen' })
  })

  it('behandelt den Ablaufzeitpunkt selbst als abgelaufen', () => {
    expect(
      evaluateToken({ ...gueltig, ablauf: JETZT.toISOString() }, JETZT).gueltig
    ).toBe(false)
  })

  it('vertraegt einen fehlenden Ablauf', () => {
    expect(evaluateToken({ ...gueltig, ablauf: null }, JETZT).gueltig).toBe(
      true
    )
  })

  it('vertraegt einen kaputten Zeitstempel, statt daran zu scheitern', () => {
    expect(
      evaluateToken({ ...gueltig, ablauf: 'kein datum' }, JETZT).gueltig
    ).toBe(true)
  })
})

describe('befundText', () => {
  // Unknown and wrong are the same answer: the token is unguessable, so there is
  // nothing to leak by being vague and nothing to gain by being precise.
  it('sagt bei einem unbekannten Token nur, dass er ungueltig ist', () => {
    expect(befundText({ gueltig: false, grund: 'unbekannt' })).toBe(
      'Dieser Link ist nicht gueltig.'
    )
  })

  it('erklaert Ablauf und Verbrauch, weil das niemandem nuetzt und dem Nutzer hilft', () => {
    expect(befundText({ gueltig: false, grund: 'abgelaufen' })).toContain(
      'abgelaufen'
    )
    expect(befundText({ gueltig: false, grund: 'verbraucht' })).toContain(
      'bereits entschieden'
    )
  })

  it('schweigt bei einem gueltigen Token', () => {
    expect(befundText({ gueltig: true })).toBe('')
  })
})

describe('ablaufDatum', () => {
  it('rechnet Tage in die Zukunft', () => {
    expect(ablaufDatum(JETZT, 14).toISOString()).toBe(
      '2026-08-25T10:00:00.000Z'
    )
  })
})

describe('freigabeLink', () => {
  // The link points at the page, never at the API: opening it must be safe for
  // a link scanner, and the decision lives behind a button.
  it('zeigt auf die Frontend-Seite', () => {
    expect(freigabeLink('https://redaktion.example', 'abc123')).toBe(
      'https://redaktion.example/freigabe/abc123'
    )
  })

  it('vertraegt einen abschliessenden Schraegstrich', () => {
    expect(freigabeLink('https://redaktion.example/', 'abc')).toBe(
      'https://redaktion.example/freigabe/abc'
    )
  })

  // No id in the URL — that would invite probing which ids exist, and all
  // authority belongs to the token anyway.
  it('traegt keine Meldungs-Id', () => {
    const link = freigabeLink('https://x.test', createToken())
    expect(link.split('/').filter(Boolean)).toHaveLength(4)
  })
})
