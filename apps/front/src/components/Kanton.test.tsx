import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AlleMeldungFelder, GemeindeFelder, KantonsmitteilungFelder } from '@/graphql/redaktion'
import { Kanton } from './Kanton'

function eintrag(ueber: Partial<KantonsmitteilungFelder> = {}): KantonsmitteilungFelder {
  return {
    id: 'a',
    url: 'https://www.baselland.ch/politik-und-behorden/direktionen/sicherheitsdirektion/medienmitteilungen/tempo-30',
    quelle: 'medienmitteilung',
    behoerde: 'Sicherheitsdirektion',
    titel: 'Tempo-30-Anträgen in Münchenstein und Birsfelden wird teilweise zugestimmt',
    teaser: null,
    text: 'Die Sicherheitsdirektion hat die Anträge geprüft.\n\nAuf der Hauptstrasse gilt neu Tempo 30.',
    text_abgeschnitten: false,
    publiziert_am: '2026-09-02',
    gelesen_am: '2026-09-02T12:00:00Z',
    hinweise: null,
    gemeinden_genannt: ['Münchenstein', 'Bottmingen'],
    vorschlag: true,
    vorschlag_begruendung: 'Betrifft die Hauptstrasse der Gemeinde.',
    entscheid: 'offen',
    ablehnungsgrund: null,
    date_created: '2026-09-02T12:00:00Z',
    gemeinde: { id: 'g1', name: 'Münchenstein' },
    ...ueber
  }
}

function gemeinde(ueber: Partial<GemeindeFelder> = {}): GemeindeFelder {
  return {
    id: 'g1',
    name: 'Münchenstein',
    bezirk: 'Arlesheim',
    bfs_nummer: 2769,
    plz: ['4142'],
    aktiv: true,
    news_url: null,
    news_letzte_pruefung: null,
    news_letzter_fehler: null,
    news_letzter_hinweis: null,
    suedanflug: false,
    ...ueber
  }
}

const HEUTE = '2026-09-04'

function meldung(ueber: Partial<AlleMeldungFelder> = {}): AlleMeldungFelder {
  return {
    id: 'm-1',
    titel: 'Münchenstein: Tempo 30 auf der Hauptstrasse',
    lead: 'Wie der Kanton Basel-Landschaft mitteilt …',
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
    date_created: '2026-09-02',
    gemeinde: { id: 'g1', name: 'Münchenstein', bezirk: 'Arlesheim' },
    lauf: null,
    spiel: null,
    kandidat: null,
    amtsblattmeldung: null,
    gemeindemitteilung: null,
    veranstaltung: null,
    kantonsmitteilung: { id: 'a' },
    sendungskandidat: null,
    suedanflugquote: null,
    abstimmung: null,
    perle: null,
    ...ueber
  }
}

