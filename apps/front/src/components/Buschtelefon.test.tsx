import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  AlleMeldungFelder,
  BuschtelefonFundFelder,
  BuschtelefonQuelleFelder,
  GemeindeFelder
} from '@/graphql/redaktion'
import { Buschtelefon } from './Buschtelefon'

function fund(ueber: Partial<BuschtelefonFundFelder> = {}): BuschtelefonFundFelder {
  return {
    id: 'f1',
    status: 'aktiv',
    kanal: 'facebook',
    quelle: 'fb-gruppe:1234567890',
    quelle_name: 'Du bisch vo Aesch, wenn …',
    quelle_art: 'gruppe',
    quelle_sichtbarkeit: 'oeffentlich',
    quelle_url: 'https://www.facebook.com/groups/1234567890',
    gemeinde: { id: 'g1', name: 'Aesch' },
    link: 'https://www.facebook.com/groups/1234567890/posts/987654321',
    veroeffentlicht_am: '2026-11-08T19:42:00+01:00',
    veroeffentlicht_tag: '2026-11-08',
    datum_genauigkeit: 'minute',
    autor_art: 'profil',
    autor_rolle: null,
    autor_name: null,
    autor_vorname: 'Sandra',
    autor_ref: 'A',
    text: 'Weiss jemand, warum die Hauptstrasse seit heute gesperrt ist?',
    text_abgeschnitten: false,
    bilder: [
      {
        nr: 1,
        art: 'flyer',
        text_status: 'gelesen',
        text: 'Räbeliechtli-Umzug\nFreitag, 13. November 2026, 18 Uhr',
        beschreibung: 'Flyer mit Laternen-Zeichnung'
      },
      { nr: 2, art: 'foto', text_status: 'zurueckgehalten', text: null }
    ],
    n_bilder: 2,
    verlinkt: [{ url: 'https://www.aesch.bl.ch/baustelle', titel: 'Baustelleninfo Hauptstrasse' }],
    geteilt: null,
    kommentare: [
      {
        kennung: 'k1',
        stand: 'sichtbar',
        erstmals_freigegeben_am: '2026-11-09T11:51:55+01:00',
        antwort_auf: null,
        autor_ref: 'B',
        autor_vorname: 'Marc',
        text: 'Wasserleitungsbruch, die IWB ist dran.'
      },
      {
        kennung: 'k2',
        stand: 'sichtbar',
        erstmals_freigegeben_am: '2026-11-11T11:52:10+01:00',
        antwort_auf: 'k1',
        autor_ref: 'C',
        autor_vorname: null,
        text: 'Seit dem Mittag wieder offen.'
      },
      {
        kennung: 'k3',
        stand: 'nicht_mehr_gesehen',
        erstmals_freigegeben_am: '2026-11-09T11:51:55+01:00',
        antwort_auf: null,
        autor_ref: 'D',
        autor_vorname: 'Ruth',
        text: 'Typisch.'
      }
    ],
    kommentare_stand: 'vollstaendig',
    kommentare_fehlend: 0,
    n_kommentare: 3,
    n_reaktionen: 12,
    n_geteilt: 0,
    doublette_von: null,
    erstmals_freigegeben_am: '2026-11-09T11:51:55+01:00',
    aktualisiert_am: '2026-11-11T12:00:20+01:00',
    neue_kommentare: 1,
    hinweise: null,
    vorschlag: true,
    vorschlag_wert: 3,
    vorschlag_begruendung: 'Eine Sperrung der Hauptstrasse betrifft viele.',
    entwurf_bedenken: null,
    entscheid: 'offen',
    ablehnungsgrund: null,
    material_geloescht_am: null,
    date_created: '2026-11-09T12:00:10+01:00',
    ...ueber
  }
}

function gemeinde(ueber: Partial<GemeindeFelder> = {}): GemeindeFelder {
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
    suedanflug: false,
    ...ueber
  }
}

