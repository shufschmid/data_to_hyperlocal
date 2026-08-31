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
    gemeinde: { id: 'g-1', name: 'Binningen' },
    gemeinde_korrigiert: false,
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
    abdeckungen: [{ id: 'a-g-1', gemeinde: { id: 'g-1', name: 'Binningen' } }],
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
        seiten_texte: ['Seite 1.', 'Seite 2.', 'Wortlaut der Reportage auf Seite drei.'],
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
    amtsblattmeldung: null,
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
  onWeiterreichen: jest.fn().mockResolvedValue(undefined),
  onChat: jest.fn().mockResolvedValue(undefined),
  onAktion: jest.fn().mockResolvedValue(undefined)
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

  it('nimmt einen abgelehnten Kandidaten vom Tisch', () => {
    const abgelehnt = kandidat({
      entscheid: 'abgelehnt',
      ablehnungsgrund: 'veraltet',
      ablehnungskommentar: 'zu spaet'
    })
    const mitAbgelehntem = blatt({})
    mitAbgelehntem.ausgaben[0]!.kandidaten = [abgelehnt]

    render(<Presseschau blaetter={[mitAbgelehntem]} gemeinden={gemeinden} meldungen={[]} {...NICHTS} />)

    expect(screen.queryByText(/Wo die Temperaturrekorde purzeln/)).not.toBeInTheDocument()
    expect(screen.getByText(/Alle Vorschläge dieser Ausgabe sind bearbeitet/)).toBeInTheDocument()
  })

  it('nimmt einen Kandidaten mit publizierter Meldung vom Tisch — Erledigtes bleibt nicht liegen', () => {
    const uebernommen = blatt({})
    uebernommen.ausgaben[0]!.kandidaten = [kandidat({ entscheid: 'uebernommen' })]

    render(
      <Presseschau
        blaetter={[uebernommen]}
        gemeinden={gemeinden}
        meldungen={[meldung({ status: 'publiziert' })]}
        {...NICHTS}
      />
    )

    expect(screen.queryByText(/Wo die Temperaturrekorde purzeln/)).not.toBeInTheDocument()
    expect(screen.getByText(/Alle Vorschläge dieser Ausgabe sind bearbeitet/)).toBeInTheDocument()
  })

  it('laesst eine uebernommene Meldung auf dem Tisch, solange sie im Redigat steckt', () => {
    const uebernommen = blatt({})
    uebernommen.ausgaben[0]!.kandidaten = [kandidat({ entscheid: 'uebernommen' })]

    render(
      <Presseschau
        blaetter={[uebernommen]}
        gemeinden={gemeinden}
        meldungen={[meldung({ status: 'entwurf' })]}
        {...NICHTS}
      />
    )

    expect(screen.getByText(/Die Maenner hinter den Basler Hitzerekorden/)).toBeInTheDocument()
  })

  it('publiziert schlicht — die Perlen-Frage gehoert der Chefredaktion', async () => {
    render(<Presseschau blaetter={[blatt({})]} gemeinden={gemeinden} meldungen={[meldung({})]} {...NICHTS} />)

    expect(screen.queryByRole('button', { name: /Perle/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Publizieren' }))
    expect(NICHTS.onAktion).toHaveBeenCalledWith('m-1', 'publizieren')
  })

  it('reicht einen Kandidaten mit Begruendung an die Chefredaktion weiter', async () => {
    render(<Presseschau blaetter={[blatt({})]} gemeinden={gemeinden} meldungen={[]} {...NICHTS} />)

    await userEvent.click(screen.getByRole('button', { name: 'An Chefredaktion' }))
    await userEvent.type(screen.getByLabelText(/Begründung/), 'Zahlen zuerst verifizieren')
    await userEvent.click(screen.getByRole('button', { name: 'Weiterreichen' }))

    expect(NICHTS.onWeiterreichen).toHaveBeenCalledWith('k-1', 'Zahlen zuerst verifizieren')
  })

  it('nimmt einen weitergereichten Kandidaten vom Tisch — er liegt jetzt bei der Chefredaktion', () => {
    const weg = blatt({})
    weg.ausgaben[0]!.kandidaten = [kandidat({ entscheid: 'weitergereicht' })]

    render(<Presseschau blaetter={[weg]} gemeinden={gemeinden} meldungen={[]} {...NICHTS} />)

    expect(screen.queryByText(/Wo die Temperaturrekorde purzeln/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Meldung erzeugen' })).not.toBeInTheDocument()
  })

  it('bietet die Gemeinde-Korrektur nur an, solange der Kandidat offen ist', () => {
    // Zwei abgedeckte Gemeinden: beim offenen Kandidaten ist die Zuordnung ein
    // Auswahlfeld. Sobald eine Meldung existiert, traegt DIE die Gemeinde —
    // eine Aenderung am Kandidaten wuerde sie nicht mehr umziehen, also
    // verschwindet das Feld.
    const zweiGemeinden = blatt({
      abdeckungen: [
        { id: 'a-g-1', gemeinde: { id: 'g-1', name: 'Binningen' } },
        { id: 'a-g-2', gemeinde: { id: 'g-2', name: 'Bottmingen' } }
      ]
    })
    const mitGemeinde = { ...NICHTS, onGemeinde: jest.fn().mockResolvedValue(undefined) }

    const { rerender } = render(
      <Presseschau blaetter={[zweiGemeinden]} gemeinden={gemeinden} meldungen={[]} {...mitGemeinde} />
    )
    expect(screen.getByRole('combobox', { name: 'Gemeinde des Beitrags' })).toBeInTheDocument()

    rerender(
      <Presseschau
        blaetter={[zweiGemeinden]}
        gemeinden={gemeinden}
        meldungen={[meldung({})]}
        {...mitGemeinde}
      />
    )
    expect(screen.queryByRole('combobox', { name: 'Gemeinde des Beitrags' })).not.toBeInTheDocument()
  })

  it('klappt den Originaltext der Seite auf — geprueft wird am Original, nie an der Zusammenfassung', async () => {
    render(<Presseschau blaetter={[blatt({})]} gemeinden={gemeinden} meldungen={[]} {...NICHTS} />)

    expect(screen.queryByText(/Wortlaut der Reportage/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Originaltext lesen (S. 3)' }))
    expect(screen.getByText(/Wortlaut der Reportage auf Seite drei/)).toBeInTheDocument()
  })

  it('verlinkt die Seitenangabe des Kandidaten direkt auf die Beitragsseite', () => {
    render(<Presseschau blaetter={[blatt({})]} gemeinden={gemeinden} meldungen={[]} {...NICHTS} />)

    expect(screen.getByRole('link', { name: '(S. 3)' })).toHaveAttribute(
      'href',
      'https://www.binninger-wochenblatt.ch/wp-content/uploads/2026/08/BWB-KW34-2026.pdf#page=3'
    )
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
