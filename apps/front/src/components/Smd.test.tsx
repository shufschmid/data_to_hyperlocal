import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GemeindeFelder, SmdBeitragFelder } from '@/graphql/redaktion'
import { Smd } from './Smd'

function eintrag(ueber: Partial<SmdBeitragFelder> = {}): SmdBeitragFelder {
  return {
    id: 'a',
    art: 'artikel',
    medium: 'bazonline.ch',
    datum: '2026-10-11',
    zeit: null,
    blog: null,
    rubrik: 'Sport',
    titel: "Volleyball: Sm'Aesch Pfeffingen startet mit einem Arbeitssieg in die Saison",
    lead: 'Die verletzungsgeschwächten Baselbieterinnen ringen Aufsteiger Aarau in fünf Sätzen nieder.',
    autor: 'Nils Løvold',
    text: 'Zum Saisonauftakt mussten die Spielerinnen einen Kraftakt bewältigen.',
    text_abgeschnitten: false,
    seite_von: 38,
    seite_bis: 38,
    gemeinden_genannt: ['Aesch'],
    link_url: 'https://www.bazonline.ch/smaesch-pfeffingen-sieg-zum-auftakt-trotz-verletzungen-957013339861',
    link_status: 'gefunden',
    link_abo: false,
    link_titel: 'Sm’Aesch Pfeffingen: Sieg zum Auftakt trotz Verletzungen',
    link_hinweis: 'gefunden über print-titel',
    hinweise: null,
    vorschlag: true,
    vorschlag_begruendung: 'Eigener Matchbericht über den Verein der Gemeinde.',
    entscheid: 'offen',
    ablehnungsgrund: null,
    date_created: '2026-10-11T14:45:00Z',
    gemeinde: { id: 'g1', name: 'Aesch' },
    dossier: { id: 'd1', datum: '2026-10-11' },
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

describe('Smd', () => {
  it('zeigt den Vorschlag mit Medium, Online-Link ohne «(Abo)» und den drei Entscheiden', async () => {
    const onUebernehmen = jest.fn()
    render(
      <Smd
        eintraege={[eintrag()]}
        gemeinden={[gemeinde()]}
        heute="2026-10-12"
        onUebernehmen={onUebernehmen}
      />
    )
    expect(screen.getByText('1 vorgeschlagen')).toBeInTheDocument()
    expect(screen.getByText('Online (frei)')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Artikel auf bazonline\.ch/ })
    expect(link).toHaveAttribute('href', expect.stringContaining('bazonline.ch/smaesch'))
    expect(link.textContent).not.toMatch(/Abo/)
    await userEvent.click(screen.getByRole('button', { name: 'Meldung schreiben' }))
    expect(onUebernehmen).toHaveBeenCalledWith('a')
    expect(screen.getByRole('button', { name: 'Ablehnen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'An Chefredaktion' })).toBeInTheDocument()
  })

  it('sagt ohne Link, dass der Artikel nicht online ist, und laesst ihn von Hand setzen', async () => {
    const onLink = jest.fn()
    render(
      <Smd
        eintraege={[
          eintrag({
            id: 'b',
            art: 'blogeintrag',
            blog: 'Regiosport-Aktuell',
            medium: 'bzbasel.ch',
            zeit: '22:28',
            link_url: null,
            link_status: 'nicht_gefunden',
            link_abo: null,
            link_hinweis: 'kein Eintrag mit diesem Titel in der News-Sitemap'
          })
        ]}
        gemeinden={[gemeinde()]}
        heute="2026-10-12"
        onLink={onLink}
      />
    )
    expect(screen.getByText('Blog «Regiosport-Aktuell»')).toBeInTheDocument()
    expect(screen.getByText('(Artikel nicht online verfügbar)')).toBeInTheDocument()
    expect(screen.getByText(/Eintrag vom 11\. Oktober 2026, 22:28 Uhr/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Link setzen' }))
    await userEvent.type(screen.getByLabelText('Adresse'), 'https://www.bzbasel.ch/x-ld.1')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(onLink).toHaveBeenCalledWith('b', 'https://www.bzbasel.ch/x-ld.1', true)
  })

  it('faltet das Uebrige und zaehlt es', () => {
    render(
      <Smd eintraege={[eintrag({ id: 'u', vorschlag: false })]} gemeinden={[gemeinde()]} heute="2026-10-12" />
    )
    expect(screen.getByText(/Kein Vorschlag/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Übrige 1 anzeigen/ })).toBeInTheDocument()
  })

  // --- Relevanz-Stufen (seit 22.11.2026) ---

  it('zeigt die Stufe und richtet den Vorschlag nach der Schwelle des Tischs, nicht nach dem alten Bit', () => {
    const zeilen = [
      eintrag({ id: 'hoch', titel: 'Streit um den Dorfplatz', vorschlag: true, vorschlag_wert: 3 }),
      eintrag({ id: 'tief', titel: 'Resultate vom Wochenende', vorschlag: false, vorschlag_wert: 2 })
    ]
    const { rerender } = render(
      <Smd eintraege={zeilen} gemeinden={[gemeinde()]} heute="2026-10-12" schwelle={3} />
    )
    expect(screen.getByText('Stufe 3 · klare Meldung')).toBeInTheDocument()
    expect(screen.getByText('1 vorgeschlagen')).toBeInTheDocument()
    // Grosszügig gestellt: die Stufe 2 rückt auf, ohne dass der Lauf lief.
    rerender(<Smd eintraege={zeilen} gemeinden={[gemeinde()]} heute="2026-10-12" schwelle={2} />)
    expect(screen.getByText('2 vorgeschlagen')).toBeInTheDocument()
    // Streng gestellt: auch die Stufe 3 liegt bei den Übrigen.
    rerender(<Smd eintraege={zeilen} gemeinden={[gemeinde()]} heute="2026-10-12" schwelle={4} />)
    expect(screen.getByText(/Kein Vorschlag/)).toBeInTheDocument()
  })
})
