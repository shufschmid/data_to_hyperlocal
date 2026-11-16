import { anzahlChefredaktion, istArchiv, tagVor, teileNachAlter } from './archiv'

const HEUTE = new Date('2026-11-16T10:00:00Z')

describe('das Vierzehn-Tage-Fenster', () => {
  it('nennt Archiv, was älter als vierzehn Tage ist — und nie eine Zeile ohne Datum', () => {
    expect(istArchiv('2026-11-10T08:00:00Z', HEUTE)).toBe(false)
    expect(istArchiv('2026-11-02T10:00:01Z', HEUTE)).toBe(false)
    expect(istArchiv('2026-11-02T09:59:59Z', HEUTE)).toBe(true)
    expect(istArchiv('2026-08-31T08:00:00Z', HEUTE)).toBe(true)
    expect(istArchiv(null, HEUTE)).toBe(false)
    expect(istArchiv(undefined, HEUTE)).toBe(false)
    expect(istArchiv('kein Datum', HEUTE)).toBe(false)
  })

  it('teilt in Tisch und Archiv und behält die Reihenfolge', () => {
    const zeilen = [
      { id: 'neu', date_created: '2026-11-15T08:00:00Z' },
      { id: 'alt', date_created: '2026-09-01T08:00:00Z' },
      { id: 'ohne', date_created: null },
      { id: 'aelter', date_created: '2026-08-31T08:00:00Z' }
    ]
    const { aktuell, archiv } = teileNachAlter(zeilen, HEUTE)
    expect(aktuell.map((z) => z.id)).toEqual(['neu', 'ohne'])
    expect(archiv.map((z) => z.id)).toEqual(['alt', 'aelter'])
  })

  it('rechnet die untere Grenze als Kalendertag', () => {
    expect(tagVor(new Date(2026, 10, 16, 9, 0), 14)).toBe('2026-11-02')
    expect(tagVor(new Date(2026, 0, 5, 9, 0), 14)).toBe('2025-12-22')
  })
})

describe('anzahlChefredaktion', () => {
  it('zählt nur Offenes der letzten vierzehn Tage', () => {
    const hinweise = [
      { status: 'offen', date_created: '2026-11-15T08:00:00Z' },
      { status: 'offen', date_created: '2026-09-01T08:00:00Z' },
      { status: 'kein_hinweis', date_created: '2026-11-15T08:00:00Z' },
      { status: 'offen', date_created: null }
    ]
    const perlen = [{ date_created: '2026-11-12T08:00:00Z' }, { date_created: '2026-10-01T08:00:00Z' }]
    expect(anzahlChefredaktion(hinweise, perlen, HEUTE)).toBe(3)
    expect(anzahlChefredaktion([], [], HEUTE)).toBe(0)
  })
})
