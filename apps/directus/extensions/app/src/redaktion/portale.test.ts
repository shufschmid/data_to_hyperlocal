import { describe, expect, it } from 'vitest'
import { bedientBezirk, lesePortalKonfiguration } from './portale'

describe('lesePortalKonfiguration', () => {
  it('liest Amt und Bezirke aus der Konfiguration', () => {
    expect(
      lesePortalKonfiguration({
        amt: 'Statistisches Amt des Kantons Basel-Stadt',
        bezirke: ['Basel-Stadt']
      })
    ).toEqual({
      amt: 'Statistisches Amt des Kantons Basel-Stadt',
      bezirke: ['Basel-Stadt']
    })
  })

  it('antwortet leer, wenn nichts eingestellt ist', () => {
    expect(lesePortalKonfiguration(null)).toEqual({ amt: null, bezirke: [] })
    expect(lesePortalKonfiguration('kaputt')).toEqual({
      amt: null,
      bezirke: []
    })
    expect(lesePortalKonfiguration([])).toEqual({ amt: null, bezirke: [] })
  })

  it('wirft einen leeren Amtsnamen weg, statt ihn in einen Artikel zu lassen', () => {
    expect(lesePortalKonfiguration({ amt: '   ' }).amt).toBeNull()
    expect(lesePortalKonfiguration({ amt: 42 }).amt).toBeNull()
  })

  it('nimmt aus den Bezirken nur, was ein Bezirksname sein kann', () => {
    expect(
      lesePortalKonfiguration({
        bezirke: ['  Arlesheim  ', '', 7, null, 'Liestal']
      }).bezirke
    ).toEqual(['Arlesheim', 'Liestal'])
  })

  it('nimmt keine Bezirksliste an, die keine Liste ist', () => {
    expect(lesePortalKonfiguration({ bezirke: 'Arlesheim' }).bezirke).toEqual(
      []
    )
  })
})

describe('bedientBezirk', () => {
  const bl = lesePortalKonfiguration({ bezirke: ['Arlesheim', 'Liestal'] })

  it('trifft ungeachtet von Gross- und Kleinschreibung und Leerraum', () => {
    expect(bedientBezirk(bl, 'Arlesheim')).toBe(true)
    expect(bedientBezirk(bl, ' arlesheim ')).toBe(true)
  })

  it('sagt Nein, wo das Portal nichts erklaert hat', () => {
    expect(bedientBezirk(bl, 'Basel-Stadt')).toBe(false)
    // Ein Portal ohne Angabe deckt nichts ab: Schweigen ist keine Zusage.
    expect(bedientBezirk(lesePortalKonfiguration(null), 'Arlesheim')).toBe(
      false
    )
  })
})
