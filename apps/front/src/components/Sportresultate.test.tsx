import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SpielFelder } from '@/graphql/redaktion'
import { Sportresultate } from './Sportresultate'

function spiel(ueber: Partial<SpielFelder>): SpielFelder {
  return {
    id: 's',
    spielnummer: '1',
    datum: '2026-08-21T18:00:00Z',
    heim: 'FC A',
    gast: 'FC B',
    tore_heim: null,
    tore_gast: null,
    wettbewerb: 'Meisterschaft - 5. Liga',
    ort: null,
    status: null,
    sportart: 'Fussball',
    gemeinde: { id: 'g1', name: 'Pratteln' },
    verein: { id: 'v1', name: 'FC Pratteln', liga: '2. Liga interregional' },
    ...ueber
  }
}

// Fixed clock so "past" and "coming" do not drift with the wall clock. Passed
// in rather than faked globally: userEvent drives its own timers, and freezing
// them deadlocks every click.
const JETZT = new Date('2026-08-20T12:00:00Z')

function bericht(spielId: string) {
  return {
    id: 'm-' + spielId,
    titel: 'Ein Titel',
    lead: 'Ein Lead.',
    text: 'Ein Absatz.',
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: null,
    fehler: null,
    publiziert_am: null,
    erscheint_am: null,
    date_created: null,
    gemeinde: { id: 'g1', name: 'Pratteln', bezirk: 'Liestal' },
    lauf: null,
    kandidat: null,
    perle: null,
    spiel: {
      id: spielId,
      heim: 'FC A',
      gast: 'FC B',
      datum: '2026-08-19T18:00:00Z',
      sportart: 'Fussball',
      wettbewerb: 'Meisterschaft'
    }
  }
}

const spiele = [
  spiel({
    id: 'a',
    datum: '2026-08-19T18:00:00Z',
    heim: 'FC Reinach',
    gast: 'FC Amicitia Riehen',
    tore_heim: 1,
    tore_gast: 3,
    gemeinde: { id: 'g2', name: 'Riehen' },
    verein: { id: 'v2', name: 'FC Amicitia Riehen', liga: '2. Liga interregional' }
  }),
  spiel({
    id: 'b',
    datum: '2026-08-21T18:00:00Z',
    heim: 'FC Möhlin',
    gast: 'FC Pratteln'
  }),
  spiel({
    id: 'c',
    datum: '2026-08-22T16:00:00Z',
    heim: "Sm'Aesch Pfeffingen",
    gast: 'Volley Düdingen',
    sportart: 'Volleyball',
    gemeinde: { id: 'g3', name: 'Aesch' },
    verein: { id: 'v3', name: "Sm'Aesch Pfeffingen", liga: 'Nationalliga A (Damen)' }
  })
]

