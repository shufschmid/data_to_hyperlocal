import { describe, expect, it } from 'vitest'
import {
  pakete,
  SICHTUNG_AUFRUF,
  SICHTUNG_JE_AUFRUF,
  sichtungsFehlerText
} from './sichtungspakete'

// Riehen brachte 112 ungestufte Zeilen in EINEN Aufruf, und die Antwort brach
// bei 8000 Tokens ab — jeden Tag aufs Neue, weil nichts benotet wurde. Pakete
// begrenzen, was ein Aufruf verlieren kann.
describe('pakete', () => {
  it('teilt in Pakete von hoechstens 25, in Reihenfolge, nichts geht verloren', () => {
    const zeilen = Array.from({ length: 112 }, (_, i) => i + 1)
    const p = pakete(zeilen)
    expect(p).toHaveLength(5)
    expect(p.map((x) => x.length)).toEqual([25, 25, 25, 25, 12])
    expect(p.flat()).toEqual(zeilen)
    expect(SICHTUNG_JE_AUFRUF).toBe(25)
  })

  it('kleine Listen sind ein Paket, leere keines', () => {
    expect(pakete([1, 2, 3])).toEqual([[1, 2, 3]])
    expect(pakete([])).toEqual([])
    expect(pakete([1, 2, 3], 0)).toEqual([[1], [2], [3]])
  })

  it('die Sichtung denkt nicht — der Etat ist die Antwort', () => {
    expect(SICHTUNG_AUFRUF.thinking).toBe('disabled')
    expect(SICHTUNG_AUFRUF.maxTokens).toBeLessThan(8000)
  })

  it('nennt gescheiterte Pakete mit dem ersten Grund', () => {
    expect(sichtungsFehlerText([], 3)).toBeNull()
    expect(sichtungsFehlerText(['zu lang'], 1)).toBe('zu lang')
    expect(sichtungsFehlerText(['zu lang', 'x'], 5)).toBe(
      '2 von 5 Paketen — zu lang'
    )
  })
})
