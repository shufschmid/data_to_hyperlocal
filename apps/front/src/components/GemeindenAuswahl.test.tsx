import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  EntsorgungskalenderFelder,
  GemeindeFelder,
  VereinFelder,
  WochenblattFelder
} from '@/graphql/redaktion'
import { GemeindenAuswahl } from './GemeindenAuswahl'

function gemeinde(ueber: Partial<GemeindeFelder>): GemeindeFelder {
  return { id: 'g', name: 'Ort', bezirk: 'Liestal', bfs_nummer: 1, plz: null, aktiv: true, ...ueber }
}

function verein(ueber: Partial<VereinFelder>): VereinFelder {
  return {
    id: 'v',
    name: 'FC Ort',
    sportart: 'Fussball',
    bedeutung: 'breitensport',
    liga: null,
    spielort: null,
    quelle: 'manuell',
    ergebnis_url: null,
    notiz: null,
    zuordnung_geprueft: true,
    aktiv: true,
    gemeinde: { id: 'g' },
    ...ueber
  }
}

function blatt(ueber: Partial<WochenblattFelder>): WochenblattFelder {
  return {
    id: 'w1',
    name: 'Muttenzer & Prattler Anzeiger',
    archiv_url: 'https://example.ch/',
    aktiv: true,
    letzte_pruefung: null,
    letzter_fehler: null,
    gemeinde: { id: 'a', name: 'Aesch' },
    abdeckungen: [{ id: 'ab1', gemeinde: { id: 'a', name: 'Aesch' } }],
    ausgaben: [],
    ...ueber
  }
}

function kalender(ueber: Partial<EntsorgungskalenderFelder>): EntsorgungskalenderFelder {
  return {
    id: 'k1',
    jahr: 2026,
    status: 'geprueft',
    merkblatt: null,
    gemeinde: { id: 'a', name: 'Aesch' },
    dokumente: [],
    ...ueber
  }
}

const drei = [
  gemeinde({ id: 'a', name: 'Aesch', bezirk: 'Arlesheim', bfs_nummer: 2761, aktiv: true }),
  gemeinde({ id: 'b', name: 'Therwil', bezirk: 'Arlesheim', bfs_nummer: 2775, aktiv: false }),
  gemeinde({ id: 'c', name: 'Riehen', bezirk: 'Basel-Stadt', bfs_nummer: 2703, aktiv: true })
]

