import { automatikBilanz, automatikText, geltungText, gruppiereRegeln } from './gelerntes'
import type { WissenFelder } from '@/graphql/redaktion'

function regel(ueber: Partial<WissenFelder>): WissenFelder {
  return {
    id: 'r-1',
    regel: 'Eine Regel.',
    geltungsbereich: 'global',
    herkunft: 'chat',
    aktiv: true,
    bereich: 'presseschau',
    stufe: 'sichtung',
    wirkung: 'hinweis',
    beleg: null,
    date_created: '2026-09-01T00:00:00Z',
    datensatz: null,
    ...ueber
  }
}

describe('gruppiereRegeln', () => {
  it('gruppiert nach Tisch in Reiter-Reihenfolge, neueste zuerst, Inaktive getrennt', () => {
    const gruppen = gruppiereRegeln([
      regel({ id: 'a', bereich: 'amtsblatt', date_created: '2026-09-01T00:00:00Z' }),
      regel({ id: 'b', bereich: 'statistik', stufe: 'text', aktiv: false }),
      regel({ id: 'c', bereich: 'amtsblatt', date_created: '2026-09-05T00:00:00Z' })
    ])

    expect(gruppen.map((g) => g.text)).toEqual(['Statistik', 'Amtsblatt'])
    expect(gruppen[1]?.aktive.map((r) => r.id)).toEqual(['c', 'a'])
    expect(gruppen[0]?.aktive).toHaveLength(0)
    expect(gruppen[0]?.inaktive.map((r) => r.id)).toEqual(['b'])
  })

  it('laesst leere Tische weg', () => {
    expect(gruppiereRegeln([])).toEqual([])
  })
})

describe('geltungText', () => {
  it('nennt den Datensatz oder die Quelle, sonst nichts', () => {
    expect(
      geltungText(regel({ geltungsbereich: 'datensatz', datensatz: { id: 'd', titel: 'Abfall' } }))
    ).toBe('Abfall')
    expect(geltungText(regel({ geltungsbereich: 'quelle' }))).toBe('ganze Quelle')
    expect(geltungText(regel({}))).toBeNull()
  })
})

describe('automatikBilanz', () => {
  const hinweise = [
    { regel: { id: 'r-1', regel: 'x' }, status: 'offen' },
    { regel: { id: 'r-1', regel: 'x' }, status: 'brauchbar' },
    { regel: { id: 'r-1', regel: 'x' }, status: 'kein_hinweis' },
    { regel: { id: 'r-1', regel: 'x' }, status: 'zurueckgegeben' },
    { regel: { id: 'r-2', regel: 'y' }, status: 'offen' },
    { regel: null, status: 'offen' }
  ]

  it('zaehlt nur die Faehrten dieser Regel, Zurueckgegebenes als abgelegt', () => {
    expect(automatikBilanz(hinweise, 'r-1')).toEqual({ offen: 1, brauchbar: 1, abgelegt: 2 })
  })

  it('schweigt ohne automatische Faehrten', () => {
    expect(automatikText(automatikBilanz(hinweise, 'r-9'))).toBeNull()
    expect(automatikText({ offen: 1, brauchbar: 0, abgelegt: 0 })).toBe(
      '1 Fährte automatisch weitergereicht · 0 brauchbar · 0 abgelegt · 1 offen'
    )
  })
})