function meldung(ueber: Partial<AlleMeldungFelder> = {}): AlleMeldungFelder {
  return {
    id: 'm-1',
    titel: 'Aesch: Hauptstrasse nach Leitungsbruch gesperrt',
    lead: 'In der Facebook-Gruppe «Du bisch vo Aesch, wenn …» wird über eine Sperrung berichtet.',
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
    date_created: '2026-11-11',
    gemeinde: { id: 'g1', name: 'Aesch', bezirk: 'Arlesheim' },
    lauf: null,
    spiel: null,
    kandidat: null,
    amtsblattmeldung: null,
    gemeindemitteilung: null,
    veranstaltung: null,
    sendungskandidat: null,
    suedanflugquote: null,
    abstimmung: null,
    buschtelefon_fund: { id: 'f1' },
    perle: null,
    ...ueber
  }
}

function quelle(ueber: Partial<BuschtelefonQuelleFelder> = {}): BuschtelefonQuelleFelder {
  return {
    id: 'q1',
    kennung: 'fb-gruppe:1234567890',
    kanal: 'facebook',
    art: 'gruppe',
    name: 'Du bisch vo Aesch, wenn …',
    url: 'https://www.facebook.com/groups/1234567890',
    sichtbarkeit: 'oeffentlich',
    zugang: 'ohne_anmeldung',
    aktiv: true,
    stand: 'gelesen',
    zuletzt_vollstaendig_gelesen_am: '2026-11-11T11:12:00+01:00',
    n_beitraege_gesehen: 14,
    n_aussortiert: 0,
    n_zu_alt: 0,
    n_ausgelassen: 0,
    fehler_seit: null,
    letzter_fehler: null,
    hinweise: [],
    ...ueber
  }
}

const GEMEINDEN = [gemeinde(), gemeinde({ id: 'g2', name: 'Reinach', bfs_nummer: 2773 })]

