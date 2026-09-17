import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { zeitleiste, type ZeitleistenQuellen } from '@/lib/redaktion'
import { Zeitleiste } from './Zeitleiste'

// Die Suedanflug-Zeile im Reiter „statistik.bl": kein zehnter Reiter, sondern
// eine Zeile mehr in derselben chronologischen Liste. Was sie darunter zeigt,
// ist ein Knopf je betroffener Gemeinde — und wer betroffen ist, sagt die
// Redaktion, nicht die Quelle.

const monat = (ueber: Record<string, unknown> = {}) => ({
  id: 'q-juli',
  jahr: 2026,
  monat: 7,
  quote: 43.7,
  anfluege: 3778,
  suedlandungen: 1652,
  aktualisiert_am: '2026-08-04',
  provisorisch: true,
  vorschlag: true,
  vorschlag_begruendung: 'Juli 2026: 43,7 Prozent. Überschritten: Monatsschwelle der Redaktion.',
  befunde: [],
  quelle_url: 'https://www.euroairport.com/blatt.pdf',
  ...ueber
})

function zeige(
  suedanflug: ZeitleistenQuellen['suedanflug'],
  ueber: Partial<Parameters<typeof Zeitleiste>[0]> = {}
) {
  const props = {
    ergebnis: zeitleiste({
      ankuendigungen: [],
      bereiche: [],
      datensaetze: [],
      laeufe: [],
      suedanflug
    }),
    onAuftrag: jest.fn(),
    onVerwerfen: jest.fn(),
    onMehr: jest.fn(),
    ...ueber
  }
  render(<Zeitleiste {...props} />)
  return props
}

describe('Zeitleiste — Südanflug', () => {
  it('zeigt Monat, Quote und die Herkunft', () => {
    zeige([monat()])

    expect(screen.getByText(/Südanflug-Quote Juli 2026: 43,7 Prozent/)).toBeInTheDocument()
    expect(screen.getByText('EuroAirport')).toBeInTheDocument()
  })

  it('hebt einen Monat hervor, der eine Schwelle gerissen hat', () => {
    zeige([monat()])

    expect(screen.getByText('Schwelle überschritten')).toBeInTheDocument()
  })

  it('markiert einen ruhigen Monat nicht', () => {
    zeige([monat({ vorschlag: false, vorschlag_begruendung: null, quote: 26.5 })])

    expect(screen.queryByText('Schwelle überschritten')).not.toBeInTheDocument()
  })

  it('bietet je betroffener Gemeinde einen Knopf', async () => {
    const onSuedanflugMeldung = jest.fn().mockResolvedValue(undefined)
    zeige([monat()], {
      suedanflugGemeinden: [
        { id: 'g-bin', name: 'Binningen' },
        { id: 'g-all', name: 'Allschwil' }
      ],
      onSuedanflugMeldung
    })

    const knopf = screen.getByRole('button', { name: /Binningen/ })
    expect(screen.getByRole('button', { name: /Allschwil/ })).toBeInTheDocument()

    await userEvent.click(knopf)
    expect(onSuedanflugMeldung).toHaveBeenCalledWith('q-juli', 'g-bin')
  })

  it('sagt es, wenn keine Gemeinde erfasst ist, statt einen Knopf ins Leere zu zeigen', () => {
    zeige([monat()], { suedanflugGemeinden: [] })

    expect(screen.getByText(/Keine Gemeinde ist als Südanflug-Gemeinde erfasst/)).toBeInTheDocument()
  })

  it('zeigt die Befunde des Blatts, statt sie zu verschweigen', () => {
    zeige([
      monat({
        befunde: ['7. August 2026: 130 Südlandungen bei 128 Anflügen.']
      })
    ])

    expect(screen.getByText(/130 Südlandungen bei 128 Anflügen/)).toBeInTheDocument()
  })

  it('zeigt die Meldung statt des Knopfs, sobald es eine gibt', () => {
    zeige([monat()], {
      suedanflugGemeinden: [{ id: 'g-bin', name: 'Binningen' }],
      berichteZuSuedanflug: new Map([
        [
          'q-juli',
          [
            {
              id: 'm-1',
              titel: 'Jede zweite Landung über Binningen',
              lead: 'Lead.',
              text: 'Text.',
              status: 'entwurf',
              verarbeitung: 'idle',
              zeit_warnungen: null,
              fehler: null,
              publiziert_am: null,
              publiziert_durch: null,
              revision_hinweis: null,
              erscheint_am: null,
              date_created: '2026-09-17T10:00:00.000Z',
              gemeinde: { id: 'g-bin', name: 'Binningen', bezirk: 'Arlesheim' },
              lauf: null,
              spiel: null,
              kandidat: null,
              amtsblattmeldung: null,
              gemeindemitteilung: null,
              sendungskandidat: null,
              suedanflugquote: { id: 'q-juli' },
              perle: null
            }
          ]
        ]
      ])
    })

    expect(screen.getByText('Jede zweite Landung über Binningen')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Meldung erzeugen/ })).not.toBeInTheDocument()
  })
})