describe('Sportresultate', () => {
  it('trennt gespielte von kommenden Begegnungen', () => {
    render(<Sportresultate spiele={spiele} jetzt={JETZT} />)

    const resultate = screen.getByRole('heading', { name: 'Resultate' }).closest('div')
      ?.parentElement as HTMLElement
    expect(within(resultate).getByText(/FC Reinach — FC Amicitia Riehen/)).toBeInTheDocument()

    const kommend = screen.getByRole('heading', { name: 'Kommende Begegnungen' }).closest('div')
      ?.parentElement as HTMLElement
    expect(within(kommend).getByText(/FC Möhlin — FC Pratteln/)).toBeInTheDocument()
  })

  it('zeigt das Resultat in Spielrichtung', () => {
    render(<Sportresultate spiele={spiele} jetzt={JETZT} />)
    expect(screen.getByText('1:3')).toBeInTheDocument()
  })

  // Two fixtures are still to be played, so both show a placeholder.
  it('laesst offene Begegnungen ohne Resultat', () => {
    render(<Sportresultate spiele={spiele} jetzt={JETZT} />)
    expect(screen.getAllByText('–')).toHaveLength(2)
  })

  it('filtert nach Gemeinde', async () => {
    render(<Sportresultate spiele={spiele} jetzt={JETZT} />)

    await userEvent.click(screen.getByRole('combobox', { name: 'Gemeinde' }))
    await userEvent.click(screen.getByRole('option', { name: 'Riehen' }))

    expect(screen.getByText(/FC Reinach — FC Amicitia Riehen/)).toBeInTheDocument()
    expect(screen.queryByText(/FC Möhlin — FC Pratteln/)).not.toBeInTheDocument()
  })

  it('filtert nach Sportart', async () => {
    render(<Sportresultate spiele={spiele} jetzt={JETZT} />)

    await userEvent.click(screen.getByRole('combobox', { name: 'Sportart' }))
    await userEvent.click(screen.getByRole('option', { name: 'Volleyball' }))

    expect(screen.getByText(/Sm'Aesch Pfeffingen — Volley Düdingen/)).toBeInTheDocument()
    expect(screen.queryByText(/FC Möhlin — FC Pratteln/)).not.toBeInTheDocument()
  })

  it('bietet nur Sportarten an, die auch vorkommen', async () => {
    render(<Sportresultate spiele={spiele} jetzt={JETZT} />)

    await userEvent.click(screen.getByRole('combobox', { name: 'Sportart' }))
    expect(screen.getByRole('option', { name: 'Fussball' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Volleyball' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Handball' })).not.toBeInTheDocument()
  })

  it('kennzeichnet einen Vermerk der Quelle', () => {
    render(<Sportresultate spiele={[spiel({ id: 'd', status: 'verschoben' })]} />)
    expect(screen.getByText('verschoben')).toBeInTheDocument()
  })

  // An empty table is normal at the start of a season, not a fault.
  it('erklaert eine leere Liste, statt sie kommentarlos zu zeigen', () => {
    render(<Sportresultate spiele={[]} />)
    expect(screen.getByText(/Noch keine Spiele erfasst/)).toBeInTheDocument()
  })
})

describe('Sportresultate — Meldungen erzeugen', () => {
  const gespielt = spiel({
    id: 'g1',
    datum: '2026-08-19T18:00:00Z',
    heim: 'FC Reinach',
    gast: 'FC Amicitia Riehen',
    tore_heim: 3,
    tore_gast: 3
  })

  it('zaehlt die Resultate, die noch keine Meldung haben', () => {
    render(<Sportresultate spiele={[gespielt, ...spiele]} jetzt={JETZT} onMeldungenErzeugen={jest.fn()} />)
    // Zwei: das 3:3 und das 1:3 aus der gemeinsamen Fixture.
    expect(screen.getByText(/2 Resultate warten auf eine Meldung/)).toBeInTheDocument()
  })

  // Ein beschriebenes Spiel braucht keine zweite Meldung.
  it('sperrt den Knopf, wenn alle Resultate beschrieben sind', () => {
    render(
      <Sportresultate
        spiele={[gespielt, ...spiele]}
        jetzt={JETZT}
        berichte={[bericht('g1'), bericht('a')]}
        onMeldungenErzeugen={jest.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Meldungen erzeugen' })).toBeDisabled()
    expect(screen.getByText(/Alle vorliegenden Resultate haben eine Meldung/)).toBeInTheDocument()
  })

  // Ansetzungen ohne Resultat sind kein Stoff fuer eine Meldung.
  it('zaehlt Begegnungen ohne Resultat nicht mit', () => {
    const ohneResultat = spiele.filter((s) => s.tore_heim === null)
    render(<Sportresultate spiele={ohneResultat} jetzt={JETZT} onMeldungenErzeugen={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'Meldungen erzeugen' })).toBeDisabled()
  })

  it('loest die Aktion aus', async () => {
    const onMeldungenErzeugen = jest.fn().mockResolvedValue(undefined)
    render(
      <Sportresultate
        spiele={[gespielt, ...spiele]}
        jetzt={JETZT}
        onMeldungenErzeugen={onMeldungenErzeugen}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Meldungen erzeugen' }))
    expect(onMeldungenErzeugen).toHaveBeenCalled()
  })

  it('sperrt den Knopf, solange geschrieben wird', () => {
    render(
      <Sportresultate spiele={[gespielt, ...spiele]} jetzt={JETZT} laeuft onMeldungenErzeugen={jest.fn()} />
    )
    expect(screen.getByRole('button', { name: /Wird geschrieben/ })).toBeDisabled()
  })

  it('zeigt den Knopf gar nicht, wenn keine Aktion angeboten wird', () => {
    render(<Sportresultate spiele={[gespielt]} jetzt={JETZT} />)
    expect(screen.queryByRole('button', { name: /Meldungen erzeugen/ })).not.toBeInTheDocument()
  })
})

describe('Sportresultate — alle publizieren', () => {
  const gespielt = spiel({
    id: 'g1',
    datum: '2026-08-19T18:00:00Z',
    heim: 'FC Reinach',
    gast: 'FC Amicitia Riehen',
    tore_heim: 3,
    tore_gast: 3
  })

  it('nennt, wie viele Meldungen bereit sind, und stellt sie scharf', async () => {
    const onAllePublizieren = jest.fn().mockResolvedValue(undefined)
    render(
      <Sportresultate
        spiele={[gespielt]}
        jetzt={JETZT}
        berichte={[bericht('g1')]}
        onAllePublizieren={onAllePublizieren}
      />
    )

    expect(screen.getByText(/1 Meldung ist bereit zum Publizieren/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Alle Meldungen publizieren' }))
    expect(onAllePublizieren).toHaveBeenCalled()
  })

  it('sperrt den Knopf, wenn nichts zu publizieren ist', () => {
    render(
      <Sportresultate
        spiele={[gespielt]}
        jetzt={JETZT}
        berichte={[{ ...bericht('g1'), status: 'publiziert' }]}
        onAllePublizieren={jest.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Alle Meldungen publizieren' })).toBeDisabled()
  })

  // Eine Meldung beim Gegenlesen gehoert den Pruefenden — sie zaehlt nicht mit.
  it('zaehlt eine Meldung in Gegenpruefung nicht als bereit', () => {
    render(
      <Sportresultate
        spiele={[gespielt]}
        jetzt={JETZT}
        berichte={[{ ...bericht('g1'), status: 'in_pruefung' }]}
        onAllePublizieren={jest.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Alle Meldungen publizieren' })).toBeDisabled()
  })
})

describe('Sportresultate — Bericht anzeigen', () => {
  const gespielt = spiel({
    id: 'g1',
    datum: '2026-08-19T18:00:00Z',
    heim: 'FC Reinach',
    gast: 'FC Amicitia Riehen',
    tore_heim: 3,
    tore_gast: 3
  })

  // Zugeklappt, weil ein Wochenende sechs Berichte in die Liste stellt — aber
  // klar ersichtlich, dass einer da ist, samt Status.
  it('zeigt den Bericht erst auf Klick, mit allen Aktionen', async () => {
    render(<Sportresultate spiele={[gespielt]} jetzt={JETZT} berichte={[bericht('g1')]} />)

    expect(screen.queryByText('Ein Titel')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Bericht anzeigen \(Entwurf\)/ }))

    expect(screen.getByText('Ein Titel')).toBeInTheDocument()
    expect(screen.getByText('Ein Lead.')).toBeInTheDocument()
    expect(screen.getByText('Ein Absatz.')).toBeInTheDocument()
    // Die volle Karte, nicht eine Leseansicht: Chat und Einzelaktionen.
    expect(screen.getByRole('button', { name: 'Überarbeiten' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publizieren' })).toBeInTheDocument()
  })

  it('zeigt bei einem Spiel ohne Bericht keinen Text', () => {
    render(<Sportresultate spiele={[gespielt]} jetzt={JETZT} berichte={[]} />)
    expect(screen.queryByText('Ein Titel')).not.toBeInTheDocument()
  })

  it('haengt den Bericht ans richtige Spiel', () => {
    render(<Sportresultate spiele={[gespielt, ...spiele]} jetzt={JETZT} berichte={[bericht('a')]} />)
    // Nur ein Aufklapp-Knopf, obwohl zwei Resultate vorliegen.
    expect(screen.getAllByRole('button', { name: /Bericht anzeigen/ })).toHaveLength(1)
  })

  it('zeigt Zeit-Warnungen des Berichts nach dem Aufklappen', async () => {
    const mitWarnung = { ...bericht('g1'), zeit_warnungen: ['Relativer Zeitbezug: "am samstag"'] }
    render(<Sportresultate spiele={[gespielt]} jetzt={JETZT} berichte={[mitWarnung]} />)
    await userEvent.click(screen.getByRole('button', { name: /Bericht anzeigen/ }))
    expect(screen.getByText('Relativer Zeitbezug: "am samstag"')).toBeInTheDocument()
  })
})
