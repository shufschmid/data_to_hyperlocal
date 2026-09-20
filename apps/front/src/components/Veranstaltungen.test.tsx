import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  AlleMeldungFelder,
  GemeindeFelder,
  VeranstaltungFelder,
  VeranstaltungsquelleFelder
} from '@/graphql/redaktion'
import { Veranstaltungen } from './Veranstaltungen'

function anlass(ueber: Partial<VeranstaltungFelder> = {}): VeranstaltungFelder {
  return {
    id: 'a',
    schluessel: 'markt des alterns|kuspo',
    titel: 'Markt des Alterns',
    termine: ['2026-09-25'],
    von: '2026-09-25',
    bis: null,
    zeit: '13:00–18:00 Uhr',
    rhythmus: 'einmalig',
    zugang: 'offen',
    anker: 'einmalig',
    anker_am: '2026-09-25',
    anker_grund: 'Einmaliger Anlass im Vorschlagsfenster.',
    frist_am: null,
    lokalitaet: 'Kultur- und Sportzentrum',
    adresse: null,
    ort: 'Pratteln',
    ort_ausserhalb: false,
    veranstalter: 'Gemeinde Pratteln',
    kategorie: null,
    preis: null,
    anmeldung: null,
    beschreibung: 'Ein Markt rund ums Älterwerden.',
    text_abgeschnitten: false,
    dokumente: null,
    traktanden: null,
    traktanden_url: null,
    url: 'https://www.pratteln.ch/_rte/anlass/7353004',
    url_kanonisch: null,
    plattform: 'iweb_termine',
    hinweise: null,
    gelesen_am: '2026-09-20T11:00:00Z',
    zuletzt_gesehen_am: '2026-09-20',
    vorschlag: true,
    vorschlag_begruendung: 'Anlass der Gemeinde, offen für alle.',
    entscheid: 'offen',
    ablehnungsgrund: null,
    dauerangebot: null,
    zuletzt_vorgelegt_am: null,
    zuletzt_gemeldet_am: null,
    date_created: '2026-09-20T11:00:00Z',
    gemeinde: { id: 'g1', name: 'Pratteln' },
    quelle: {
      id: 'q1',
      name: 'Veranstaltungskalender der Gemeinde Pratteln',
      url: 'https://www.pratteln.ch/anlaesseaktuelles'
    },
    ...ueber
  }
}

function quelle(ueber: Partial<VeranstaltungsquelleFelder> = {}): VeranstaltungsquelleFelder {
  return {
    id: 'q1',
    name: 'Veranstaltungskalender der Gemeinde Pratteln',
    url: 'https://www.pratteln.ch/anlaesseaktuelles',
    art: 'gemeinde',
    plattform: 'iweb_termine',
    aktiv: true,
    letzte_pruefung: '2026-09-20T11:00:00Z',
    letzter_fehler: null,
    letzter_hinweis: null,
    gemeinde: { id: 'g1', name: 'Pratteln' },
    ...ueber
  }
}

function gemeinde(ueber: Partial<GemeindeFelder> = {}): GemeindeFelder {
  return {
    id: 'g1',
    name: 'Pratteln',
    bezirk: 'Liestal',
    bfs_nummer: 2831,
    plz: ['4133'],
    aktiv: true,
    news_url: null,
    news_letzte_pruefung: null,
    news_letzter_fehler: null,
    news_letzter_hinweis: null,
    suedanflug: false,
    ...ueber
  }
}

function meldung(ueber: Partial<AlleMeldungFelder> = {}): AlleMeldungFelder {
  return {
    id: 'm-1',
    titel: 'Pratteln lädt zum Markt des Alterns',
    lead: 'Wie die Gemeinde Pratteln mitteilt …',
    text: 'Text.',
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: null,
    fehler: null,
    publiziert_am: null,
    publiziert_durch: null,
    revision_hinweis: null,
    erscheint_am: null,
    date_created: '2026-09-20',
    gemeinde: { id: 'g1', name: 'Pratteln', bezirk: 'Liestal' },
    lauf: null,
    spiel: null,
    kandidat: null,
    amtsblattmeldung: null,
    gemeindemitteilung: null,
    veranstaltung: { id: 'a' },
    sendungskandidat: null,
    suedanflugquote: null,
    abstimmung: null,
    perle: null,
    ...ueber
  }
}

const HEUTE = '2026-09-20'

