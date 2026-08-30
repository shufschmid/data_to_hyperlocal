import { describe, expect, it } from 'vitest'
import { istBaselbiet, pruefeGemeinde, pruefeVerein } from './stammdaten'

describe('istBaselbiet', () => {
  it('kennt die fuenf Bezirke', () => {
    for (const b of [
      'Arlesheim',
      'Laufen',
      'Liestal',
      'Sissach',
      'Waldenburg'
    ]) {
      expect(istBaselbiet(b)).toBe(true)
    }
  })

  // Der Grund, warum es das gibt: die Statistik-Quellen sind kantonal. Riehen
  // steht seit je in der Liste und bekommt nie eine Statistik-Meldung — das
  // gehoert auf die Karte, nicht ins Warten des Redaktors.
  it('erkennt ausserkantonale Gemeinden', () => {
    expect(istBaselbiet('Basel-Stadt')).toBe(false)
    expect(istBaselbiet('Dorneck (SO)')).toBe(false)
  })
})

describe('pruefeGemeinde', () => {
  const gut = { name: 'Dornach', bfs_nummer: 2473, bezirk: 'Dorneck (SO)' }

  it('nimmt eine ausserkantonale Gemeinde an', () => {
    const p = pruefeGemeinde(gut, ['Aesch', 'Riehen'])
    expect(p.ok && p.wert).toEqual(gut)
  })

  it('trimmt und verlangt die Pflichtfelder', () => {
    expect(pruefeGemeinde({ ...gut, name: '  ' }, []).ok).toBe(false)
    expect(pruefeGemeinde({ ...gut, bezirk: '' }, []).ok).toBe(false)
    const p = pruefeGemeinde({ ...gut, name: '  Dornach  ' }, [])
    expect(p.ok && p.wert.name).toBe('Dornach')
  })

  it('besteht auf einer brauchbaren BFS-Nummer', () => {
    for (const bfs of [
      0,
      -1,
      12345,
      24.5,
      undefined,
      '2473' as unknown as number
    ]) {
      expect(pruefeGemeinde({ ...gut, bfs_nummer: bfs as number }, []).ok).toBe(
        false
      )
    }
  })

  // `name` ist in der Datenbank NICHT unique, aber gemeindeSlug macht daraus die
  // Blog-Adresse — zwei „Oberwil" teilten sich still einen Blog.
  it('weist einen schon vergebenen Namen ab', () => {
    const p = pruefeGemeinde({ ...gut, name: 'oberwil' }, ['Oberwil'])
    expect(p.ok).toBe(false)
    expect(!p.ok && p.grund).toMatch(/Adresse/)
  })
})

describe('pruefeVerein', () => {
  const gut = {
    name: 'FC Dornach',
    sportart: 'Fussball',
    bedeutung: 'breitensport'
  }

  it('setzt sinnvolle Vorgaben', () => {
    const p = pruefeVerein(gut)
    expect(p.ok && p.wert).toMatchObject({
      quelle: 'manuell',
      bedeutung: 'breitensport',
      aktiv: true,
      ergebnis_url: null,
      liga: null
    })
  })

  it('verlangt Name und eine bekannte Sportart', () => {
    expect(pruefeVerein({ ...gut, name: '' }).ok).toBe(false)
    expect(pruefeVerein({ ...gut, sportart: 'Quidditch' }).ok).toBe(false)
    expect(pruefeVerein({ ...gut, quelle: 'erfunden' }).ok).toBe(false)
  })

  // Der Fall, der sonst still scheitert: Volleyball und Handball werden pro
  // Mannschaft von genau dieser Adresse gelesen. Ohne sie ueberspringt der
  // Lauf den Verein mit einer Logzeile, die niemand liest.
  it('verlangt die Ergebnis-Adresse, wo pro Mannschaft abgefragt wird', () => {
    for (const quelle of ['swissvolley', 'handball']) {
      const p = pruefeVerein({ ...gut, sportart: 'Volleyball', quelle })
      expect(p.ok).toBe(false)
      expect(!p.ok && p.grund).toMatch(/pro Mannschaft/)
    }
  })

  it('laesst sie weg, wo eine Seite alle Vereine traegt', () => {
    expect(pruefeVerein({ ...gut, quelle: 'fvnws' }).ok).toBe(true)
    expect(pruefeVerein({ ...gut, quelle: 'manuell' }).ok).toBe(true)
  })

  it('prueft die Adresse, wenn eine da ist', () => {
    expect(pruefeVerein({ ...gut, ergebnis_url: 'kein-link' }).ok).toBe(false)
    const p = pruefeVerein({ ...gut, ergebnis_url: 'https://example.ch/team' })
    expect(p.ok && p.wert.ergebnis_url).toBe('https://example.ch/team')
  })
})
