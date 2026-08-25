import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { zeitleiste, type ZeitleistenQuellen } from '@/lib/redaktion'
import { Zeitleiste } from './Zeitleiste'

function quellen(ueber: Partial<ZeitleistenQuellen> = {}): ZeitleistenQuellen {
  return { ankuendigungen: [], bereiche: [], datensaetze: [], laeufe: [], ...ueber }
}

const agenda = {
  id: 'a1',
  titel: 'Abfallstatistik 2025',
  datum: '2026-07-07',
  quartal: '3. Quartal: Juli–September',
  zuordnung_hinweis: null,
  datensatz: { id: 'ds-abfall', hat_gemeinde: true }
}

const zweig = {
  id: 'b1',
  pfad: '18_4',
  titel: 'Steuern und Gebühren',
  stand: '2026-06-11',
  beobachten: true
}

const datensatz = {
  id: 'ds-firmen',
  titel: 'Firmen nach Zweck, Rechtsform und Standort',
  status: 'relevant',
  hat_gemeinde: true,
  portal_modified: '2026-08-12',
  daten_stand: '2026-08-12',
  rhythmus: 'annual',
  zeilen: 20828,
  beschreibung: 'Zentraler Firmenindex (Zefix).',
  bewertung: 'Relevant: Firmengründungen sagen etwas über eine Gemeinde.'
}

function zeige(
  eingabe: Partial<ZeitleistenQuellen> = {},
  ueber: Partial<Parameters<typeof Zeitleiste>[0]> = {}
) {
  const props = {
    ergebnis: zeitleiste(quellen(eingabe)),
    onAuftrag: jest.fn(),
    onVerwerfen: jest.fn(),
    onMehr: jest.fn(),
    ...ueber
  }
  render(<Zeitleiste {...props} />)
  return props
}

describe('Zeitleiste', () => {
  it('zeigt jede Zeile mit Datum und Herkunft', () => {
    zeige({ ankuendigungen: [agenda], bereiche: [zweig], datensaetze: [datensatz] })

    expect(screen.getByText('12.08.2026')).toBeInTheDocument()
    expect(screen.getByText('Agenda')).toBeInTheDocument()
    expect(screen.getByText('Portal')).toBeInTheDocument()
    expect(screen.getByText('data.bl.ch')).toBeInTheDocument()
  })

  // Der Grund fuer diese Ansicht: nur 9 von 188 Datensaetzen stehen in der
  // Agenda. Ohne diese Zeile bliebe die Herkunft der uebrigen Meldungen offen.
  it('zeigt eine Katalogaenderung, die in der Agenda nie vorkommt', () => {
    zeige({ datensaetze: [datensatz] })
    expect(screen.getByText(/Firmen nach Zweck/)).toBeInTheDocument()
  })

  it('verlinkt eine Portalzeile auf den Zweig', () => {
    zeige({ bereiche: [zweig] })

    const link = screen.getByRole('link', { name: /Steuern und Gebühren \(18_4\)/ })
    expect(link).toHaveAttribute('href', 'https://statistik.bl.ch/web_portal/18_4')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  // Die Berichte stehen jetzt unter ihrem Eintrag. Der Umweg ueber einen
  // eigenen Reiter ist weg, und mit ihm der Knopf, der dorthin sprang.
  it('zeigt die Berichte unter dem Eintrag, statt woandershin zu fuehren', () => {
    zeige(
      {
        datensaetze: [datensatz],
        laeufe: [{ id: 'lauf-1', datensatz: { id: 'ds-firmen' } }]
      },
      {
        berichteZuLauf: new Map([
          [
            'lauf-1',
            [
              {
                id: 'm1',
                titel: 'Ein Titel',
                lead: null,
                text: null,
                status: 'entwurf',
                verarbeitung: 'idle',
                zeit_warnungen: null,
                fehler: null,
                publiziert_am: null,
                erscheint_am: null,
                date_created: null,
                gemeinde: null,
                lauf: { id: 'lauf-1' },
                spiel: null
              },
              {
                id: 'm2',
                titel: 'Noch einer',
                lead: null,
                text: null,
                status: 'entwurf',
                verarbeitung: 'idle',
                zeit_warnungen: null,
                fehler: null,
                publiziert_am: null,
                erscheint_am: null,
                date_created: null,
                gemeinde: null,
                lauf: { id: 'lauf-1' },
                spiel: null
              }
            ] as never
          ]
        ])
      }
    )

    expect(screen.queryByRole('button', { name: 'Meldungen ansehen' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2 Berichte/ })).toBeInTheDocument()
  })

  it('klappt die Berichte erst auf Klick auf', async () => {
    zeige(
      {
        datensaetze: [datensatz],
        laeufe: [{ id: 'lauf-1', datensatz: { id: 'ds-firmen' } }]
      },
      {
        berichteZuLauf: new Map([
          [
            'lauf-1',
            [
              {
                id: 'm1',
                titel: 'Ein Titel',
                lead: null,
                text: null,
                status: 'entwurf',
                verarbeitung: 'idle',
                zeit_warnungen: null,
                fehler: null,
                publiziert_am: null,
                erscheint_am: null,
                date_created: null,
                gemeinde: null,
                lauf: { id: 'lauf-1' },
                spiel: null
              }
            ] as never
          ]
        ])
      }
    )

    // Zugeklappt, weil ein Lauf sieben Meldungen hat.
    expect(screen.queryByText('Ein Titel')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /1 Bericht/ }))
    expect(screen.getByText('Ein Titel')).toBeInTheDocument()
  })

  it('oeffnet den Auftrag mit dem Datensatz der Zeile', async () => {
    const { onAuftrag } = zeige({ datensaetze: [datensatz] })

    await userEvent.click(screen.getByRole('button', { name: 'Meldungen erzeugen' }))

    expect(onAuftrag).toHaveBeenCalledWith(
      expect.objectContaining({ datensatzId: 'ds-firmen', herkunft: 'datensatz' })
    )
  })

  it('verlangt bei einem Agenda-Eintrag ohne Datensatz erst die Wahl', async () => {
    const { onAuftrag } = zeige({
      ankuendigungen: [{ ...agenda, datensatz: null, zuordnung_hinweis: 'Kein passender Datensatz.' }]
    })

    await userEvent.click(screen.getByRole('button', { name: 'Datensatz wählen' }))

    expect(onAuftrag).toHaveBeenCalledWith(expect.objectContaining({ datensatzId: null }))
  })

  // Die Quartalsgruppierung der Agenda ueberlebt genau hier — bei dem, was noch
  // kein Datum hat und sich deshalb nicht einordnen laesst.
  it('haengt Angekuendigtes ohne Termin nach Quartal unten an', () => {
    zeige({
      ankuendigungen: [agenda, { ...agenda, id: 'a2', titel: 'Leerstandserhebung 2026', datum: null }]
    })

    const block = screen.getByRole('heading', { name: 'Angekündigt, noch ohne Termin' })
      .parentElement as HTMLElement

    expect(within(block).getByText(/3\. Quartal/)).toBeInTheDocument()
    expect(within(block).getByText('Leerstandserhebung 2026')).toBeInTheDocument()
    expect(within(block).getByText('noch keine Daten')).toBeInTheDocument()
  })

  it('bietet die abgeschnittenen Zeilen an', async () => {
    const viele = Array.from({ length: 6 }, (_, i) => ({
      ...datensatz,
      id: `d${i}`,
      portal_modified: `2026-08-0${i + 1}`
    }))
    const { onMehr } = zeige({}, { ergebnis: zeitleiste(quellen({ datensaetze: viele }), 4) })

    await userEvent.click(screen.getByRole('button', { name: '2 weitere anzeigen' }))

    expect(onMehr).toHaveBeenCalled()
  })

  it('bleibt still, wenn nichts abgeschnitten wurde', () => {
    zeige({ datensaetze: [datensatz] })
    expect(screen.queryByRole('button', { name: /weitere anzeigen/ })).not.toBeInTheDocument()
  })
})

