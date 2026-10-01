import { describe, expect, it } from 'vitest'
import { MODELLE, pruefeEinstellung, pruefePreis } from './modelleinstellungen'

describe('pruefeEinstellung', () => {
  it('nimmt Zweck, Modell und Etat — leer heisst zurueck zum Code', () => {
    expect(
      pruefeEinstellung({
        zweck: 'amtsblatt:sichtung',
        modell: 'claude-haiku-4-5-20251001',
        max_tokens: '3000',
        notiz: ' Versuch '
      })
    ).toEqual({
      ok: true,
      einstellung: {
        zweck: 'amtsblatt:sichtung',
        modell: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        notiz: 'Versuch'
      }
    })
    expect(
      pruefeEinstellung({ zweck: 'kanton', modell: '', max_tokens: null })
    ).toEqual({
      ok: true,
      einstellung: {
        zweck: 'kanton',
        modell: null,
        max_tokens: null,
        notiz: null
      }
    })
  })

  it('weist ab, was einen Aufruf morgen frueh scheitern liesse', () => {
    expect(pruefeEinstellung({ zweck: 'Kanton Sichtung' }).ok).toBe(false)
    expect(
      pruefeEinstellung({ zweck: 'kanton:sichtung', modell: 'gpt-5' }).ok
    ).toBe(false)
    expect(
      pruefeEinstellung({ zweck: 'kanton:sichtung', max_tokens: 100 }).ok
    ).toBe(false)
    expect(
      pruefeEinstellung({ zweck: 'kanton:sichtung', max_tokens: 1.5 }).ok
    ).toBe(false)
    expect(
      pruefeEinstellung({ zweck: 'kanton:sichtung', max_tokens: 200000 }).ok
    ).toBe(false)
  })

  it('die Auswahl nennt nur geprüfte Modelle', () => {
    expect(MODELLE.map((m) => m.id)).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-sonnet-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-opus-5'
    ])
  })
})

describe('pruefePreis', () => {
  it('nimmt vier Preise und eine Waehrung', () => {
    expect(
      pruefePreis({
        modell: 'claude-sonnet-5',
        eingabe_je_mio: '2',
        ausgabe_je_mio: 10,
        cache_lesen_je_mio: 0.2,
        cache_schreiben_je_mio: 2.5,
        waehrung: 'CHF'
      })
    ).toEqual({
      ok: true,
      preis: {
        modell: 'claude-sonnet-5',
        eingabe_je_mio: 2,
        ausgabe_je_mio: 10,
        cache_lesen_je_mio: 0.2,
        cache_schreiben_je_mio: 2.5,
        waehrung: 'CHF'
      }
    })
    expect(
      pruefePreis({
        modell: 'claude-sonnet-5',
        eingabe_je_mio: -1,
        ausgabe_je_mio: 1,
        cache_lesen_je_mio: 1,
        cache_schreiben_je_mio: 1
      }).ok
    ).toBe(false)
    expect(
      pruefePreis({
        modell: 'x',
        eingabe_je_mio: 1,
        ausgabe_je_mio: 1,
        cache_lesen_je_mio: 1,
        cache_schreiben_je_mio: 1
      }).ok
    ).toBe(false)
    expect(
      pruefePreis({
        modell: 'claude-opus-5',
        eingabe_je_mio: 5,
        ausgabe_je_mio: 25,
        cache_lesen_je_mio: 0.5,
        cache_schreiben_je_mio: 6.25,
        waehrung: 'dollar'
      })
    ).toMatchObject({ ok: true, preis: { waehrung: 'USD' } })
  })
})
