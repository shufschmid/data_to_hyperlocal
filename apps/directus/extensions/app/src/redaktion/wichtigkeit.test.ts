import { describe, expect, it, vi } from 'vitest'
import {
  ladeWichtigkeitSignale,
  ordneBeispiele,
  wichtigkeitDigest
} from './wichtigkeit'

describe('ladeWichtigkeitSignale', () => {
  it('liest nur Zeilen, auf denen Vorschlag UND Urteil stehen, je Tisch', async () => {
    const readByQuery = vi
      .fn()
      .mockResolvedValueOnce([
        { titel: 'Dorffest', wichtig: true, wichtig_vorschlag: false },
        { titel: 'Jassnachmittag', wichtig: false, wichtig_vorschlag: false }
      ])
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    const signale = await ladeWichtigkeitSignale(
      { readByQuery },
      'veranstaltung',
      2
    )

    const erste = readByQuery.mock.calls[0]?.[0] as {
      filter: Record<string, unknown>
      limit: number
    }
    expect(erste.filter).toEqual({
      veranstaltung: { _nnull: true },
      wichtig: { _nnull: true },
      wichtig_vorschlag: { _nnull: true }
    })
    expect(erste.limit).toBe(2)
    expect(signale.beispiele).toEqual([
      { titel: 'Dorffest', wichtig: true, vorschlag: false },
      { titel: 'Jassnachmittag', wichtig: false, vorschlag: false }
    ])
    // Drei entschieden, zwei geladen: die Kappung ist gezaehlt.
    expect(signale.weitere).toBe(1)
  })
})

describe('ordneBeispiele', () => {
  // Die Abweichung ist das Signal — sie steht zuerst.
  it('stellt die Abweichungen vor die Bestaetigungen', () => {
    expect(
      ordneBeispiele([
        { titel: 'A', wichtig: true, vorschlag: true },
        { titel: 'B', wichtig: false, vorschlag: true },
        { titel: 'C', wichtig: true, vorschlag: false }
      ]).map((b) => b.titel)
    ).toEqual(['B', 'C', 'A'])
  })
})

describe('wichtigkeitDigest', () => {
  it('bleibt leer, solange die Redaktion nichts entschieden hat', () => {
    expect(wichtigkeitDigest({ beispiele: [], weitere: 0 })).toBe('')
  })

  it('nennt Urteil und Vorschlag und deklariert die Kappung', () => {
    const text = wichtigkeitDigest({
      beispiele: [
        { titel: 'Dorffest', wichtig: true, vorschlag: false },
        { titel: 'Kurs', wichtig: false, vorschlag: false }
      ],
      weitere: 4
    })
    expect(text).toContain(
      '- "Dorffest" → WICHTIG (der Vorschlag war: nicht wichtig)'
    )
    expect(text).toContain('- "Kurs" → nicht wichtig (wie vorgeschlagen)')
    expect(text).toContain('(4 weitere Entscheide nicht aufgefuehrt)')
  })
})