describe('Zeitleiste — beschreiben und aussortieren', () => {
  it('nennt Rhythmus, Zeilenzahl und Beschreibung', () => {
    zeige({ datensaetze: [datensatz] })

    expect(screen.getByText(/jährlich/)).toBeInTheDocument()
    expect(screen.getByText(/20.828 Zeilen/)).toBeInTheDocument()
    expect(screen.getByText(/Zentraler Firmenindex/)).toBeInTheDocument()
  })

  // Die Arbeitsteilung: die Maschine sortiert aus, was mechanisch entscheidbar
  // ist, der Mensch entscheidet ueber den journalistischen Wert.
  it('laesst einen Datensatz dauerhaft verwerfen', async () => {
    const { onVerwerfen } = zeige({ datensaetze: [datensatz] })

    await userEvent.click(screen.getByRole('button', { name: 'Vergiss es' }))

    expect(onVerwerfen).toHaveBeenCalledWith(expect.objectContaining({ datensatzId: 'ds-firmen' }))
  })

  it('bietet das Verwerfen nicht an, wo es keinen Datensatz gibt', () => {
    zeige({
      bereiche: [{ id: 'b1', pfad: '18_4', titel: '', stand: '2026-06-11', beobachten: true }]
    })

    expect(screen.queryByRole('button', { name: 'Vergiss es' })).not.toBeInTheDocument()
  })

  // `daten_stand` statt `portal_modified`: letzteres springt auch, wenn nur die
  // Beschreibung korrigiert wurde.
  it('datiert nach dem Stand der Daten, nicht der Beschreibung', () => {
    zeige({
      datensaetze: [{ ...datensatz, portal_modified: '2026-08-03', daten_stand: '2026-07-21' }]
    })

    expect(screen.getByText('21.07.2026')).toBeInTheDocument()
    expect(screen.queryByText('03.08.2026')).not.toBeInTheDocument()
  })
})
