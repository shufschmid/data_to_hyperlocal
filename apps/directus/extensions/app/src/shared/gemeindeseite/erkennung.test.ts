import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  detailFamilie,
  erkenneDetailFamilie,
  erkennePlattform,
  listenArt
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

  // Measured on 18.09.2026 over the ten registered municipalities: no events
  // page carries the template of its own news page. The four Weblication sites
  // answer with the same Generator tag but a different list, and the i-web and
  // Backslash sites are not recognised at all by the news fingerprints — which
  // is why the events templates are values of their own and get checked first.
  it('erkennt die drei Veranstaltungs-Vorlagen vor den Nachrichten-Vorlagen', () => {
    expect(erkennePlattform(lies('allschwil-veranstaltungen.html'))).toBe(
      'weblication_termine'
    )
    expect(erkennePlattform(lies('reinach-veranstaltungen.html'))).toBe(
      'weblication_termine'
    )
    expect(erkennePlattform(lies('bottmingen-veranstaltungen.html'))).toBe(
      'weblication_termine'
    )
    expect(erkennePlattform(lies('arlesheim-veranstaltungen.html'))).toBe(
      'weblication_termine'
    )
    expect(erkennePlattform(lies('aesch-veranstaltungen.html'))).toBe(
      'iweb_termine'
    )
    expect(erkennePlattform(lies('binningen-veranstaltungen.html'))).toBe(
      'backslash_termine'
    )
  })

  it('haelt Nachrichten- und Termin-Vorlagen auseinander', () => {
    expect(listenArt('weblication')).toBe('nachricht')
    expect(listenArt('iweb_tabelle')).toBe('nachricht')
    expect(listenArt('iweb_karten')).toBe('nachricht')
    expect(listenArt('backslash')).toBe('nachricht')
    expect(listenArt('weblication_termine')).toBe('termin')
    expect(listenArt('iweb_termine')).toBe('termin')
    expect(listenArt('backslash_termine')).toBe('termin')
  })

  it('gibt einer Termin-Vorlage die Detail-Familie ihres Hauses', () => {
    expect(detailFamilie('weblication_termine')).toBe('weblication')
    expect(detailFamilie('iweb_termine')).toBe('iweb')
    expect(detailFamilie('backslash_termine')).toBe('backslash')
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
