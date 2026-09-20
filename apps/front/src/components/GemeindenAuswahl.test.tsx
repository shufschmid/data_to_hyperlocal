import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  EntsorgungskalenderFelder,
  GemeindeFelder,
  VeranstaltungsquelleFelder,
  VereinFelder,
  WochenblattFelder
} from '@/graphql/redaktion'
import { GemeindenAuswahl } from './GemeindenAuswahl'

function gemeinde(ueber: Partial<GemeindeFelder>): GemeindeFelder {
  return {
    id: 'g',
    name: 'Ort',
    bezirk: 'Liestal',
    bfs_nummer: 1,
    plz: null,
    news_url: null,
    news_letzte_pruefung: null,
    news_letzter_fehler: null,
    news_letzter_hinweis: null,
    suedanflug: false,
    aktiv: true,
    ...ueber
  }
}

function kalenderquelle(ueber: Partial<VeranstaltungsquelleFelder>): VeranstaltungsquelleFelder {
  return {
    id: 'q1',
    name: 'Veranstaltungskalender der Gemeinde Aesch',
    url: 'https://www.aesch.bl.ch/anlaesseaktuelles',
    art: 'gemeinde',
    plattform: 'iweb_termine',
    aktiv: true,
    letzte_pruefung: '2026-09-20T11:00:00Z',
    letzter_fehler: null,
    letzter_hinweis: null,
    gemeinde: { id: 'a', name: 'Aesch' },
    ...ueber
  }
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
    externe_id: null,
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

const portalBl = {
  id: 'q-bl',
  name: 'Statistik Basel-Landschaft (data.bl.ch)',
  typ: 'ods',
  konfiguration: { bezirke: ['Arlesheim', 'Laufen', 'Liestal', 'Sissach', 'Waldenburg'] }
}

const portalBs = {
  id: 'q-bs',
  name: 'Statistik Basel-Stadt (data.bs.ch)',
  typ: 'ods',
  konfiguration: { bezirke: ['Basel-Stadt'] }
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

  // Die Statistik-Quellen sind kantonal, und welcher Bezirk zu welchem Portal
  // gehoert, steht in den Quellen-Zeilen. Riehen bekommt ohne ein Portal fuer
  // Basel-Stadt keine Statistik-Meldung — das gehoert auf die Karte, nicht
  // ins Warten.
  it('nennt das Portal, das den Bezirk der Gemeinde fuehrt', () => {
    render(<GemeindenAuswahl gemeinden={drei} portale={[portalBl]} onUmschalten={jest.fn()} />)

    expect(
      screen.getByText(/Kein registriertes Statistikportal führt den Bezirk Basel-Stadt/)
    ).toBeInTheDocument()
    expect(screen.getAllByText(/Läuft automatisch über Statistik Basel-Landschaft/)).toHaveLength(1)
  })

  // Der zweite Nutzen von M2: Riehen bekommt Statistik, sobald ein Portal
  // fuer Basel-Stadt registriert ist — eine Zeile, kein Commit.
  it('nennt auch ein zweites Portal, sobald es den Bezirk fuehrt', () => {
    render(<GemeindenAuswahl gemeinden={drei} portale={[portalBl, portalBs]} onUmschalten={jest.fn()} />)

    expect(screen.queryByText(/Kein registriertes Statistikportal/)).not.toBeInTheDocument()
    expect(screen.getByText(/Läuft automatisch über Statistik Basel-Stadt/)).toBeInTheDocument()
  })

  // Ohne konfigurierte Portale verspricht die Karte nichts: Schweigen einer
  // Quelle ist keine Zusage.
  it('verspricht ohne konfigurierte Portale keine Statistik', () => {
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} />)

    expect(screen.queryByText(/Läuft automatisch über/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/Kein registriertes Statistikportal/)).toHaveLength(2)
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

  // Basketball wird pro GRUPPE gelesen, und eine Gruppe traegt mehrere unserer
  // Vereine. Ohne Adresse und Mannschaftskennung waere der Verein erfasst und
  // fuer immer still — das Formular laesst ihn darum gar nicht erst speichern.
  it('verlangt fuer Basketball Gruppenadresse und Mannschaftskennung', async () => {
    const onVerein = jest.fn().mockResolvedValue(undefined)
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} onVerein={onVerein} />)

    await userEvent.click(screen.getAllByRole('button', { name: 'Verein erfassen' })[0]!)
    await userEvent.type(screen.getByLabelText('Name'), 'BC Neu')
    await userEvent.click(screen.getByRole('combobox', { name: 'Resultat-Quelle' }))
    await userEvent.click(screen.getByRole('option', { name: /Swiss Basketball/ }))

    expect(screen.getByRole('button', { name: 'Erfassen' })).toBeDisabled()

    // Eingefuegt statt getippt: die Adresse ist 78 Zeichen lang, und
    // `type` feuert je Zeichen ein Ereignis — auf dem CI-Laeufer reichte das,
    // um den 5-Sekunden-Deckel von Jest zu reissen.
    await userEvent.click(screen.getByLabelText('Ergebnis-Adresse'))
    await userEvent.paste('https://swiss.basketball/basketplan/showLeagueSchedule.do?leagueHoldingId=11329')
    expect(screen.getByRole('button', { name: 'Erfassen' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Mannschaftskennung an der Quelle'), '515')
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }))

    expect(onVerein).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ quelle: 'basketball', externe_id: '515' }),
      null
    )
  })

  it('fragt die Mannschaftskennung nur, wo sie gebraucht wird', async () => {
    render(<GemeindenAuswahl gemeinden={drei} onUmschalten={jest.fn()} onVerein={jest.fn()} />)

    await userEvent.click(screen.getAllByRole('button', { name: 'Verein erfassen' })[0]!)

    expect(screen.queryByLabelText('Mannschaftskennung an der Quelle')).not.toBeInTheDocument()
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

  // Ein Kalender ist eine ZEILE, keine Spalte: gemessen im September 2026
  // fuehren Aesch und Allschwil auf ihrer eigenen Seite nur Amtliches, das
  // Dorfleben liegt auf Crossiety beziehungsweise kallaender.ch, und Riehen
  // hat gar keinen Gemeindekalender.
  it('listet die Kalender einer Gemeinde samt Statuszeile', () => {
    render(
      <GemeindenAuswahl
        gemeinden={[gemeinde({ id: 'a', name: 'Aesch' })]}
        quellen={[
          kalenderquelle({}),
          kalenderquelle({
            id: 'q2',
            name: 'Crossiety Aesch',
            url: 'https://crossiety.app/dorfplatz/aesch/agenda',
            art: 'plattform',
            aktiv: false,
            letzte_pruefung: null
          })
        ]}
        onUmschalten={jest.fn()}
      />
    )

    expect(screen.getByRole('link', { name: 'Veranstaltungskalender der Gemeinde Aesch' })).toHaveAttribute(
      'href',
      'https://www.aesch.bl.ch/anlaesseaktuelles'
    )
    expect(screen.getByRole('link', { name: 'Crossiety Aesch' })).toBeInTheDocument()
    expect(screen.getByText('noch kein Leser')).toBeInTheDocument()
    expect(screen.getByText(/Zuletzt gelesen/)).toBeInTheDocument()
  })

  it('nennt einen deklarierten Deckel als Information neben der Gemeindeseite', () => {
    render(
      <GemeindenAuswahl
        gemeinden={[
          gemeinde({
            id: 'a',
            name: 'Aesch',
            news_url: 'https://www.aesch.bl.ch/aktuellesinformationen',
            news_letzter_hinweis: '96 weitere neue Mitteilungen nicht gelesen — morgen weiter'
          })
        ]}
        onUmschalten={jest.fn()}
      />
    )

    const zeile = screen.getByText(/96 weitere neue Mitteilungen nicht gelesen/)
    const kasten = zeile.closest('.MuiAlert-root')
    expect(kasten?.className).toMatch(/Info/)
    expect(kasten?.className).not.toMatch(/Warning|Error/)
    expect(screen.queryByText(/Letzter Lauf gescheitert/)).not.toBeInTheDocument()
  })

  it('sagt es, wenn kein Kalender erfasst ist', () => {
    render(<GemeindenAuswahl gemeinden={[gemeinde({ id: 'a', name: 'Aesch' })]} onUmschalten={jest.fn()} />)

    expect(screen.getByText(/Kein Kalender erfasst/i)).toBeInTheDocument()
  })

  it('reicht einen neuen Kalender mit seiner Art an den Endpunkt weiter', async () => {
    const onKalenderErfassen = jest.fn().mockResolvedValue(null)
    render(
      <GemeindenAuswahl
        gemeinden={[gemeinde({ id: 'a', name: 'Aesch' })]}
        onUmschalten={jest.fn()}
        onKalenderErfassen={onKalenderErfassen}
      />
    )

    await userEvent.type(
      screen.getByLabelText('Adresse des Kalenders'),
      'https://www.aesch.bl.ch/anlaesseaktuelles'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Kalender erfassen' }))

    expect(onKalenderErfassen).toHaveBeenCalledWith('a', {
      url: 'https://www.aesch.bl.ch/anlaesseaktuelles',
      name: null,
      art: 'gemeinde'
    })
  })

  // Gemessen am 20. September 2026 an Riehen: der Kalender liegt auf einer
  // eigenen Domain, wird als Gemeindekalender abgewiesen — und die Absage
  // stand in der Fehlerzeile zuoberst an der Seite, die niemand sieht, der
  // unten in einer Karte klickt. Der Knopf galt als kaputt.
  it('sagt in der Karte, warum ein Kalender abgewiesen wurde', async () => {
    const onKalenderErfassen = jest
      .fn()
      .mockResolvedValue(
        'Kalender nicht lesbar: Seitenaufbau nicht erkannt (keine der bekannten Plattformen)'
      )
    render(
      <GemeindenAuswahl
        gemeinden={[gemeinde({ id: 'a', name: 'Riehen' })]}
        onUmschalten={jest.fn()}
        onKalenderErfassen={onKalenderErfassen}
      />
    )

    await userEvent.type(screen.getByLabelText('Adresse des Kalenders'), 'https://www.riehenevents.ch/')
    await userEvent.click(screen.getByRole('button', { name: 'Kalender erfassen' }))

    expect(await screen.findByText(/Seitenaufbau nicht erkannt/)).toBeInTheDocument()
    // Und sie sagt, was stattdessen geht.
    expect(screen.getByText(/eigenen Adresse/)).toBeInTheDocument()
    // Die Eingabe bleibt stehen, damit die Art nur umgestellt werden muss.
    expect(screen.getByLabelText('Adresse des Kalenders')).toHaveValue('https://www.riehenevents.ch/')
  })

  // Ein abgeschalteter Kalender verschwindet nicht — sonst waere er weg statt
  // aus, und niemand koennte ihn zurueckholen.
  it('schaltet einen Kalender aus und entfernt ihn auf Wunsch', async () => {
    const onKalenderSchalten = jest.fn().mockResolvedValue(undefined)
    const onKalenderLoeschen = jest.fn().mockResolvedValue(undefined)
    render(
      <GemeindenAuswahl
        gemeinden={[gemeinde({ id: 'a', name: 'Aesch' })]}
        quellen={[kalenderquelle({})]}
        onUmschalten={jest.fn()}
        onKalenderSchalten={onKalenderSchalten}
        onKalenderLoeschen={onKalenderLoeschen}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Ausschalten' }))
    expect(onKalenderSchalten).toHaveBeenCalledWith('q1', false)

    await userEvent.click(screen.getByRole('button', { name: 'Entfernen' }))
    expect(onKalenderLoeschen).toHaveBeenCalledWith('q1')
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
