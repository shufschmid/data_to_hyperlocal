import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AlleMeldungFelder, GemeindeFelder, GemeindemitteilungFelder } from '@/graphql/redaktion'
import { Gemeindeseiten } from './Gemeindeseiten'

function eintrag(ueber: Partial<GemeindemitteilungFelder> = {}): GemeindemitteilungFelder {
  return {
    id: 'a',
    url: 'https://www.aesch.bl.ch/_rte/information/1',
    url_kanonisch: 'https://www.aesch.bl.ch/aktuellesinformationen/1',
    quelle_seite: 'https://www.aesch.bl.ch/aktuellesinformationen',
    titel: 'Aus der Gemeinderatssitzung vom 08. September 2026',
    teaser: 'Traktanden für die Gemeindeversammlung beschlossen.',
    publiziert_am: '2026-09-11',
    kategorie: 'politik_info',
    inhalt_typ: 'html',
    text: 'Der Gemeinderat hat die Traktanden beschlossen.\n\nWeiter wurde das Parkraumkonzept besprochen.',
    text_abgeschnitten: false,
    anhaenge: null,
    hinweise: null,
    gelesen_am: '2026-09-11T11:00:00Z',
    vorschlag: true,
    vorschlag_begruendung: 'Beschluss mit Wirkung über die Verwaltung hinaus.',
    entscheid: 'offen',
    ablehnungsgrund: null,
    date_created: '2026-09-11T11:00:00Z',
    gemeinde: { id: 'g1', name: 'Aesch' },
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
    news_url: 'https://www.aesch.bl.ch/aktuellesinformationen',
    news_letzte_pruefung: '2026-09-14T11:00:00Z',
    news_letzter_fehler: null,
    ...ueber
  }
}

const HEUTE = '2026-09-14'

function meldung(ueber: Partial<AlleMeldungFelder> = {}): AlleMeldungFelder {
  return {
    id: 'm-1',
    titel: 'Aesch legt die Traktanden der Gemeindeversammlung fest',
    lead: 'Wie die Gemeinde Aesch mitteilt …',
    text: 'Text.',
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: null,
    fehler: null,
    publiziert_am: null,
    publiziert_durch: null,
    revision_hinweis: null,
    erscheint_am: null,
    date_created: '2026-09-11',
    gemeinde: { id: 'g1', name: 'Aesch', bezirk: 'Arlesheim' },
    lauf: null,
    spiel: null,
    kandidat: null,
    amtsblattmeldung: null,
    gemeindemitteilung: { id: 'a' },
    sendungskandidat: null,
    perle: null,
    ...ueber
  }
}

