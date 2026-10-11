import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Verkehr } from './Verkehr'
import type {
  AlleMeldungFelder,
  GeschwindigkeitskontrolleFelder,
  RadarstandortFelder
} from '@/graphql/redaktion'

const STANDORT: RadarstandortFelder = {
  id: 's-1',
  art: 'semistationaer',
  kennung: 'SEMI 03',
  ab_wann: '2026-09-18',
  standort: '4123 Allschwil, Binningerstrasse',
  plz: '4123',
  ort: 'Allschwil',
  strasse: 'Binningerstrasse',
  geschwindigkeit: 50,
  oertlichkeit: 'Ein- / Ausfahrten',
  gemeinde: { id: 'g-allschwil', name: 'Allschwil' },
  aktiv: true,
  erstmals_gesehen: '2026-10-11',
  zuletzt_gesehen: '2026-10-11',
  publikation_am: '2026-10-07',
  quelle_url: 'https://bl-api.webcloud7.ch/x.pdf',
  vorschlag: true,
  vorschlag_begruendung:
    'Neue semistationaere Anlage in Allschwil: 4123 Allschwil, Binningerstrasse, ab 18. September 2026.'
}

const AUGST: RadarstandortFelder = {
  ...STANDORT,
  id: 's-2',
  standort: '4302 Augst, A3',
  ort: 'Augst',
  strasse: 'A3',
  plz: '4302',
  gemeinde: null,
  vorschlag: false,
  vorschlag_begruendung: null
}

const MONAT: GeschwindigkeitskontrolleFelder = {
  id: 'k-9',
  jahr: 2026,
  monat: 9,
  stand: '2026-09-29',
  polizei: 'Gemeindepolizei Reinach',
  bilanz: {
    kontrollen: 9,
    gemessen: 738,
    uebertretungen: 157,
    quote: 21.3,
    meiste: { messort: 'Hinterkirchweg', uebertretungen: 35, gemessen: 99, quote: 35.4 },
    schnellster: {
      vmax: 48,
      signalisiert: 30,
      messort: 'Hinterlindenweg',
      datum: '2026-09-08',
      von: '07:12',
      bis: '08:48'
    }
  },
  hinweise: ['Der Kopf des Blatts nennt Januar 2026, die Zeilen sind September 2026 — die Zeilen gelten.'],
  quelle_url: 'https://www.reinach-bl.ch/r/009-September-2026.pdf',
  gemeinde: { id: 'g-reinach', name: 'Reinach' }
}

const handler = () => ({
  onMeldung: jest.fn(async () => undefined),
  onChat: jest.fn(async () => undefined),
  onAktion: jest.fn(async () => undefined)
})

describe('Verkehr', () => {
  it('zeigt den neuen Standort als Vorschlag mit Knopf und faltet die anderen des Kantons weg', async () => {
    const h = handler()
    render(<Verkehr standorte={[STANDORT, AUGST]} monate={[]} meldungen={[]} {...h} />)
    expect(screen.getByText('Binningerstrasse, Allschwil')).toBeInTheDocument()
    expect(screen.getByText('Neu')).toBeInTheDocument()
    expect(screen.getByText(/Neue semistationaere Anlage in Allschwil/)).toBeInTheDocument()
    expect(screen.getByText(/Alle anderen Standorte im Kanton \(1\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erzeugen' }))
    expect(h.onMeldung).toHaveBeenCalledWith('standorte', 's-1')
  })

  it('zeigt die Bilanz eines Monats, seine Befunde und den Knopf', async () => {
    const h = handler()
    render(<Verkehr standorte={[]} monate={[MONAT]} meldungen={[]} {...h} />)
    expect(screen.getByText('Geschwindigkeitskontrollen September 2026')).toBeInTheDocument()
    expect(screen.getByText('9 Kontrollen · 738 Fahrzeuge · 157 Übertretungen (21,3 %)')).toBeInTheDocument()
    expect(
      screen.getByText(/Schnellstes Fahrzeug: 48 km\/h bei 30 km\/h, Hinterlindenweg/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Der Kopf des Blatts nennt Januar 2026/)).toBeInTheDocument()
    expect(screen.getByText('Noch kein Standortblatt gelesen', { exact: false })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erzeugen' }))
    expect(h.onMeldung).toHaveBeenCalledWith('kontrollen', 'k-9')
  })

  it('zeigt die Karte der Meldung statt des Knopfs, sobald eine existiert', () => {
    const h = handler()
    const meldung = {
      id: 'm-1',
      titel: 'Neuer Blitzer an der Binningerstrasse',
      lead: 'Lead.',
      text: 'Text.',
      status: 'entwurf',
      verarbeitung: 'idle',
      zeit_warnungen: null,
      fehler: null,
      publiziert_am: null,
      publiziert_durch: null,
      termin: null,
      termin_vorschlag: null,
      wichtig: null,
      wichtig_vorschlag: null,
      revision_hinweis: null,
      erscheint_am: null,
      date_created: null,
      gemeinde: { id: 'g-allschwil', name: 'Allschwil', bezirk: 'Arlesheim' },
      lauf: null,
      spiel: null,
      kandidat: null,
      amtsblattmeldung: null,
      gemeindemitteilung: null,
      kantonsmitteilung: null,
      sendungskandidat: null,
      suedanflugquote: null,
      abstimmung: null,
      veranstaltung: null,
      radarstandort: { id: 's-1' },
      geschwindigkeitskontrolle: null,
      perle: null
    } as unknown as AlleMeldungFelder
    render(<Verkehr standorte={[STANDORT]} monate={[]} meldungen={[meldung]} {...h} />)
    expect(screen.getByText('Neuer Blitzer an der Binningerstrasse')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Meldung erzeugen' })).not.toBeInTheDocument()
  })
})
