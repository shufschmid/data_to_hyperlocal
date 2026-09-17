import {
  hatRevision,
  nachRevision,
  revisionZaehler,
  revisionZaehlerSport,
  revisionZaehlerStatistik
} from './revision'

interface Zeile {
  id: string
  revision_hinweis: string | null
}

const m = (id: string, hinweis: string | null): Zeile => ({
  id,
  revision_hinweis: hinweis
})

describe('hatRevision', () => {
  it('erkennt einen Befund', () => {
    expect(hatRevision(m('a', 'Die Quelle hat ihre Zahlen revidiert.'))).toBe(true)
  })

  it('sagt nein bei null und bei Leerraum', () => {
    expect(hatRevision(m('a', null))).toBe(false)
    expect(hatRevision(m('a', '   '))).toBe(false)
  })
})

describe('nachRevision', () => {
  it('holt die Beitraege mit Befund nach vorn, sonst bleibt die Reihenfolge', () => {
    const zeilen = [m('a', null), m('b', 'Befund'), m('c', null), m('d', 'Befund')]
    expect(nachRevision(zeilen).map((z) => z.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('ruehrt die Vorlage nicht an', () => {
    const zeilen = [m('a', null), m('b', 'Befund')]
    nachRevision(zeilen)
    expect(zeilen.map((z) => z.id)).toEqual(['a', 'b'])
  })
})

describe('revisionZaehler', () => {
  it('zaehlt nur die Beitraege mit Befund', () => {
    expect(revisionZaehler([m('a', null), m('b', 'Befund'), m('c', 'Befund')])).toBe(2)
  })
})

describe('revisionZaehlerSport und revisionZaehlerStatistik', () => {
  // Zwei Waechter schreiben in dasselbe Feld: der Statistik-Waechter auf
  // Beitraege mit `lauf`, der Sport-Waechter auf Spielberichte. Ein Befund
  // gehoert auf den Reiter, an dem die Redaktorin ihn bearbeitet.
  const s = (id: string, hinweis: string | null, spiel: string | null) => ({
    id,
    revision_hinweis: hinweis,
    spiel: spiel === null ? null : { id: spiel }
  })

  it('zaehlt im Sport nur die Spielberichte mit Befund', () => {
    expect(revisionZaehlerSport([s('a', 'Befund', 'sp1'), s('b', null, 'sp2'), s('c', 'Befund', null)])).toBe(
      1
    )
  })

  it('laesst den Sportbefund vom Statistik-Zaehler in Ruhe', () => {
    expect(
      revisionZaehlerStatistik([s('a', 'Befund', 'sp1'), s('b', 'Befund', null), s('c', null, null)])
    ).toBe(1)
  })
})