describe('Buschtelefon', () => {
  it('zeigt Gemeinde, Quelle, Stufe, neue Kommentare, Datum, Wortlaut, Begruendung und den Link zum Beitrag', () => {
    render(<Buschtelefon kanal="facebook" funde={[fund()]} gemeinden={GEMEINDEN} />)
    const zeile = screen.getByTestId('fund')
    expect(within(zeile).getByText('Aesch')).toBeInTheDocument()
    expect(within(zeile).getByText('Du bisch vo Aesch, wenn …')).toBeInTheDocument()
    expect(within(zeile).getByText('Stufe 3 · klare Meldung')).toBeInTheDocument()
    expect(within(zeile).getByText('1 neuer Kommentar')).toBeInTheDocument()
    expect(within(zeile).getByText(/8\. November 2026, 19:42 Uhr · von Sandra/)).toBeInTheDocument()
    expect(within(zeile).getByText(/warum die Hauptstrasse seit heute gesperrt ist/)).toBeInTheDocument()
    expect(within(zeile).getByText('Eine Sperrung der Hauptstrasse betrifft viele.')).toBeInTheDocument()
    expect(within(zeile).getByRole('link', { name: /Original-Beitrag öffnen/ })).toHaveAttribute(
      'href',
      'https://www.facebook.com/groups/1234567890/posts/987654321'
    )
    expect(within(zeile).getByRole('link', { name: 'Baustelleninfo Hauptstrasse' })).toHaveAttribute(
      'href',
      'https://www.aesch.bl.ch/baustelle'
    )
    // Eine oeffentliche Gruppe traegt keine Warnung.
    expect(screen.queryByText('Geschlossene Gruppe')).not.toBeInTheDocument()
  })

  it('sagt bei einer geschlossenen Gruppe unuebersehbar, dass die Meldung nur die Gruppe verlinkt', () => {
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund({ quelle_sichtbarkeit: 'geschlossen' })]}
        gemeinden={GEMEINDEN}
      />
    )
    expect(screen.getByText('Geschlossene Gruppe')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Aus einer geschlossenen Gruppe: Der Link zum Beitrag ist nur zur Überprüfung; eine Meldung verlinkt nur die Gruppe.'
      )
    ).toBeInTheDocument()
    // Der Link zum Beitrag bleibt am Tisch — zur Ueberpruefung.
    expect(screen.getByRole('link', { name: /Original-Beitrag öffnen/ })).toBeInTheDocument()
  })

  it('behandelt eine unbekannte Sichtbarkeit wie eine geschlossene Gruppe', () => {
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund({ quelle_sichtbarkeit: 'unbekannt' })]}
        gemeinden={GEMEINDEN}
      />
    )
    expect(screen.getByText('Sichtbarkeit der Gruppe unbekannt')).toBeInTheDocument()
    expect(screen.getByText(/eine Meldung verlinkt nur die Gruppe/)).toBeInTheDocument()
  })

  it('zeigt jedes Bild als eigenen Block: den gelesenen Text, sonst den Zustand in Worten', () => {
    render(<Buschtelefon kanal="facebook" funde={[fund()]} gemeinden={GEMEINDEN} />)
    expect(screen.getByText('Bild 1 · Flyer · Flyer mit Laternen-Zeichnung')).toBeInTheDocument()
    expect(screen.getByText(/Räbeliechtli-Umzug/)).toBeInTheDocument()
    expect(screen.getByText('Bild 2 · Foto · bewusst nicht gelesen')).toBeInTheDocument()
  })

  it('klappt die Kommentare auf: Vorname oder «Person C», Antwort eingerueckt, Neues markiert, Verschwundenes benannt', async () => {
    render(<Buschtelefon kanal="facebook" funde={[fund()]} gemeinden={GEMEINDEN} />)
    expect(screen.queryByText(/Wasserleitungsbruch/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Kommentare (3)' }))
    const kommentare = screen.getAllByTestId('kommentar')
    expect(kommentare).toHaveLength(3)
    expect(within(kommentare[0]!).getByText('Marc')).toBeInTheDocument()
    expect(within(kommentare[0]!).getByText(/Wasserleitungsbruch/)).toBeInTheDocument()
    expect(kommentare[0]).toHaveAttribute('data-tiefe', '0')
    expect(within(kommentare[1]!).getByText('Person C')).toBeInTheDocument()
    expect(kommentare[1]).toHaveAttribute('data-tiefe', '1')
    expect(within(kommentare[1]!).getByText('neu')).toBeInTheDocument()
    expect(within(kommentare[0]!).queryByText('neu')).not.toBeInTheDocument()
    expect(within(kommentare[2]!).getByText('nicht mehr gesehen')).toBeInTheDocument()
  })

  it('zeigt den geteilten Beitrag getrennt vom eigenen Text', () => {
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[
          fund({
            text: 'Achtung!',
            geteilt: {
              link: 'https://www.facebook.com/polizeibl/posts/1',
              quelle_name: 'Polizei Basel-Landschaft',
              autor_rolle: 'behoerde',
              autor_name: 'Polizei Basel-Landschaft',
              text: 'Die Polizei sucht Zeugen eines Unfalls in Aesch.'
            }
          })
        ]}
        gemeinden={GEMEINDEN}
      />
    )
    expect(screen.getByText('Geteilter Beitrag · Polizei Basel-Landschaft')).toBeInTheDocument()
    expect(screen.getByText('Die Polizei sucht Zeugen eines Unfalls in Aesch.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Geteilten Beitrag öffnen' })).toHaveAttribute(
      'href',
      'https://www.facebook.com/polizeibl/posts/1'
    )
  })

  it('macht aus dem geteilten Beitrag einer nicht zugeordneten Seite keine Privatperson', () => {
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[
          fund({
            text: 'Kommt alle!',
            geteilt: {
              link: null,
              quelle_name: null,
              autor_art: 'seite',
              autor_rolle: null,
              autor_name: null,
              text: 'Herbstmarkt am Samstag, 14. November 2026, auf dem Dorfplatz.'
            }
          })
        ]}
        gemeinden={GEMEINDEN}
      />
    )
    expect(screen.getByText('Geteilter Beitrag · einer Seite (nicht zugeordnet)')).toBeInTheDocument()
    expect(screen.queryByText(/Geteilter Beitrag.*Privatperson/)).not.toBeInTheDocument()
  })

  it('markiert Doublette, nicht erreichbares Original und die Hinweise der Zeile', () => {
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[
          fund({
            doublette_von: 'fb:1_2',
            status: 'nicht_erreichbar',
            n_bilder: 5,
            hinweise: ['Kommentare gedeckelt: 20 fehlen']
          })
        ]}
        gemeinden={GEMEINDEN}
      />
    )
    expect(screen.getByText('Doublette')).toBeInTheDocument()
    expect(screen.getByText('Original nicht erreichbar')).toBeInTheDocument()
    expect(
      screen.getByText(/Kommentare gedeckelt: 20 fehlen · 2 von 5 Bildern geliefert/)
    ).toBeInTheDocument()
  })

  it('verlangt eine Gemeinde, bevor eine Meldung geschrieben wird, und reicht die Zuordnung durch', async () => {
    const onGemeinde = jest.fn().mockResolvedValue(undefined)
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund({ gemeinde: null })]}
        gemeinden={GEMEINDEN}
        onGemeinde={onGemeinde}
      />
    )
    expect(screen.getByText('Gemeinde fehlt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Meldung schreiben' })).toBeDisabled()
    await userEvent.click(screen.getByRole('combobox', { name: 'Gemeinde zuordnen' }))
    await userEvent.click(screen.getByRole('option', { name: 'Reinach' }))
    expect(onGemeinde).toHaveBeenCalledWith('f1', 'g2')
  })

  it('reicht die drei Entscheide durch', async () => {
    const onUebernehmen = jest.fn().mockResolvedValue(undefined)
    const onAblehnen = jest.fn().mockResolvedValue(undefined)
    const onWeiterreichen = jest.fn().mockResolvedValue(undefined)
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund()]}
        gemeinden={GEMEINDEN}
        onUebernehmen={onUebernehmen}
        onAblehnen={onAblehnen}
        onWeiterreichen={onWeiterreichen}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Meldung schreiben' }))
    expect(onUebernehmen).toHaveBeenCalledWith('f1')

    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))
    const ablehnen = screen.getByRole('dialog')
    expect(within(ablehnen).getByText(/warum die Hauptstrasse/)).toBeInTheDocument()
    await userEvent.click(within(ablehnen).getByRole('combobox', { name: 'Grund' }))
    await userEvent.click(screen.getByRole('option', { name: 'Nicht zu bestätigen' }))
    await userEvent.type(within(ablehnen).getByRole('textbox', { name: 'Kommentar' }), 'Nur Gerücht.')
    await userEvent.click(within(ablehnen).getByRole('button', { name: 'Ablehnen' }))
    expect(onAblehnen).toHaveBeenCalledWith('f1', 'unbestaetigt', 'Nur Gerücht.')
  })

  it('reicht an die Chefredaktion weiter, die Begruendung ist freiwillig', async () => {
    const onWeiterreichen = jest.fn().mockResolvedValue(undefined)
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund()]}
        gemeinden={GEMEINDEN}
        onWeiterreichen={onWeiterreichen}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'An Chefredaktion' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Weiterreichen' }))
    expect(onWeiterreichen).toHaveBeenCalledWith('f1', null)
  })

  it('gibt eigene Angaben als Koerper an denselben Weg', async () => {
    const onUebernehmen = jest.fn().mockResolvedValue(undefined)
    render(
      <Buschtelefon kanal="facebook" funde={[fund()]} gemeinden={GEMEINDEN} onUebernehmen={onUebernehmen} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Mit eigenen Angaben' }))
    await userEvent.type(screen.getByLabelText('Ergänzende Angaben'), 'Gemeinde bestätigt die Sperrung.')
    await userEvent.click(screen.getByRole('button', { name: 'Meldung schreiben lassen' }))
    expect(onUebernehmen).toHaveBeenCalledWith('f1', { ergaenzung: 'Gemeinde bestätigt die Sperrung.' })
  })

  it('zeigt den Entwurf des Laufs auf der Zeile, die Vorbehalte darueber, und laesst die Entscheide stehen', () => {
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund({ entwurf_bedenken: 'Die Ursache nennt nur ein Kommentar.' })]}
        gemeinden={GEMEINDEN}
        meldungen={[meldung()]}
      />
    )
    expect(screen.getByText('Aesch: Hauptstrasse nach Leitungsbruch gesperrt')).toBeInTheDocument()
    expect(
      screen.getByText('Vorbehalt beim Schreiben des Entwurfs: Die Ursache nennt nur ein Kommentar.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Meldung schreiben' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ablehnen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'An Chefredaktion' })).toBeInTheDocument()
  })

  it('sagt auf einer Zeile ohne Entwurf, dass der Schreiber nichts fand', () => {
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund({ entwurf_bedenken: 'Kein Entwurf: Der Schreiber fand im Material keine Meldung.' })]}
        gemeinden={GEMEINDEN}
      />
    )
    expect(
      screen.getByText(
        'Kein Entwurf: Der Schreiber fand im Material keine Meldung. Mit eigenen Angaben lässt sich die Meldung trotzdem schreiben.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/Vorbehalt beim Schreiben/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mit eigenen Angaben' })).toBeInTheDocument()
  })

  it('bietet Ablehnen und Weiterreichen nur an, wo der Endpunkt sie annimmt', () => {
    const { rerender } = render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund({ entscheid: 'uebernommen' })]}
        gemeinden={GEMEINDEN}
        meldungen={[meldung()]}
      />
    )
    // Uebernommen, die Meldung ein Entwurf: ablehnen ja, weiterreichen nein.
    expect(screen.getByRole('button', { name: 'Ablehnen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'An Chefredaktion' })).not.toBeInTheDocument()

    rerender(
      <Buschtelefon
        kanal="facebook"
        funde={[fund({ entscheid: 'uebernommen' })]}
        gemeinden={GEMEINDEN}
        meldungen={[meldung({ status: 'in_pruefung' })]}
      />
    )
    // In der Gegenpruefung: der Fund verschwaende mit dem Entscheid, die Meldung mit ihm.
    expect(screen.queryByRole('button', { name: 'Ablehnen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'An Chefredaktion' })).not.toBeInTheDocument()
    expect(screen.getByText(/über sie wird jetzt auf ihrer Karte entschieden/)).toBeInTheDocument()
  })

  it('laesst die Zeile los, sobald ihre Meldung publiziert ist', () => {
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund({ entscheid: 'uebernommen' })]}
        gemeinden={GEMEINDEN}
        meldungen={[meldung({ status: 'publiziert' })]}
      />
    )
    expect(screen.getByText(/Nichts auf dem Tisch/)).toBeInTheDocument()
  })

  it('faltet die Uebrigen weg, ohne sie zu verstecken, und folgt der Schwelle des Tischs', async () => {
    const funde = [fund(), fund({ id: 'f2', text: 'Verkaufe Kinderwagen', vorschlag_wert: 1 })]
    const { rerender } = render(<Buschtelefon kanal="facebook" funde={funde} gemeinden={GEMEINDEN} />)
    expect(screen.getByText('1 vorgeschlagen')).toBeInTheDocument()
    expect(screen.queryByText('Verkaufe Kinderwagen')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Übrige 1 anzeigen — nichts wird weggeworfen/ }))
    expect(screen.getByText('Verkaufe Kinderwagen')).toBeInTheDocument()

    rerender(<Buschtelefon kanal="facebook" funde={funde} gemeinden={GEMEINDEN} schwelle={1} />)
    expect(screen.getByText('2 vorgeschlagen')).toBeInTheDocument()
  })

  it('zeigt einen entfernten Beitrag ohne Material und ohne Entscheide', async () => {
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[
          fund({
            status: 'entfernt',
            text: null,
            bilder: [],
            verlinkt: [],
            kommentare: [],
            link: null,
            material_geloescht_am: '2026-11-11T12:00:20+01:00',
            hinweise: ['Original nicht mehr auffindbar']
          })
        ]}
        gemeinden={GEMEINDEN}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Übrige 1 anzeigen/ }))
    expect(screen.getAllByText(/Original nicht mehr auffindbar/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Das Rohmaterial dieses Fundes ist gelöscht/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Meldung schreiben' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ablehnen' })).not.toBeInTheDocument()
  })

  it('sagt fuer Instagram und TikTok, dass noch nichts geliefert wird', () => {
    const { rerender } = render(<Buschtelefon kanal="instagram" funde={[fund()]} gemeinden={GEMEINDEN} />)
    expect(screen.getByText('Das Buschtelefon liefert für diesen Kanal noch nichts.')).toBeInTheDocument()
    expect(screen.queryByTestId('fund')).not.toBeInTheDocument()
    rerender(<Buschtelefon kanal="tiktok" funde={[]} gemeinden={GEMEINDEN} />)
    expect(screen.getByText('Das Buschtelefon liefert für diesen Kanal noch nichts.')).toBeInTheDocument()
    rerender(<Buschtelefon kanal="facebook" funde={[]} gemeinden={GEMEINDEN} />)
    expect(screen.getByText(/Nichts auf dem Tisch/)).toBeInTheDocument()
  })

  it('startet den Abruf, zeigt das letzte Ergebnis und den Hinweis auf die fehlende Freigabe', async () => {
    const onLauf = jest.fn()
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund()]}
        gemeinden={GEMEINDEN}
        onLauf={onLauf}
        stand={{
          freigabe: { tag: '2026-11-10' },
          letzter_abruf: '2026-11-11T11:00:00Z',
          letzter_fehler: null,
          letzter_hinweis: 'Heute noch keine Freigabe des Buschtelefons (letzte: 10. November 2026).',
          ergebnis: null
        }}
        lauf={{
          laeuft: false,
          gestartet_um: '2026-11-11T11:00:00Z',
          beendet_um: '2026-11-11T11:03:00Z',
          ergebnis: { gelesen: 5, neu: 2, ersetzt: 1, gesichtet: 3, entwuerfe: 1 },
          fehler: null
        }}
      />
    )
    expect(
      screen.getByText('Heute noch keine Freigabe des Buschtelefons (letzte: 10. November 2026).')
    ).toBeInTheDocument()
    expect(screen.getByText(/Letzter Abruf um 12:03 Uhr — 5 Funde gelesen, 2 neu/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Jetzt abholen' }))
    expect(onLauf).toHaveBeenCalledTimes(1)
  })

  it('zeigt den Lauf des Mittags aus dem Stand, auch wenn niemand den Knopf drueckte', () => {
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund()]}
        gemeinden={GEMEINDEN}
        stand={{
          freigabe: { tag: '2026-11-11' },
          letzter_abruf: '2026-11-11T11:00:00Z',
          letzter_fehler: 'Fund fb:9 ungültig geliefert',
          letzter_hinweis: null,
          ergebnis: {
            gelesen: 60,
            neu: 27,
            ersetzt: 0,
            gesichtet: 27,
            entwuerfe: 20,
            wartend: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
            fehler: ['Fund fb:9 ungültig geliefert'],
            hinweise: ['7 Entwürfe warten auf den nächsten Lauf (Deckel 20 je Lauf).']
          }
        }}
        lauf={{ laeuft: false, gestartet_um: null, beendet_um: null, ergebnis: null, fehler: null }}
      />
    )
    expect(
      screen.getByText(/Letzter Abruf um 12:00 Uhr — 60 Funde gelesen, 27 neu.*7 Entwürfe warten/)
    ).toBeInTheDocument()
    expect(
      screen.getByText('7 Entwürfe warten auf den nächsten Lauf (Deckel 20 je Lauf).')
    ).toBeInTheDocument()
    expect(screen.getByText('Fund fb:9 ungültig geliefert')).toBeInTheDocument()
    // Dieselben Fehler nicht ein zweites Mal als Zeile des Stands.
    expect(screen.queryByText(/Der letzte Abruf meldet/)).not.toBeInTheDocument()
  })

  it('sperrt den Knopf, solange der Abruf unterwegs ist, und sagt, wenn die Tuer nicht eingerichtet ist', () => {
    const { rerender } = render(
      <Buschtelefon
        kanal="facebook"
        funde={[]}
        gemeinden={GEMEINDEN}
        lauf={{
          laeuft: true,
          gestartet_um: '2026-11-11T11:00:00Z',
          beendet_um: null,
          ergebnis: null,
          fehler: null
        }}
      />
    )
    expect(screen.getByRole('button', { name: 'Abruf ist unterwegs …' })).toBeDisabled()
    rerender(
      <Buschtelefon
        kanal="facebook"
        funde={[]}
        gemeinden={GEMEINDEN}
        lauf={{
          laeuft: false,
          gestartet_um: null,
          beendet_um: null,
          ergebnis: null,
          fehler: null,
          eingerichtet: false,
          fehlend: ['BUSCHTELEFON_SCHLUESSEL']
        }}
      />
    )
    expect(screen.getByText(/nicht eingerichtet.*Es fehlt: BUSCHTELEFON_SCHLUESSEL\./)).toBeInTheDocument()
  })

  it('faltet die Quellenprobleme und das nicht Gelieferte je Quelle', async () => {
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund()]}
        gemeinden={GEMEINDEN}
        quellen={[
          quelle({ n_aussortiert: 3, n_zu_alt: 1 }),
          quelle({
            id: 'q2',
            name: 'Reinach live',
            stand: 'fehlgeschlagen',
            fehler_seit: '2026-11-09T11:02:00+01:00',
            letzter_fehler: 'Anmeldung abgelaufen'
          })
        ]}
      />
    )
    expect(screen.queryByText(/Anmeldung abgelaufen/)).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', {
        name: '1 Quelle nicht vollständig gelesen · nicht Geliefertes je Quelle — anzeigen'
      })
    )
    expect(
      screen.getByText('Reinach live: nicht gelesen seit 9. November 2026: Anmeldung abgelaufen')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Du bisch vo Aesch, wenn …: 3 aussortiert (ohne Inhalt), 1 zu alt von 14 gesehenen')
    ).toBeInTheDocument()
  })

  it('filtert nach Gemeinde, auch nach Funden ohne Gemeinde', async () => {
    render(
      <Buschtelefon
        kanal="facebook"
        funde={[fund(), fund({ id: 'f2', gemeinde: null, text: 'Flohmarkt im Birseck' })]}
        gemeinden={GEMEINDEN}
      />
    )
    expect(screen.getAllByTestId('fund')).toHaveLength(2)
    await userEvent.click(screen.getByRole('combobox', { name: 'Gemeinde' }))
    await userEvent.click(screen.getByRole('option', { name: 'Ohne Gemeinde' }))
    expect(screen.getAllByTestId('fund')).toHaveLength(1)
    expect(screen.getByText('Flohmarkt im Birseck')).toBeInTheDocument()
  })
})
