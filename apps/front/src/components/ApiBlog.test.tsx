import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiBlog } from './ApiBlog'
import type { ApiArtikel } from '@/lib/apiblog'

function artikel(id: string, ueber: Partial<ApiArtikel> = {}): ApiArtikel {
  return {
    id,
    gemeinde: 'aesch',
    gemeinde_name: 'Aesch',
    bfs_nummer: 2761,
    rubrik: 'presseschau',
    titel: `Titel ${id}`,
    lead: 'Ein Lead.',
    text: 'Ein Absatz.\n\nQuelle: Beitrag von bazonline.ch vom 11. Oktober 2026 — (Artikel nicht online verfügbar)',
    publiziert_am: '2026-10-11T12:00:00.000Z',
    erscheint_am: null,
    perle: false,
    quelle_name: 'bazonline.ch',
    quelle_url: 'https://www.bazonline.ch/x-123',
    sport: null,
    termin: { ideal: '2026-10-18', ende: '2026-10-18', auftritte: ['2026-10-18'] },
    medium: 'bajour',
    pruefsiegel: {
      pruefungen: { zeitbezug: [], zahlen: [], weitere: [] },
      bestanden: true,
      gegenpruefung: 'keine',
      freigabe: 'redaktion',
      freigegeben_am: null,
      publiziert_am: '2026-10-11T12:00:00.000Z',
      herkunft: { rubrik: 'presseschau', quelle_name: 'bazonline.ch', quelle_url: null }
    },
    ...ueber
  }
}

function antwort(status: number, koerper: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => koerper } as unknown as Response
}

/** A stub of the proxy: the API's own envelopes, keyed by path. */
function schnittstelle(seiten: Record<string, unknown>) {
  const aufrufe: string[] = []
  const laden = async (pfad: string): Promise<Response> => {
    aufrufe.push(pfad)
    if (pfad === '/api/v1/gemeinden')
      return antwort(200, {
        gemeinden: [{ gemeinde: 'aesch', name: 'Aesch', bfs_nummer: 2761, bezirk: 'Arlesheim' }]
      })
    if (pfad === '/api/v1/gesundheit')
      return antwort(200, { bereit: true, offen: true, datenbank: true, medium: 'bajour', version: '1.9.0' })
    const treffer = seiten[pfad]
    if (treffer === undefined)
      return antwort(404, { fehler: { code: 'nicht_gefunden', meldung: 'Unbekannt.' } })
    if (typeof treffer === 'object' && treffer !== null && 'status' in treffer)
      return antwort(
        (treffer as { status: number }).status,
        (treffer as { status: number; koerper: unknown }).koerper
      )
    return antwort(200, treffer)
  }
  return { laden, aufrufe }
}

describe('ApiBlog — die Live-Ansicht der Schnittstelle', () => {
  it('zeigt, was /api/v1/artikel liefert: Beitraege, Zaehler, Siegel, Quelle, Termin', async () => {
    const s = schnittstelle({
      '/api/v1/artikel?grenze=2&versatz=0': {
        anzahl: 2,
        gesamt: 3,
        versatz: 0,
        grenze: 2,
        weitere: true,
        artikel: [
          artikel('a'),
          artikel('b', { perle: true, pruefsiegel: { ...artikel('b').pruefsiegel, gegenpruefung: 'ja' } })
        ]
      },
      '/api/v1/artikel?grenze=2&versatz=2': {
        anzahl: 1,
        gesamt: 3,
        versatz: 2,
        grenze: 2,
        weitere: false,
        artikel: [artikel('c')]
      }
    })
    render(<ApiBlog gemeinde={null} laden={s.laden} grenze={2} />)
    expect(await screen.findByText('Titel a')).toBeInTheDocument()
    expect(screen.getByText('2 von 3 Beiträgen.')).toBeInTheDocument()
    expect(screen.getAllByText('Prüfsiegel bestanden')).toHaveLength(2)
    expect(screen.getByText('Perle')).toBeInTheDocument()
    expect(screen.getByText('gegengelesen: ja')).toBeInTheDocument()
    expect(screen.getAllByText(/Quelle: bazonline\.ch · zählt am 18\. Oktober 2026/)).toHaveLength(2)
    expect(screen.getByText(/Schnittstelle offen · bajour · 1\.9\.0/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Weitere laden (1 weitere)' }))
    expect(await screen.findByText('Titel c')).toBeInTheDocument()
    expect(screen.getByText('Alle 3 Beiträge.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Weitere laden/ })).not.toBeInTheDocument()
  })

  it('sagt es in den Worten der Schnittstelle, wenn sie abgeschaltet ist', async () => {
    const s = schnittstelle({
      '/api/v1/artikel?grenze=50&versatz=0': {
        status: 503,
        koerper: {
          fehler: {
            code: 'schnittstelle_abgeschaltet',
            meldung: 'Die Schnittstelle ist abgeschaltet. Sie wird mit BLOG_API_OFFEN=ja eingeschaltet.'
          }
        }
      }
    })
    render(<ApiBlog gemeinde={null} laden={s.laden} />)
    expect(await screen.findByText(/der Dorfkönig bekommt nichts/)).toBeInTheDocument()
    expect(screen.getByText(/BLOG_API_OFFEN=ja/)).toBeInTheDocument()
  })

  it('fragt die Schnittstelle je Gemeinde mit ihrem Slug und meldet die Wahl nach oben', async () => {
    const s = schnittstelle({
      '/api/v1/artikel?grenze=50&versatz=0&gemeinde=aesch': {
        anzahl: 1,
        gesamt: 1,
        versatz: 0,
        grenze: 50,
        weitere: false,
        artikel: [artikel('a')]
      }
    })
    const onGemeinde = jest.fn()
    render(<ApiBlog gemeinde="aesch" laden={s.laden} onGemeinde={onGemeinde} />)
    expect(await screen.findByText('Titel a')).toBeInTheDocument()
    expect(screen.getByText('1 Beitrag auf der Schnittstelle.')).toBeInTheDocument()
    expect(s.aufrufe).toContain('/api/v1/artikel?grenze=50&versatz=0&gemeinde=aesch')
    await userEvent.click(screen.getByRole('combobox', { name: 'Gemeinde' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Alle Gemeinden' }))
    await waitFor(() => expect(onGemeinde).toHaveBeenCalledWith(null))
  })

  it('klappt die Hinweise eines nicht bestandenen Siegels auf', async () => {
    const s = schnittstelle({
      '/api/v1/artikel?grenze=50&versatz=0': {
        anzahl: 1,
        gesamt: 1,
        versatz: 0,
        grenze: 50,
        weitere: false,
        artikel: [
          artikel('a', {
            pruefsiegel: {
              ...artikel('a').pruefsiegel,
              bestanden: false,
              pruefungen: { zeitbezug: ['Relativer Zeitbezug: "gestern"'], zahlen: [], weitere: [] }
            }
          })
        ]
      }
    })
    render(<ApiBlog gemeinde={null} laden={s.laden} />)
    await userEvent.click(await screen.findByText('1 Hinweis im Prüfsiegel'))
    expect(screen.getByText('Relativer Zeitbezug: "gestern"')).toBeInTheDocument()
  })
})