describe('Veranstaltungen', () => {
  it('zeigt einen Vorschlag mit Anker, Terminen und Begruendung — und die Meldung, sobald eine dasteht', () => {
    const { rerender } = render(
      <Veranstaltungen anlaesse={[anlass()]} quellen={[quelle()]} gemeinden={[gemeinde()]} heute={HEUTE} />
    )
    expect(screen.getByText('Markt des Alterns')).toBeInTheDocument()
    expect(screen.getByText('Einmalig')).toBeInTheDocument()
    expect(screen.getByText(/25\. September 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Kultur- und Sportzentrum/)).toBeInTheDocument()
    expect(screen.getByText('Anlass der Gemeinde, offen für alle.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Anlass im Kalender/ })).toHaveAttribute(
      'href',
      'https://www.pratteln.ch/_rte/anlass/7353004'
    )

    rerender(
      <Veranstaltungen
        anlaesse={[anlass({ entscheid: 'uebernommen' })]}
        quellen={[quelle()]}
        gemeinden={[gemeinde()]}
        meldungen={[meldung()]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText('Pratteln lädt zum Markt des Alterns')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Meldung schreiben' })).not.toBeInTheDocument()
  })

  // Eine Zeile ist eine SERIE. Dass drei Termine dahinterstehen, muss auf der
  // Zeile stehen — sonst liest die Redaktion einen Einzeltermin.
  it('nennt die Termine einer Serie in einer Zeile und deklariert den Rest', () => {
    render(
      <Veranstaltungen
        anlaesse={[
          anlass({
            titel: 'Eltern-Kind-Café',
            termine: ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24'],
            von: '2026-10-03',
            anker: 'erinnerung',
            anker_am: '2026-10-03'
          })
        ]}
        quellen={[quelle()]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText(/3\., 10\., 17\. Oktober 2026 \(\+1 weitere\)/)).toBeInTheDocument()
    expect(screen.getByText('Erinnerung')).toBeInTheDocument()
  })

  it('stellt die Traktanden eines Gremiums offen hin und verlinkt die Sitzung', () => {
    render(
      <Veranstaltungen
        anlaesse={[
          anlass({
            titel: 'Einwohnerrat',
            anker: 'gremium',
            traktanden: ['Schnellzugshalt Pratteln', 'Feuerwerksverbot'],
            traktanden_url: 'https://www.pratteln.ch/sitzung/42'
          })
        ]}
        quellen={[quelle()]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText('Schnellzugshalt Pratteln')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Traktanden der Sitzung/ })).toHaveAttribute(
      'href',
      'https://www.pratteln.ch/sitzung/42'
    )
  })

  // Der eigentliche Grund fuer den eigenen Tisch: die Routine ist kein Abfall,
  // sondern eine Warteschlange mit einem Schalter.
  it('faltet die Routine weg und bietet dort den Dauerangebot-Schalter', async () => {
    const onDauerangebot = jest.fn().mockResolvedValue(undefined)
    render(
      <Veranstaltungen
        anlaesse={[
          anlass({
            id: 'jass',
            titel: 'Jassen im Bürgerhaus',
            anker: 'routine',
            anker_am: null,
            vorschlag: null,
            rhythmus: 'woechentlich'
          })
        ]}
        quellen={[quelle()]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
        onDauerangebot={onDauerangebot}
      />
    )
    expect(screen.queryByText('Jassen im Bürgerhaus')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Routine \(1\) anzeigen/ }))
    expect(screen.getByText('Jassen im Bürgerhaus')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Jetzt vorschlagen' }))
    expect(onDauerangebot).toHaveBeenCalledWith('jass', 'jetzt')

    await userEvent.click(screen.getByRole('combobox', { name: 'Dauerangebot' }))
    await userEvent.click(screen.getByRole('option', { name: 'Alle sechs Monate erinnern' }))
    expect(onDauerangebot).toHaveBeenLastCalledWith('jass', 'intervall')
  })

  it('fragt beim Ablehnen nach dem Grund und gibt den Kommentar weiter', async () => {
    const onAblehnen = jest.fn().mockResolvedValue(undefined)
    render(
      <Veranstaltungen
        anlaesse={[anlass()]}
        quellen={[quelle()]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
        onAblehnen={onAblehnen}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Kommentar'), 'Findet in Basel statt.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ablehnen' }))

    expect(onAblehnen).toHaveBeenCalledWith('a', 'nicht_relevant', 'Findet in Basel statt.')
  })

  // Eine Absenz darf nie wie „hier ist nichts los" aussehen: fehlender
  // Kalender, gescheiterter Kalender und erfasster Kalender ohne Leser sind
  // drei verschiedene Aussagen.
  it('haelt fehlenden Kalender, Lesefehler und fehlenden Leser auseinander', () => {
    render(
      <Veranstaltungen
        anlaesse={[]}
        quellen={[
          quelle({ id: 'kaputt', name: 'Kalender Muttenz', letzter_fehler: 'Zeitüberschreitung' }),
          quelle({ id: 'z7', name: 'Z7 Pratteln', art: 'ort', aktiv: false })
        ]}
        gemeinden={[gemeinde(), gemeinde({ id: 'g2', name: 'Riehen' })]}
        heute={HEUTE}
        onZuGemeinden={jest.fn()}
      />
    )
    expect(screen.getByText(/Zeitüberschreitung/)).toBeInTheDocument()
    expect(screen.getByText(/Ohne Kalender kommen keine Anlässe/)).toBeInTheDocument()
    expect(screen.getByText(/Riehen/)).toBeInTheDocument()
    expect(screen.getByText(/noch ohne Leser/)).toBeInTheDocument()
    expect(screen.getByText(/Nichts auf dem Tisch/)).toBeInTheDocument()
  })

  it('sagt, was der letzte Lauf brachte', () => {
    render(
      <Veranstaltungen
        anlaesse={[]}
        quellen={[quelle()]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
        lauf={{
          laeuft: false,
          gestartet_um: '2026-09-20T11:00:00Z',
          beendet_um: '2026-09-20T11:04:00Z',
          ergebnis: { quellen: 9, anlaesse: 214, anlaesseVorschlaege: 7, dauerangeboteWarten: 23 },
          fehler: null
        }}
      />
    )
    expect(screen.getByText(/214 Anlässe/)).toBeInTheDocument()
    expect(screen.getByText(/23 Dauerangebote warten/)).toBeInTheDocument()
  })
})