describe('Kanton', () => {
  it('zeigt Sprecher, Behoerde und die weiteren Gemeinden, verlinkt die Seite und nennt die Begruendung', () => {
    render(<Kanton eintraege={[eintrag()]} gemeinden={[gemeinde()]} heute={HEUTE} />)
    expect(screen.getByText('Medienmitteilung')).toBeInTheDocument()
    expect(screen.getByText('Sicherheitsdirektion')).toBeInTheDocument()
    expect(screen.getByText('nennt auch Bottmingen')).toBeInTheDocument()
    expect(screen.getByText('Betrifft die Hauptstrasse der Gemeinde.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Mitteilung auf baselland.ch/ })).toHaveAttribute(
      'href',
      'https://www.baselland.ch/politik-und-behorden/direktionen/sicherheitsdirektion/medienmitteilungen/tempo-30'
    )
    expect(screen.getByText(/Mitteilung vom 2\. September 2026/)).toBeInTheDocument()
  })

  it('haelt die Zeile mit ihrer Meldung und laesst sie nach der Publikation los', () => {
    const { rerender } = render(
      <Kanton
        eintraege={[eintrag({ entscheid: 'uebernommen' })]}
        gemeinden={[gemeinde()]}
        meldungen={[meldung()]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText('Münchenstein: Tempo 30 auf der Hauptstrasse')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Meldung schreiben' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ablehnen' })).toBeInTheDocument()

    rerender(
      <Kanton
        eintraege={[eintrag({ entscheid: 'uebernommen' })]}
        gemeinden={[gemeinde()]}
        meldungen={[meldung({ status: 'publiziert' })]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText(/Nichts auf dem Tisch/)).toBeInTheDocument()
  })

  it('zeigt den Originaltext erst auf Klick und markiert eine Polizeimeldung', async () => {
    render(
      <Kanton
        eintraege={[eintrag({ quelle: 'polizeimeldung', behoerde: 'Polizei Basel-Landschaft' })]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText('Polizeimeldung')).toBeInTheDocument()
    expect(screen.queryByText(/Hauptstrasse gilt neu/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Originaltext lesen' }))
    expect(screen.getByText(/Hauptstrasse gilt neu/)).toBeInTheDocument()
  })

  it('faltet die Uebrigen weg, ohne sie zu verstecken', async () => {
    render(
      <Kanton
        eintraege={[
          eintrag(),
          eintrag({ id: 'b', titel: 'Kantonale Statistik erschienen', vorschlag: false })
        ]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText('1 vorgeschlagen')).toBeInTheDocument()
    expect(screen.queryByText('Kantonale Statistik erschienen')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Übrige 1 anzeigen/ }))
    expect(screen.getByText('Kantonale Statistik erschienen')).toBeInTheDocument()
  })

  it('reicht Uebernehmen durch', async () => {
    const onUebernehmen = jest.fn().mockResolvedValue(undefined)
    render(
      <Kanton eintraege={[eintrag()]} gemeinden={[gemeinde()]} heute={HEUTE} onUebernehmen={onUebernehmen} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Meldung schreiben' }))
    expect(onUebernehmen).toHaveBeenCalledWith('a')
  })

  it('fragt beim Ablehnen nach Grund und Kommentar — mit „nur am Rand erwaehnt" als eigenem Grund', async () => {
    const onAblehnen = jest.fn().mockResolvedValue(undefined)
    render(<Kanton eintraege={[eintrag()]} gemeinden={[gemeinde()]} heute={HEUTE} onAblehnen={onAblehnen} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Grund' }))
    await userEvent.click(screen.getByRole('option', { name: 'Nur am Rand erwähnt' }))
    await userEvent.type(within(dialog).getByLabelText('Kommentar'), 'Nur in einer Liste')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ablehnen' }))
    expect(onAblehnen).toHaveBeenCalledWith('a', 'nur_erwaehnt', 'Nur in einer Liste')
  })

  it('gibt beim Weiterreichen die Begruendung mit', async () => {
    const onWeiterreichen = jest.fn().mockResolvedValue(undefined)
    render(
      <Kanton
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

  it('bietet den Sammelknopf mit der Zahl der fertigen Meldungen und nennt den Lauf', async () => {
    const onAllePublizieren = jest.fn().mockResolvedValue(undefined)
    render(
      <Kanton
        eintraege={[eintrag({ entscheid: 'uebernommen' })]}
        gemeinden={[gemeinde()]}
        meldungen={[
          meldung({ id: 'm-1', status: 'entwurf' }),
          meldung({ id: 'm-2', status: 'in_pruefung', kantonsmitteilung: { id: 'b' } })
        ]}
        heute={HEUTE}
        lauf={{
          laeuft: false,
          gestartet_um: null,
          beendet_um: '2026-09-04T12:02:00Z',
          ergebnis: { geoeffnet: 3, neu: 1, vorschlaege: 1, meldungenGeschrieben: 1, fehler: [] },
          fehler: null
        }}
        onAllePublizieren={onAllePublizieren}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Alle publizieren (1)' }))
    expect(onAllePublizieren).toHaveBeenCalled()
    expect(screen.getByText(/3 Einträge geöffnet, 1 mit Gemeindebezug/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jetzt prüfen' })).toBeEnabled()
  })

  it('laesst Abgelaufenes weg', () => {
    render(
      <Kanton
        eintraege={[eintrag({ vorschlag: null, publiziert_am: '2026-08-20' })]}
        gemeinden={[gemeinde()]}
        heute={HEUTE}
      />
    )
    expect(screen.getByText(/Nichts auf dem Tisch/)).toBeInTheDocument()
  })
})
