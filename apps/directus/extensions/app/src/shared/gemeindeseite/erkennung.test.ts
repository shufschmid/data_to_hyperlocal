import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  detailFamilie,
  erkenneDetailFamilie,
  erkennePlattform
} from './erkennung'

const lies = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')

describe('erkennePlattform', () => {
  it('ordnet jede der sieben Uebersichten ihrer Familie zu', () => {
    expect(erkennePlattform(lies('riehen-uebersicht.html'))).toBe('weblication')
    expect(erkennePlattform(lies('bottmingen-uebersicht.html'))).toBe(
      'weblication'
    )
    expect(erkennePlattform(lies('reinach-uebersicht.html'))).toBe(
      'weblication'
    )
    expect(erkennePlattform(lies('allschwil-uebersicht.html'))).toBe(
      'weblication'
    )
    expect(erkennePlattform(lies('aesch-uebersicht.html'))).toBe('iweb_tabelle')
    expect(erkennePlattform(lies('pratteln-uebersicht.html'))).toBe(
      'iweb_karten'
    )
    expect(erkennePlattform(lies('binningen-uebersicht.html'))).toBe(
      'backslash'
    )
  })

  it('erkennt eine Weblication-Detailseite ohne Liste ebenfalls, alles Fremde nicht', () => {
    expect(erkennePlattform(lies('riehen-detail.html'))).toBe('weblication')
    expect(
      erkennePlattform('<html><body><ul><li>x</li></ul></body></html>')
    ).toBeNull()
    expect(erkennePlattform('<table id="informationList"></table>')).toBeNull()
  })

  it('kennt die Detail-Familie jeder Plattform', () => {
    expect(detailFamilie('iweb_tabelle')).toBe('iweb')
    expect(detailFamilie('iweb_karten')).toBe('iweb')
    expect(detailFamilie('weblication')).toBe('weblication')
    expect(detailFamilie('backslash')).toBe('backslash')
  })

  it('erkennt die Familie auch an einer Detailseite allein', () => {
    expect(erkenneDetailFamilie(lies('aesch-detail.html'))).toBe('iweb')
    expect(erkenneDetailFamilie(lies('binningen-detail.html'))).toBe(
      'backslash'
    )
    expect(erkenneDetailFamilie(lies('bottmingen-detail.html'))).toBe(
      'weblication'
    )
    expect(erkenneDetailFamilie('<html></html>')).toBeNull()
  })
})