describe('GemeindenAuswahl', () => {
  // Der Reiter zeigt das Redaktionsgebiet, nicht das Verzeichnis. Alle 87
  // Zeilen mit Schaltern waren als Arbeitsflaeche unbrauchbar.
  it('zeigt nur die bespielten Gemeinden', () => {
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} />)

    expect(screen.getByRole('heading', { name: 'Aesch' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Riehen' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Therwil' })).not.toBeInTheDocument()
  })

  it('warnt, wenn das Gebiet leer ist', () => {
    render(
      <GemeindenAuswahl gemeinden={drei.map((g) => ({ ...g, aktiv: false }))} onUmschalten={jest.fn()} />
    )

    expect(screen.getByText(/keine Meldung erzeugen/i)).toBeInTheDocument()
  })

  it('nimmt eine Gemeinde auf Knopfdruck aus dem Gebiet', async () => {
    const onUmschalten = jest.fn().mockResolvedValue(undefined)
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={onUmschalten} />)

    await userEvent.click(screen.getAllByRole('button', { name: 'Aus dem Redaktionsgebiet nehmen' })[0]!)

    expect(onUmschalten).toHaveBeenCalledWith('a', false)
  })

  it('filtert ueber die Suche, auch ohne Umlaut', async () => {
    render(
      <GemeindenAuswahl
        gemeinden={[...drei, gemeinde({ id: 'd', name: 'Münchenstein', bfs_nummer: 2769 })]}
        onUmschalten={jest.fn()}
      />
    )

    await userEvent.type(screen.getByLabelText('Suche'), 'munchenstein')

    expect(screen.getByRole('heading', { name: 'Münchenstein' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Aesch' })).not.toBeInTheDocument()
  })

  // Die Statistik-Quellen sind kantonal. Riehen bekommt seit je keine
  // Statistik-Meldung — das gehoert auf die Karte, nicht ins Warten.
  it('sagt bei ausserkantonalen Gemeinden, dass die Statistik still bleibt', () => {
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} />)

    expect(screen.getByText(/Ausserhalb Basel-Landschaft/)).toBeInTheDocument()
    expect(screen.getAllByText(/Läuft automatisch über data\.bl\.ch/)).toHaveLength(1)
  })

  it('zeigt die Vereine, Aushaengeschild zuerst', () => {
    render(
      <GemeindenAuswahl
        gemeinden={drei}
        vereine={[
          verein({ id: 'v1', name: 'FC Aesch', gemeinde: { id: 'a' } }),
          verein({
            id: 'v2',
            name: "Sm'Aesch Pfeffingen",
            sportart: 'Volleyball',
            bedeutung: 'aushaengeschild',
            liga: 'Nationalliga A',
            gemeinde: { id: 'a' }
          })
        ]}
        onUmschalten={jest.fn()}
      />
    )

    const namen = screen.getAllByText(/FC Aesch|Sm'Aesch Pfeffingen/).map((n) => n.textContent)
    expect(namen.at(0)).toContain("Sm'Aesch Pfeffingen")
    expect(screen.getByText(/Nationalliga A/)).toBeInTheDocument()
  })

  it('kennzeichnet einen unbestaetigten Verein als Vorschlag', () => {
    render(
      <GemeindenAuswahl
        gemeinden={drei}
        vereine={[verein({ id: 'v4', zuordnung_geprueft: false, gemeinde: { id: 'c' } })]}
        onUmschalten={jest.fn()}
      />
    )

    expect(screen.getByText('vorgeschlagen')).toBeInTheDocument()
  })

  it('oeffnet den Verein-Dialog und reicht die Eingabe weiter', async () => {
    const onVerein = jest.fn().mockResolvedValue(undefined)
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} onVerein={onVerein} />)

    await userEvent.click(screen.getAllByRole('button', { name: 'Verein erfassen' })[0]!)
    await userEvent.type(screen.getByLabelText('Name'), 'FC Neu')
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }))

    expect(onVerein).toHaveBeenCalledWith('a', expect.objectContaining({ name: 'FC Neu' }), null)
  })

  it('zeigt das abdeckende Blatt und markiert die Hauptgemeinde', () => {
    render(<GemeindenAuswahl gemeinden={drei} blaetter={[blatt({})]} onUmschalten={jest.fn()} />)

    expect(screen.getByText('Muttenzer & Prattler Anzeiger')).toBeInTheDocument()
    expect(screen.getByText('Hauptgemeinde')).toBeInTheDocument()
  })

  it('zeigt den Abfuhrkalender des Jahres, sonst dessen Fehlen', () => {
    render(
      <GemeindenAuswahl gemeinden={drei} kalender={[kalender({})]} jahr={2026} onUmschalten={jest.fn()} />
    )

    expect(screen.getByText(/Abfuhrkalender 2026: Geprüft/)).toBeInTheDocument()
    expect(screen.getByText(/Kein Abfuhrkalender 2026 erfasst/)).toBeInTheDocument()
  })

  it('holt eine bekannte Gemeinde ueber den Hinzufuegen-Dialog ins Gebiet', async () => {
    const onUmschalten = jest.fn().mockResolvedValue(undefined)
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={onUmschalten} />)

    await userEvent.click(screen.getByRole('button', { name: 'Gemeinde hinzufügen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    expect(onUmschalten).toHaveBeenCalledWith('b', true)
  })

  // Der Dornach-Fall: nicht im Verzeichnis, also von Hand erfasst.
  it('erfasst eine ausserkantonale Gemeinde neu', async () => {
    const onGemeindeErfassen = jest.fn().mockResolvedValue(undefined)
    render(
      <GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} onGemeindeErfassen={onGemeindeErfassen} />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Gemeinde hinzufügen' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Dornach')
    await userEvent.type(screen.getByLabelText('BFS-Nummer'), '2473')
    await userEvent.type(screen.getByLabelText('Bezirk'), 'Dorneck (SO)')
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }))

    expect(onGemeindeErfassen).toHaveBeenCalledWith({
      name: 'Dornach',
      bfs_nummer: 2473,
      bezirk: 'Dorneck (SO)'
    })
  })

  // Die Hauptgemeinde ist der Anker des Blatts (unique m2o) — sie hier zu
  // loesen liesse die beiden Haelften auseinanderlaufen.
  it('laesst die Hauptgemeinde nicht loesen', async () => {
    render(
      <GemeindenAuswahl
        gemeinden={drei}
        blaetter={[blatt({})]}
        onUmschalten={jest.fn()}
        onBlattZuordnen={jest.fn()}
      />
    )

    await userEvent.click(screen.getAllByRole('button', { name: 'Zuordnung ändern' })[0]!)

    expect(screen.getByText(/Hauptgemeinde des Blatts/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zuordnung lösen' })).not.toBeInTheDocument()
  })
})
