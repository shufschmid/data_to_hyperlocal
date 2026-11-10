import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BuschtelefonFundFelder, GemeindeFelder } from '@/graphql/redaktion'
import { Buschtelefon } from './Buschtelefon'

function fund(ueber: Partial<BuschtelefonFundFelder> = {}): BuschtelefonFundFelder {
  return {
    id: 'f1',
    kennung: 'fb:1',
    kanal: 'facebook',
    gemeinde_slug: 'aesch',
    kanton: 'BL',
    quelle_name: 'Du bisch vo Aesch',
    quelle_art: 'gruppe',
    link: 'https://example.org/post/1',
    veroeffentlicht_am: '2026-11-09T10:00:00Z',
    datum_genauigkeit: 'exakt',
    erfasst_am: '2026-11-09T12:00:00Z',
    titel: 'Sperrung Hauptstrasse',
    text: 'Seit heute Morgen ist die Hauptstrasse gesperrt.',
    zusammenfassung: null,
    artikel_text: null,
    kommentare: [{ text: 'Stimmt, ich stehe im Stau.', autor_art: 'privat' }],
    n_kommentare: 1,
    n_reaktionen: 12,
    n_geteilt: null,
    doublette_von: null,
    entscheid: 'offen',
    ablehnungsgrund: null,
    gemeinde: { id: 'g1', name: 'Aesch' },
    ...ueber
  }
}

function gemeinde(): GemeindeFelder {
  return {
    id: 'g1',
    name: 'Aesch',
    bezirk: 'Arlesheim',
    bfs_nummer: 2761,
    plz: ['4147'],
    aktiv: true,
    news_url: null,
    news_letzte_pruefung: null,
    news_letzter_fehler: null,
    news_letzter_hinweis: null,
    suedanflug: false
  }
}

describe('Buschtelefon', () => {
  it('zeigt Text, Gemeinde, Kanal, Link, Kommentar und Zahlen und nimmt den Fund auf Klick', async () => {
    const onUebernehmen = jest.fn()
    render(<Buschtelefon funde={[fund()]} gemeinden={[gemeinde()]} onUebernehmen={onUebernehmen} />)
    expect(screen.getByText('Sperrung Hauptstrasse')).toBeInTheDocument()
    expect(screen.getByText('Aesch')).toBeInTheDocument()
    expect(screen.getByText('Facebook')).toBeInTheDocument()
    expect(screen.getByText('nicht bestätigt')).toBeInTheDocument()
    expect(screen.getByText('Stimmt, ich stehe im Stau.')).toBeInTheDocument()
    expect(screen.getByText(/1 Kommentar · 12 Reaktionen/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Original ansehen/ })).toHaveAttribute(
      'href',
      'https://example.org/post/1'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Meldung schreiben' }))
    expect(onUebernehmen).toHaveBeenCalledWith('f1')
  })

  it('markiert Doubletten und lehnt mit Grund ab', async () => {
    const onAblehnen = jest.fn()
    render(
      <Buschtelefon
        funde={[fund({ id: 'f2', kennung: 'ig:2', doublette_von: 'fb:1' })]}
        gemeinden={[gemeinde()]}
        onAblehnen={onAblehnen}
      />
    )
    expect(screen.getByText('Doublette')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Ablehnen' }).at(-1)!)
    expect(onAblehnen).toHaveBeenCalledWith('f2', 'doublette', null)
  })

  it('bietet ohne Gemeinde keine Meldung an und sagt, was fehlt, wenn nicht eingerichtet', () => {
    render(
      <Buschtelefon
        funde={[fund({ gemeinde: null })]}
        gemeinden={[gemeinde()]}
        onGemeinde={jest.fn()}
        lauf={{
          laeuft: false,
          gestartet_um: null,
          beendet_um: null,
          ergebnis: null,
          fehler: null,
          eingerichtet: false,
          fehlend: ['BUSCHTELEFON_SCHLUESSEL']
        }}
      />
    )
    expect(screen.queryByRole('button', { name: 'Meldung schreiben' })).not.toBeInTheDocument()
    expect(screen.getByText('Gemeinde fehlt')).toBeInTheDocument()
    expect(screen.getByText(/es fehlt: BUSCHTELEFON_SCHLUESSEL/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jetzt abholen' })).toBeDisabled()
  })
})