describe('Gemeindeseiten', () => {
  it('haelt die Zeile und zeigt die Meldung, sobald eine geschrieben ist — und laesst sie nach der Publikation los', () => {
    const { rerender } = render(
      <Gemeindeseiten
        eintraege={[eintrag({ entscheid: 'uebernommen' })]}
        gemeinden={[gemeinde()]}
        meldungen={[meldung()]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText('Aesch legt die Traktanden der Gemeindeversammlung fest')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Meldung schreiben' })).not.toBeInTheDocument()

    rerender(
      <Gemeindeseiten
        eintraege={[eintrag({ entscheid: 'uebernommen' })]}
        gemeinden={[gemeinde()]}
        meldungen={[meldung({ status: 'publiziert' })]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText(/Nichts auf dem Tisch/)).toBeInTheDocument()
  })

  it('nennt die Begruendung der Sichtung, verlinkt die Unterseite und die Anhaenge — ungelesene mit Grund', () => {
    render(
      <Gemeindeseiten
        eintraege={[
          eintrag({
            text_abgeschnitten: true,
            hinweise: ['Text gekürzt'],
            anhaenge: [
              { bezeichnung: 'Protokoll', url: 'https://www.aesch.bl.ch/_doc/1', typ: 'pdf', gelesen: true },
              {
                bezeichnung: 'Kantonale Mitteilung',
                url: 'https://www.bl.ch/mm.pdf',
                typ: 'link',
                gelesen: false,
                grund: 'fremde_site'
              }
            ]
          })
        ]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText('Beschluss mit Wirkung über die Verwaltung hinaus.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Mitteilung auf der Gemeindeseite/ })).toHaveAttribute(
      'href',
      'https://www.aesch.bl.ch/aktuellesinformationen/1'
    )
    expect(screen.getByRole('link', { name: /^Protokoll/ })).toHaveAttribute(
      'href',
      'https://www.aesch.bl.ch/_doc/1'
    )
    expect(screen.getByRole('link', { name: /Kantonale Mitteilung/ })).toHaveTextContent(
      'nicht gelesen — fremde Website'
    )
    expect(screen.getByText('Text unvollständig gelesen')).toBeInTheDocument()
    expect(screen.getByText(/Mitteilung vom 11\. September 2026 · Text gekürzt/)).toBeInTheDocument()
  })

  it('zeigt den Originaltext erst auf Klick', async () => {
    render(<Gemeindeseiten eintraege={[eintrag()]} gemeinden={[gemeinde()]} heute={HEUTE} />)
    expect(screen.queryByText(/Parkraumkonzept/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Originaltext lesen' }))
    expect(screen.getByText(/Parkraumkonzept/)).toBeInTheDocument()
  })

  it('faltet die Uebrigen weg, ohne sie zu verstecken', async () => {
    render(
      <Gemeindeseiten
        eintraege={[
          eintrag(),
          eintrag({ id: 'b', titel: 'Öffnungszeiten über die Feiertage', vorschlag: false })
        ]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText('1 vorgeschlagen')).toBeInTheDocument()
    expect(screen.queryByText('Öffnungszeiten über die Feiertage')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Übrige 1 anzeigen/ }))
    expect(screen.getByText('Öffnungszeiten über die Feiertage')).toBeInTheDocument()
  })

  it('reicht Uebernehmen durch', async () => {
    const onUebernehmen = jest.fn().mockResolvedValue(undefined)
    render(
      <Gemeindeseiten
        eintraege={[eintrag()]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
        onUebernehmen={onUebernehmen}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Meldung schreiben' }))
    expect(onUebernehmen).toHaveBeenCalledWith('a')
  })

  it('fragt beim Ablehnen nach Grund und Kommentar — ohne „zu privat"', async () => {
    const onAblehnen = jest.fn().mockResolvedValue(undefined)
    render(
      <Gemeindeseiten
        eintraege={[eintrag()]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
        onAblehnen={onAblehnen}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Kommentar'), 'Steht im Abfuhrkalender')
    expect(within(dialog).queryByText('Zu privat')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ablehnen' }))
    expect(onAblehnen).toHaveBeenCalledWith('a', 'nicht_relevant', 'Steht im Abfuhrkalender')
  })

  it('gibt beim Weiterreichen die Begruendung mit', async () => {
    const onWeiterreichen = jest.fn().mockResolvedValue(undefined)
    render(
      <Gemeindeseiten
        eintraege={[eintrag()]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
        onWeiterreichen={onWeiterreichen}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'An Chefredaktion' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/Begründung/), 'Zahlen prüfen')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Weiterreichen' }))
    expect(onWeiterreichen).toHaveBeenCalledWith('a', 'Zahlen prüfen')
  })

  it('sagt, welche Seite nicht gelesen werden konnte und welche Gemeinde keine hat', () => {
    render(
      <Gemeindeseiten
        eintraege={[]}
        gemeinden={[
          gemeinde({ news_letzter_fehler: 'Seitenaufbau nicht erkannt' }),
          gemeinde({ id: 'g2', name: 'Dornach', news_url: null, news_letzte_pruefung: null })
        ]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText(/konnte nicht gelesen werden: Seitenaufbau nicht erkannt/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Seite öffnen' })).toHaveAttribute(
      'href',
      'https://www.aesch.bl.ch/aktuellesinformationen'
    )
    expect(screen.getByText(/Ohne Newsseite kommen keine Mitteilungen: Dornach/)).toBeInTheDocument()
    expect(screen.getByText(/Nichts auf dem Tisch/)).toBeInTheDocument()
  })

  it('laesst Abgelaufenes weg', () => {
    render(
      <Gemeindeseiten
        eintraege={[eintrag({ vorschlag: null, publiziert_am: '2026-09-01' })]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText(/Nichts auf dem Tisch/)).toBeInTheDocument()
  })
})

describe('Gemeindeseiten: der Lauf', () => {
  const leer = { laeuft: false, gestartet_um: null, beendet_um: null, ergebnis: null, fehler: null }

  it('zeigt an, dass der Lauf unterwegs ist, und sperrt den Knopf solange', () => {
    render(
      <Gemeindeseiten
        eintraege={[]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
        lauf={{ ...leer, laeuft: true }}
      />
    )
    expect(screen.getByRole('button', { name: /Lauf ist unterwegs/ })).toBeDisabled()
    expect(screen.getByText(/dauert einige Minuten/)).toBeInTheDocument()
  })

  it('fasst den letzten Lauf zusammen und nennt einen Absturz', () => {
    render(
      <Gemeindeseiten
        eintraege={[]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
        lauf={{
          ...leer,
          beendet_um: '2026-09-17T11:02:00Z',
          ergebnis: { gemeinden: 10, neu: 3, vorschlaege: 1, fehler: [] }
        }}
      />
    )
    expect(
      screen.getByText(/Letzter Lauf um .* — 10 Gemeinden gelesen, 3 neue Mitteilungen, 1 Vorschläge\./)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jetzt prüfen' })).toBeEnabled()
  })
})
