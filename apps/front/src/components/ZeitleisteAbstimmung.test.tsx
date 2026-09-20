import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { zeitleiste, type ZeitleistenQuellen } from '@/lib/redaktion'
import { Zeitleiste } from './Zeitleiste'

// Die Abstimmungszeile im Reiter „data to hyperlocal": kein zehnter Reiter,
// sondern eine Zeile mehr in derselben chronologischen Liste. Darunter ein
// Knopf je Gemeinde — aber nur, wo sie fertig ausgezählt ist.

const vorlage = (ueber: Record<string, unknown> = {}) => ({
  id: 'a-k3',
  vote_id: '20260927_K3',
  datum: '2026-09-27',
  titel: 'Formulierte Gesetzesinitiative «Fairer Kompromiss bei der Mehrwertabgabe»',
  ebene: 'kanton',
  gemeindezahlen: [
    { bfs: '2765', gemeinde: 'Binningen', ausgezaehlt: true },
    { bfs: '2761', gemeinde: 'Aesch (BL)', ausgezaehlt: false }
  ],
  gemeinden_total: 86,
  gemeinden_ausgezaehlt: 40,
  ausgezaehlt: false,
  stichfrage_gilt: false,
  stichfrage_grund: 'Der Kanton ist noch nicht fertig ausgezählt.',
  quelle_url: 'https://vework-public.bl.ch/app/publication/2026-09-27/issues/k3a',
  ...ueber
})

const GEMEINDEN = new Map([
  ['2765', { id: 'g-bin', name: 'Binningen' }],
  ['2761', { id: 'g-aesch', name: 'Aesch (BL)' }]
])

function zeige(
  abstimmungen: ZeitleistenQuellen['abstimmungen'],
  ueber: Partial<Parameters<typeof Zeitleiste>[0]> = {}
) {
  const props = {
    ergebnis: zeitleiste({
      ankuendigungen: [],
      bereiche: [],
      datensaetze: [],
      laeufe: [],
      abstimmungen
    }),
    gemeindenNachBfs: GEMEINDEN,
    onAuftrag: jest.fn(),
    onVerwerfen: jest.fn(),
    onMehr: jest.fn(),
    ...ueber
  }
  render(<Zeitleiste {...props} />)
  return props
}

describe('Zeitleiste — Abstimmung', () => {
  it('zeigt die Vorlage, ihre Herkunft und den Auszählstand', () => {
    zeige([vorlage()])

    expect(screen.getByText(/Abstimmung vom 27.09.2026/)).toBeInTheDocument()
    expect(screen.getByText('Abstimmung')).toBeInTheDocument()
    expect(screen.getByText(/40 von 86 Gemeinden ausgezählt/)).toBeInTheDocument()
  })

  it('bietet einen Knopf nur für die ausgezählte Gemeinde', () => {
    zeige([vorlage()])

    expect(screen.getByRole('button', { name: /Meldung erzeugen · Binningen/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Meldung erzeugen · Aesch/ })).not.toBeInTheDocument()
    // Sie verschwindet nicht, sie sagt warum.
    expect(screen.getByText(/Aesch \(BL\): zählt noch aus/)).toBeInTheDocument()
  })

  it('meldet den Klick mit Vorlage und Gemeinde', async () => {
    const onAbstimmungsMeldung = jest.fn().mockResolvedValue(undefined)
    zeige([vorlage()], { onAbstimmungsMeldung })

    await userEvent.click(screen.getByRole('button', { name: /Meldung erzeugen · Binningen/ }))

    expect(onAbstimmungsMeldung).toHaveBeenCalledWith('a-k3', 'g-bin')
  })

  it('sagt es, wenn eine ausgezählte Gemeinde nicht erfasst ist', () => {
    zeige([vorlage()], { gemeindenNachBfs: new Map() })

    expect(screen.getByText(/Binningen: ausgezählt, aber nicht als Gemeinde erfasst/)).toBeInTheDocument()
  })

  it('zeigt die Karte der Meldung, sobald es eine gibt', () => {
    zeige([vorlage()], {
      berichteZuAbstimmung: new Map([
        [
          'a-k3',
          [
            {
              id: 'm-1',
              titel: 'Binningen sagt Ja zur Mehrwertabgabe',
              lead: 'Ein Satz.',
              text: 'Ein Absatz.',
              status: 'entwurf',
              verarbeitung: 'idle',
              zeit_warnungen: null,
              fehler: null,
              publiziert_am: null,
              publiziert_durch: null,
              revision_hinweis: null,
              erscheint_am: null,
              date_created: '2026-09-27T18:00:00.000Z',
              gemeinde: { id: 'g-bin', name: 'Binningen', bezirk: 'Arlesheim' },
              lauf: null,
              spiel: null,
              kandidat: null,
              amtsblattmeldung: null,
              gemeindemitteilung: null,
              veranstaltung: null,
              sendungskandidat: null,
              suedanflugquote: null,
              abstimmung: { id: 'a-k3' },
              perle: null
            }
          ]
        ]
      ])
    })

    expect(screen.getByText('Binningen sagt Ja zur Mehrwertabgabe')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Meldung erzeugen · Binningen/ })).not.toBeInTheDocument()
  })
})
