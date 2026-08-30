import { describe, expect, it } from 'vitest'
import { attributionsKorrektur, fehlendeAttribution } from './attribution'

describe('fehlendeAttribution', () => {
  it('erkennt die Formulierungen, um die der Prompt bittet', () => {
    expect(
      fehlendeAttribution(
        'In Aesch standen 2026 laut dem Statistischen Amt Basel-Landschaft 42 Wohnungen leer.'
      )
    ).toBe(false)
    expect(
      fehlendeAttribution('Wie das Statistische Amt meldet, sind es 42.')
    ).toBe(false)
    expect(
      fehlendeAttribution('Nach Angaben des Statistischen Amts sind es 42.')
    ).toBe(false)
    expect(
      fehlendeAttribution('Das Statistische Amt hat neue Zahlen publiziert.')
    ).toBe(false)
  })

  it('nimmt auch eine Quellenzeile an', () => {
    expect(
      fehlendeAttribution('42 Wohnungen standen leer.\n\nQuelle: data.bl.ch')
    ).toBe(false)
  })

  it('meldet den Text, der seine Herkunft verschweigt', () => {
    expect(
      fehlendeAttribution(
        'In Aesch standen im Jahr 2026 insgesamt 42 Wohnungen leer, zwoelf mehr als ein Jahr zuvor.'
      )
    ).toBe(true)
  })

  // Der Text kommt aus dem Modell und kann zusammengesetzte Umlaute tragen.
  it('liest zusammengesetzte Umlaute wie normale', () => {
    const zerlegt = 'Amt für Statistik'.normalize('NFD')
    expect(fehlendeAttribution(zerlegt)).toBe(false)
  })

  it('nennt im Korrekturhinweis, was fehlt', () => {
    expect(attributionsKorrektur()).toContain('woher die Zahlen stammen')
    expect(attributionsKorrektur()).toContain('Statistische Amt')
  })
})
