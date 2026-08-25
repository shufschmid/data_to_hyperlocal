import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Presseschau } from './Presseschau'
import type {
  AlleMeldungFelder,
  GemeindeFelder,
  KandidatFelder,
  WochenblattFelder
} from '@/graphql/redaktion'

function kandidat(ueber: Partial<KandidatFelder>): KandidatFelder {
  return {
    id: 'k-1',
    titel: 'Wo die Temperaturrekorde purzeln',
    seite: 3,
    typ: 'reportage',
    frontseite: true,
    warum_exklusiv: 'Eigene Reportage mit Besuch vor Ort.',
    zusammenfassung: 'Die Basler Klimamessreihe reicht bis 1755 zurueck.',
    perle_vorschlag: true,
    perle_begruendung: 'Weltweit einmalige Messreihe.',
    entscheid: 'offen',
    ablehnungsgrund: null,
    ablehnungskommentar: null,
    ...ueber
  }
}

function blatt(ueber: Partial<WochenblattFelder>): WochenblattFelder {
  return {
    id: 'w-1',
    name: 'Binninger Wochenblatt',
    archiv_url: 'https://www.binninger-wochenblatt.ch/archiv/',
    aktiv: true,
    letzte_pruefung: null,
    letzter_fehler: null,
    gemeinde: { id: 'g-1', name: 'Binningen' },
    ausgaben: [
      {
        id: 'a-1',
        schluessel: 'kw34-2026',
        nummer: '34',
        datum: '2026-08-20',
        seite_url: 'https://www.binninger-wochenblatt.ch/bwb-kw34-2026/',
        pdf_url: 'https://www.binninger-wochenblatt.ch/wp-content/uploads/2026/08/BWB-KW34-2026.pdf',
        seiten: 16,
        status: 'inventarisiert',
        fehler: null,
        kandidaten: [kandidat({})]
      }
    ],
    ...ueber
  }
}

function meldung(ueber: Partial<AlleMeldungFelder>): AlleMeldungFelder {
  return {
    id: 'm-1',
    titel: 'Die Maenner hinter den Basler Hitzerekorden',
    lead: 'Lead.',
    text: 'Text.\n\nQuelle: Binninger Wochenblatt Nr. 34',
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: null,
    fehler: null,
    publiziert_am: null,
    erscheint_am: null,
    date_created: null,
    gemeinde: { id: 'g-1', name: 'Binningen', bezirk: 'Arlesheim' },
    lauf: null,
    spiel: null,
    kandidat: { id: 'k-1' },
    perle: null,
    ...ueber
  }
}

const gemeinden: GemeindeFelder[] = []

const NICHTS = {
  onAnlegen: jest.fn().mockResolvedValue(undefined),
  onPruefen: jest.fn().mockResolvedValue(undefined),
  onInventar: jest.fn().mockResolvedValue(undefined),
  onMeldung: jest.fn().mockResolvedValue(undefined),
  onAblehnen: jest.fn().mockResolvedValue(undefined),
  onChat: jest.fn().mockResolvedValue(undefined),
  onAktion: jest.fn().mockResolvedValue(undefined),
  onPerlePublizieren: jest.fn().mockResolvedValue(undefined)
}

describe('Presseschau', () => {
  beforeEach(() => {
    for (const f of Object.values(NICHTS)) f.mockClear()
  })

  it('zeigt den Kandidaten mit Typ, Front und Perle-Vorschlag', () => {
    render(<Presseschau blaetter={[blatt({})]} gemeinden={gemeinden} meldungen={[]} {...NICHTS} />)

    expect(screen.getByText(/Wo die Temperaturrekorde purzeln/)).toBeInTheDocument()
    expect(screen.getByText('Reportage')).toBeInTheDocument()
    expect(screen.getByText('Front')).toBeInTheDocument()
    expect(screen.getByText('Perle?')).toBeInTheDocument()
  })

  it('erzeugt die Meldung auf Knopfdruck', async () => {
    render(<Presseschau blaetter={[blatt({})]} gemeinden={gemeinden} meldungen={[]} {...NICHTS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Meldung erzeugen' }))

    expect(NICHTS.onMeldung).toHaveBeenCalledWith('k-1')
  })

  it('fragt beim Ablehnen nach dem Grund — das ist das Lernsignal', async () => {
    render(<Presseschau blaetter={[blatt({})]} gemeinden={gemeinden} meldungen={[]} {...NICHTS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Doublette' }))
    await userEvent.type(screen.getByLabelText(/Kommentar/), 'stand schon im Amtsblatt')
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen', hidden: false }))

    expect(NICHTS.onAblehnen).toHaveBeenCalledWith('k-1', 'doublette', 'stand schon im Amtsblatt')
  })

  it('zeigt einen abgelehnten Kandidaten mit seinem Grund', () => {
    const abgelehnt = kandidat({
      entscheid: 'abgelehnt',
      ablehnungsgrund: 'veraltet',
      ablehnungskommentar: 'zu spaet'
    })
    const mitAbgelehntem = blatt({})
    mitAbgelehntem.ausgaben[0]!.kandidaten = [abgelehnt]

    render(<Presseschau blaetter={[mitAbgelehntem]} gemeinden={gemeinden} meldungen={[]} {...NICHTS} />)

    expect(screen.getByText(/Abgelehnt — Veraltet: zu spaet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Meldung erzeugen' })).not.toBeInTheDocument()
  })

  it('bietet an der fertigen Meldung die Perlen-Entscheidung an', async () => {
    render(<Presseschau blaetter={[blatt({})]} gemeinden={gemeinden} meldungen={[meldung({})]} {...NICHTS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Als Perle publizieren' }))

    expect(NICHTS.onPerlePublizieren).toHaveBeenCalledWith('m-1', true)
  })

  it('zeigt ein Blatt mit Abruffehler als Banner, nicht als Stille', () => {
    render(
      <Presseschau
        blaetter={[
          blatt({ letzter_fehler: 'Archiv antwortete mit 503.', letzte_pruefung: '2026-08-25T09:00:00Z' })
        ]}
        gemeinden={gemeinden}
        meldungen={[]}
        {...NICHTS}
      />
    )

    expect(screen.getByText(/Archiv nicht gelesen/)).toBeInTheDocument()
    expect(screen.getByText(/Archiv antwortete mit 503/)).toBeInTheDocument()
  })
})
