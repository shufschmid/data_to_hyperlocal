import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DatensatzWahlFelder } from '@/graphql/redaktion'
import { AuftragDialog, type AuftragZiel } from './AuftragDialog'

const arbeitsstaetten: DatensatzWahlFelder = {
  id: 'ds-10990',
  externe_id: '10990',
  titel: 'Arbeitsstätten und Beschäftigte nach Wirtschaftssektor, Gemeinde und Jahr',
  status: 'neu',
  hat_gemeinde: true,
  gemeindefeld: null,
  standard_vorgabe: null,
  felder: [
    { name: 'jahr', type: 'text' },
    { name: 'bfs_gemeindenummer', type: 'text' }
  ]
}

const ohneGemeinde: DatensatzWahlFelder = {
  id: 'ds-10410',
  externe_id: '10410',
  titel: 'Lernende an Baselbieter Schulen',
  status: 'neu',
  hat_gemeinde: false,
  gemeindefeld: null,
  standard_vorgabe: null,
  felder: [
    { name: 'jahr', type: 'text' },
    { name: 'schulort', type: 'text' },
    { name: 'anzahl', type: 'int' }
  ]
}

const ziel: AuftragZiel = {
  titel: 'Landwirtschaft 2025',
  datensatzId: null,
  ankuendigungId: 'a-landwirtschaft'
}

function zeige(ueber: Partial<Parameters<typeof AuftragDialog>[0]> = {}) {
  const props = {
    ziel,
    datensaetze: [arbeitsstaetten, ohneGemeinde],
    onSchliessen: jest.fn(),
    onStarten: jest.fn(),
    onNurZuordnen: jest.fn(),
    onTabelle: jest.fn().mockResolvedValue(null),
    ...ueber
  }
  render(<AuftragDialog {...props} />)
  return props
}

async function waehle(name: RegExp | string, wert: string) {
  await userEvent.click(screen.getByRole('combobox', { name }))
  await userEvent.click(await screen.findByText(wert))
}

