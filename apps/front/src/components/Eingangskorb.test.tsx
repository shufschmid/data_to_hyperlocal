import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { eingangskorb } from '@/lib/eingang'
import type { ZeitleistenEintrag } from '@/lib/redaktion'
import { Eingangskorb } from './Eingangskorb'

// Der Tisch «data to hyperlocal» als Eingangskorb: zuoberst, was einen
// Entscheid braucht; alles andere in eingeklappten Fächern mit ihrer Zahl.

const HEUTE = '2026-11-22'

function e(id: string, ueber: Partial<ZeitleistenEintrag> = {}): ZeitleistenEintrag {
  return {
    id,
    herkunft: 'datensatz',
    datum: '2026-11-20',
    titel: id,
    hinweis: null,
    datensatzId: `d-${id}`,
    laufId: null,
    pfad: null,
    link: null,
    quartal: null,
    beschreibung: null,
    rhythmus: null,
    zeilen: null,
    quoteId: null,
    vorschlag: false,
    befunde: [],
    abstimmungId: null,
    abstimmungsgemeinden: [],
    abstimmungIds: [],
    ...ueber
  }
}

function zeige(datiert: ZeitleistenEintrag[], ueber: Partial<Parameters<typeof Eingangskorb>[0]> = {}) {
  const props = {
    korb: eingangskorb({ datiert, ohneDatum: [], heute: HEUTE }),
    onAuftrag: jest.fn(),
    onVerwerfen: jest.fn(),
    onAblegen: jest.fn(),
    ...ueber
  }
  render(<Eingangskorb {...props} />)
  return props
}

describe('Eingangskorb', () => {
  it('zeigt Neues offen, mit den zwei Wegen: etwas daraus machen oder vergessen', async () => {
    const props = zeige([e('Leerwohnungen nach Gemeinde')])

    expect(screen.getByText('Neu — entscheiden (1)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Meldungen erzeugen' }))
    expect(props.onAuftrag).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Vergiss es' }))
    expect(props.onVerwerfen).toHaveBeenCalled()
  })

  it('sagt es, wenn nichts Neues da ist', () => {
    zeige([])
    expect(screen.getByText('Neu — entscheiden (0)')).toBeInTheDocument()
    expect(screen.getByText(/Nichts Neues/)).toBeInTheDocument()
  })

  it('hält Älteres zugeklappt bereit und zeigt es auf Klick, mit dem Grund auf der Zeile', async () => {
    zeige([e('Neu'), e('Alt und unentschieden', { datum: '2026-09-01' })])

    expect(screen.queryByText('Alt und unentschieden')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Liegen geblieben \(1\)/ }))
    expect(screen.getByText('Alt und unentschieden')).toBeInTheDocument()
    expect(screen.getByText('ohne Entscheid')).toBeInTheDocument()
  })

  it('legt einen Portal-Zweig nur ab — und bietet ihm einen Knopf statt «geändert»', async () => {
    const zweig = e('Preise (5_1)', { herkunft: 'portal', datensatzId: null, pfad: '5_1' })
    const props = zeige([zweig])

    await userEvent.click(screen.getByRole('button', { name: 'Tabelle wählen' }))
    expect(props.onAuftrag).toHaveBeenCalledWith(zweig)
    await userEvent.click(screen.getByRole('button', { name: 'Vergiss es' }))
    expect(props.onAblegen).toHaveBeenCalledWith(zweig, true)
    expect(props.onVerwerfen).not.toHaveBeenCalled()
  })

  it('führt Abgelegtes unter «Erledigt» und holt es von dort zurück', async () => {
    const abgelegt = e('Preise (5_1)', {
      herkunft: 'portal',
      datensatzId: null,
      abgelegtAm: '2026-11-21'
    })
    const props = zeige([abgelegt])

    expect(screen.getByText('Neu — entscheiden (0)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Erledigt \(1\)/ }))
    expect(screen.getByText('abgelegt')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Zurückholen' }))
    expect(props.onAblegen).toHaveBeenCalledWith(abgelegt, false)
  })

  it('zeigt von der Südanflug-Quote nur den jüngsten Monat als neu, die früheren im Verlauf', async () => {
    const monat = (titel: string, datum: string) =>
      e(titel, { herkunft: 'suedanflug', datum, datensatzId: null, quoteId: `q-${datum}` })
    zeige([monat('Südanflug Oktober', '2026-11-20'), monat('Südanflug September', '2026-10-20')])

    expect(screen.getByText('Südanflug Oktober')).toBeInTheDocument()
    expect(screen.queryByText('Südanflug September')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /frühere Monate \(1\)/ }))
    expect(screen.getByText('Südanflug September')).toBeInTheDocument()
  })

  it('zeigt einen Abstimmungstermin unter «Demnächst», nicht zuoberst', async () => {
    zeige([
      e('Abstimmungssonntag vom 29.11.2026', {
        herkunft: 'abstimmungstermin',
        datum: '2026-11-29',
        datensatzId: null
      })
    ])

    expect(screen.getByText('Neu — entscheiden (0)')).toBeInTheDocument()
    expect(screen.queryByText('Abstimmungssonntag vom 29.11.2026')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Demnächst \(1\)/ }))
    expect(screen.getByText('Abstimmungssonntag vom 29.11.2026')).toBeInTheDocument()
  })
})
