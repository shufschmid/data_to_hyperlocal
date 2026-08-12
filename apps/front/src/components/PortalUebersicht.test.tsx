import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PortalBereichFelder, PortalSeiteFelder } from '@/graphql/redaktion'
import { PortalUebersicht } from './PortalUebersicht'

function bereich(ueber: Partial<PortalBereichFelder>): PortalBereichFelder {
  return {
    id: 'b',
    pfad: '5_1',
    titel: 'Grundstücksmarkt',
    stand: '2026-05-19',
    beobachten: false,
    inventur_offen: false,
    unklar: 0,
    letzte_pruefung: null,
    letzter_fehler: null,
    ...ueber
  }
}

function seite(ueber: Partial<PortalSeiteFelder>): PortalSeiteFelder {
  return {
    id: 's',
    pfad: '5_1_5_3',
    titel: 'Bauland Gemeinden — Quadratmeterpreis',
    art: 'tabelle',
    form: 'breit',
    gemeindeebene: true,
    treffer: 86,
    ods_datensatz: null,
    beobachten: false,
    hinweis: null,
    bereich: { id: 'b' },
    datensatz: null,
    ankuendigung: null,
    ...ueber
  }
}

function zeige(ueber: Partial<Parameters<typeof PortalUebersicht>[0]> = {}) {
  const props = {
    bereiche: [bereich({})],
    seiten: [seite({})],
    offen: 0,
    onBeobachten: jest.fn(),
    ...ueber
  }
  render(<PortalUebersicht {...props} />)
  return props
}

describe('PortalUebersicht', () => {
  it('nennt den Stand des Zweigs — das ist die ganze Überwachung', () => {
    zeige()
    expect(screen.getByText('19.05.2026')).toBeInTheDocument()
  })

  it('trennt überwachte von abgedeckten Zweigen', () => {
    zeige({
      bereiche: [
        bereich({ id: 'b', pfad: '7_1', titel: 'Landwirtschaft', beobachten: true }),
        bereich({ id: 'c', pfad: '5_1', beobachten: false })
      ],
      seiten: []
    })

    const ueberwacht = screen.getByRole('heading', { name: 'Täglich geprüft' }).parentElement!
    expect(within(ueberwacht).getByText(/7_1/)).toBeInTheDocument()
  })

  // Der Grund gehoert neben den Eintrag: eine Wachliste, die man nicht
  // hinterfragen kann, glaubt einem niemand.
  it('sagt bei jeder Tabelle, was sie abdeckt', () => {
    zeige({
      seiten: [
        seite({ id: 's1', ods_datensatz: '12070' }),
        seite({ id: 's2', pfad: '7_1_1_3', ankuendigung: { id: 'a', titel: 'Landwirtschaft 2025' } }),
        seite({ id: 's3', pfad: '9_9_9', beobachten: true })
      ]
    })

    expect(screen.getByText('Open Data 12070')).toBeInTheDocument()
    expect(screen.getByText('Agenda: Landwirtschaft 2025')).toBeInTheDocument()
    expect(screen.getByText('nur hier')).toBeInTheDocument()
  })

  it('zeigt an, wenn die Inventur noch laeuft', () => {
    zeige({ offen: 1200 })
    expect(screen.getByText(/noch 1200 Seiten/)).toBeInTheDocument()
  })

  it('sagt nichts von einer laufenden Inventur, wenn sie durch ist', () => {
    zeige({ offen: 0 })
    expect(screen.queryByText(/Seiten zu lesen/)).not.toBeInTheDocument()
  })

  // Die Abdeckungsfrage beantwortet ein Modell. Wer es besser weiss, soll nicht
  // mit ihm streiten muessen.
  it('laesst den Zweig von Hand umschalten', async () => {
    const { onBeobachten } = zeige()

    await userEvent.click(screen.getByRole('switch', { name: /5_1 täglich prüfen/ }))

    expect(onBeobachten).toHaveBeenCalledWith('b', true)
  })

  it('sperrt die Schalter, solange geschrieben wird', () => {
    zeige({ laeuft: true })
    expect(screen.getByRole('switch', { name: /täglich prüfen/ })).toBeDisabled()
  })
})