describe('AuftragDialog', () => {
  it('nennt den Agenda-Eintrag, um den es geht', () => {
    zeige()
    expect(screen.getByText('Landwirtschaft 2025')).toBeInTheDocument()
  })

  // Der ganze Sinn: die Zahlen zur Landwirtschaft stecken in einem Datensatz,
  // der anders heisst. Ohne den Auftrag wuesste kein Lauf, worum es geht.
  it('gibt Datensatz und Auftrag weiter', async () => {
    const { onStarten } = zeige()

    await waehle(/Datensatz/, arbeitsstaetten.titel)
    await userEvent.type(
      screen.getByRole('textbox', { name: /Auftrag/ }),
      'Vergleiche die Betriebe mit vor zehn Jahren.'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Meldungen erzeugen' }))

    expect(onStarten).toHaveBeenCalledWith({
      datensatzId: 'ds-10990',
      vorgabe: 'Vergleiche die Betriebe mit vor zehn Jahren.',
      gemeindefeld: null
    })
  })

  it('laesst den Lauf auch ohne Auftrag zu', async () => {
    const { onStarten } = zeige()

    await waehle(/Datensatz/, arbeitsstaetten.titel)
    await userEvent.click(screen.getByRole('button', { name: 'Meldungen erzeugen' }))

    expect(onStarten).toHaveBeenCalledWith(expect.objectContaining({ vorgabe: '' }))
  })

  // „Auch für Daten, wo du keine Gemeindeinfos findest": ohne diese Spalte
  // wuerde der Lauf nur daran scheitern, dass niemand sagen konnte, welche es ist.
  it('verlangt die Gemeindespalte, wenn keine erkannt wurde', async () => {
    const { onStarten } = zeige()

    await waehle(/Datensatz/, ohneGemeinde.titel)

    expect(screen.getByText(/keine Gemeindespalte erkannt/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Meldungen erzeugen' })).toBeDisabled()

    await waehle(/Gemeindespalte/, 'schulort')
    await userEvent.click(screen.getByRole('button', { name: 'Meldungen erzeugen' }))

    expect(onStarten).toHaveBeenCalledWith(
      expect.objectContaining({ datensatzId: 'ds-10410', gemeindefeld: 'schulort' })
    )
  })

  it('kann nur zuordnen, ohne einen Lauf zu starten', async () => {
    const { onNurZuordnen, onStarten } = zeige()

    await waehle(/Datensatz/, arbeitsstaetten.titel)
    await userEvent.click(screen.getByRole('button', { name: 'Nur zuordnen' }))

    expect(onNurZuordnen).toHaveBeenCalledWith('ds-10990')
    expect(onStarten).not.toHaveBeenCalled()
  })

  it('geht von dem Datensatz aus, der schon zugeordnet ist', () => {
    zeige({ ziel: { ...ziel, datensatzId: 'ds-10990' } })

    expect(screen.getByRole('combobox', { name: /Datensatz/ })).toHaveValue(
      `${arbeitsstaetten.titel} (10990)`
    )
  })

  it('bleibt zu, solange nichts gewaehlt ist', () => {
    zeige({ ziel: null })
    expect(screen.queryByRole('button', { name: 'Meldungen erzeugen' })).not.toBeInTheDocument()
  })
})

describe('Tabelle von statistik.bl.ch', () => {
  const tabelle: DatensatzWahlFelder = {
    id: 'ds-tabelle',
    externe_id: '7_1_1_3',
    titel: 'Landwirtschaftsbetriebe nach Gemeinde 2025',
    status: 'relevant',
    hat_gemeinde: true,
    gemeindefeld: 'gemeinde',
    standard_vorgabe: null,
    felder: [{ name: 'jahr', type: 'text' }]
  }

  // Der Fall, der das Ganze ausgeloest hat: zur Landwirtschaft gibt es im
  // Open-Data-Portal nichts, auf statistik.bl.ch aber eine Tabelle je Gemeinde.
  it('liest eine eingefuegte Adresse und waehlt das Ergebnis aus', async () => {
    const onTabelle = jest.fn().mockResolvedValue(tabelle)
    zeige({ onTabelle })

    await userEvent.type(
      screen.getByRole('textbox', { name: /Tabellen-Adresse/ }),
      'https://statistik.bl.ch/web_portal/7_1_1_3'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Tabelle lesen' }))

    expect(onTabelle).toHaveBeenCalledWith('https://statistik.bl.ch/web_portal/7_1_1_3', '')
    expect(await screen.findByDisplayValue(/Landwirtschaftsbetriebe/)).toBeInTheDocument()
  })

  it('gibt den Auftrag mit, damit er fuer naechstes Jahr gemerkt wird', async () => {
    const onTabelle = jest.fn().mockResolvedValue(tabelle)
    zeige({ onTabelle })

    await userEvent.type(screen.getByRole('textbox', { name: /Auftrag/ }), 'Vergleiche mit 2013.')
    await userEvent.type(
      screen.getByRole('textbox', { name: /Tabellen-Adresse/ }),
      'https://statistik.bl.ch/web_portal/7_1_1_3'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Tabelle lesen' }))

    expect(onTabelle).toHaveBeenCalledWith(expect.any(String), 'Vergleiche mit 2013.')
  })

  it('zeigt, wenn die Adresse nicht gelesen werden konnte', async () => {
    const onTabelle = jest.fn().mockRejectedValue(new Error('Das ist keine Tabellen-Adresse.'))
    zeige({ onTabelle })

    await userEvent.type(screen.getByRole('textbox', { name: /Tabellen-Adresse/ }), 'https://x.ch/y')
    await userEvent.click(screen.getByRole('button', { name: 'Tabelle lesen' }))

    expect(await screen.findByText('Das ist keine Tabellen-Adresse.')).toBeInTheDocument()
  })
})
