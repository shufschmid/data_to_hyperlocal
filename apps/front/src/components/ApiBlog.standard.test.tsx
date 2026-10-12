import { render, screen } from '@testing-library/react'
import { ApiBlog } from './ApiBlog'
import { sitzungsFetch } from '@/lib/marke.client'

// The default path, the one the workspace takes: no injected loader, the
// component reads through `sitzungsFetch`. Measured in production on 12
// October 2026: a default loader created per render re-armed the loading
// effect on every render, and the blog flickered without ever showing a
// line. The injected stub of the other tests never saw it.
jest.mock('@/lib/marke.client', () => ({ sitzungsFetch: jest.fn() }))

const antwort = (koerper: unknown): Response =>
  ({ ok: true, status: 200, json: async () => koerper }) as unknown as Response

const ARTIKEL = {
  id: 'a',
  gemeinde: 'aesch',
  gemeinde_name: 'Aesch',
  bfs_nummer: 2761,
  rubrik: 'presseschau',
  titel: 'Titel a',
  lead: null,
  text: 'Text.',
  publiziert_am: '2026-10-11T12:00:00.000Z',
  erscheint_am: null,
  perle: false,
  quelle_name: 'bazonline.ch',
  quelle_url: null,
  sport: null,
  termin: null,
  medium: 'bajour',
  pruefsiegel: {
    pruefungen: { zeitbezug: [], zahlen: [], weitere: [] },
    bestanden: true,
    gegenpruefung: 'keine',
    freigabe: 'redaktion',
    freigegeben_am: null,
    publiziert_am: '2026-10-11T12:00:00.000Z',
    herkunft: { rubrik: 'presseschau', quelle_name: 'bazonline.ch', quelle_url: null }
  }
}

const ruhe = () => new Promise((r) => setTimeout(r, 60))

describe('ApiBlog auf dem Standardweg', () => {
  it('liest jede Adresse genau einmal und laeuft nicht in eine Schleife', async () => {
    const mock = sitzungsFetch as jest.MockedFunction<typeof sitzungsFetch>
    mock.mockImplementation(async (eingabe) => {
      const pfad = String(eingabe)
      if (pfad === '/api/v1/gemeinden') return antwort({ gemeinden: [] })
      if (pfad === '/api/v1/gesundheit')
        return antwort({ bereit: true, offen: true, datenbank: true, medium: 'bajour', version: '1.9.0' })
      return antwort({ anzahl: 1, gesamt: 1, versatz: 0, grenze: 50, weitere: false, artikel: [ARTIKEL] })
    })

    const { rerender } = render(<ApiBlog gemeinde={null} />)
    expect(await screen.findByText('Titel a')).toBeInTheDocument()
    await ruhe()
    rerender(<ApiBlog gemeinde={null} />)
    await ruhe()

    expect(mock).toHaveBeenCalledTimes(3)
    expect(mock.mock.calls.map((c) => String(c[0])).sort()).toEqual([
      '/api/v1/artikel?grenze=50&versatz=0',
      '/api/v1/gemeinden',
      '/api/v1/gesundheit'
    ])
    expect(screen.getByText('Titel a')).toBeInTheDocument()
  })
})
