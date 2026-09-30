import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Gelerntes } from './Gelerntes'
import type { WissenFelder } from '@/graphql/redaktion'

function regel(ueber: Partial<WissenFelder>): WissenFelder {
  return {
    id: 'r-1',
    regel: 'Vereinsjubiläen ohne besondere Zutaten nicht vorschlagen.',
    geltungsbereich: 'global',
    herkunft: 'kommentar',
    aktiv: true,
    bereich: 'presseschau',
    stufe: 'sichtung',
    wirkung: 'hinweis',
    beleg: '„ohne Zutaten" — zu "Turnverein feiert 100 Jahre" (abgelehnt)',
    date_created: '2026-09-01T00:00:00Z',
    datensatz: null,
    ...ueber
  }
}

const NICHTS = {
  onAktiv: jest.fn().mockResolvedValue(undefined),
  onWirkung: jest.fn().mockResolvedValue(undefined),
  onAnlegen: jest.fn().mockResolvedValue(undefined)
}

describe('Gelerntes', () => {
  beforeEach(() => {
    for (const f of Object.values(NICHTS)) f.mockClear()
  })

  it('gruppiert nach Tisch und zeigt Herkunft und Stufe', () => {
    render(
      <Gelerntes
        regeln={[
          regel({}),
          regel({
            id: 'r-2',
            bereich: 'statistik',
            stufe: 'text',
            herkunft: 'chat',
            regel: 'Nenne den Bezirk.'
          })
        ]}
        {...NICHTS}
      />
    )

    expect(screen.getByText(/Wochenblätter/)).toBeInTheDocument()
    expect(screen.getByText(/Statistik/)).toBeInTheDocument()
    expect(screen.getByText('aus einem Kommentar')).toBeInTheDocument()
    expect(screen.getByText('Sichtung')).toBeInTheDocument()
  })

  it('schaltet eine Regel aus', async () => {
    render(<Gelerntes regeln={[regel({})]} {...NICHTS} />)

    await userEvent.click(screen.getByRole('switch', { name: /Regel aktiv:/ }))

    expect(NICHTS.onAktiv).toHaveBeenCalledWith('r-1', false)
  })

  it('stellt die Automatik einer Sichtungsregel scharf', async () => {
    render(<Gelerntes regeln={[regel({})]} {...NICHTS} />)

    await userEvent.click(screen.getByRole('switch', { name: /Automatisch weiterreichen:/ }))

    expect(NICHTS.onWirkung).toHaveBeenCalledWith('r-1', 'weiterreichen')
  })

  it('zeigt den Beleg auf Klick', async () => {
    render(<Gelerntes regeln={[regel({})]} {...NICHTS} />)

    expect(screen.queryByText(/Turnverein feiert 100 Jahre/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Beleg anzeigen' }))
    expect(screen.getByText(/Turnverein feiert 100 Jahre/)).toBeInTheDocument()
  })

  it('klappt Deaktivierte ein — wieder einschalten bleibt moeglich', async () => {
    render(<Gelerntes regeln={[regel({ aktiv: false, regel: 'Alte Regel.' })]} {...NICHTS} />)

    expect(screen.queryByText('Alte Regel.')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Deaktiviert (1) anzeigen' }))
    expect(screen.getByText('Alte Regel.')).toBeInTheDocument()
  })

  it('erfasst eine Regel von Hand', async () => {
    render(<Gelerntes regeln={[]} {...NICHTS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Regel erfassen' }))
    await userEvent.type(screen.getByLabelText('Regel'), 'Kirchenzettel nie vorschlagen.')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(NICHTS.onAnlegen).toHaveBeenCalledWith({
      bereich: 'presseschau',
      stufe: 'sichtung',
      regel: 'Kirchenzettel nie vorschlagen.',
      wirkung: 'hinweis'
    })
  })

  it('nennt die Bilanz der automatischen Faehrten an der Regel', () => {
    render(
      <Gelerntes
        regeln={[regel({ wirkung: 'weiterreichen' })]}
        hinweise={[
          { regel: { id: 'r-1', regel: 'x' }, status: 'brauchbar' },
          { regel: { id: 'r-1', regel: 'x' }, status: 'offen' }
        ].map((h) => ({
          id: `h-${h.status}`,
          titel: 'T',
          fundort: null,
          seite: null,
          begruendung: null,
          quelltext: null,
          kommentar: null,
          date_created: null,
          automatisch: true,
          kandidat: null,
          amtsblattmeldung: null,
          gemeindemitteilung: null,
          veranstaltung: null,
          sendungskandidat: null,
          gemeinde: null,
          ausgabe: null,
          ...h
        }))}
        {...NICHTS}
      />
    )

    expect(screen.getByText('reicht automatisch weiter')).toBeInTheDocument()
    expect(
      screen.getByText(/2 Fährten automatisch weitergereicht · 1 brauchbar · 0 abgelegt · 1 offen/)
    ).toBeInTheDocument()
  })
})

describe('Gelerntes: die Regler der Tische', () => {
  it('stellt die Schwelle eines Tischs um und schickt sie sofort hinaus', async () => {
    const onTisch = jest.fn().mockResolvedValue(undefined)
    render(<Gelerntes regeln={[]} {...NICHTS} tische={[]} onTisch={onTisch} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Schwelle Gemeindeseiten' }))
    await userEvent.click(screen.getByRole('option', { name: 'Grosszügig (ab Stufe 2)' }))
    expect(onTisch).toHaveBeenCalledWith('gemeinde', { schwelle: 2 })
  })

  it('ohne Regler-Funktion bleibt der Abschnitt weg', () => {
    render(<Gelerntes regeln={[]} {...NICHTS} />)
    expect(screen.queryByText(/Tische — wie viel/)).not.toBeInTheDocument()
  })
})

// Die Kosten: was die Modellaufrufe kosteten, je Tisch, und was fuer nichts
// bezahlt wurde. Tokens, keine Franken.
describe('Gelerntes — Kosten', () => {
  it('zeigt je Tisch Aufrufe und Tokens und nennt Verluste rot', async () => {
    const summe = { cache_gelesen_tokens: 0, cache_geschrieben_tokens: 0, abgebrochen: 0, fehler: 0 }
    const onVerbrauchTage = jest.fn()
    render(
      <Gelerntes
        regeln={[]}
        {...NICHTS}
        verbrauch={{
          tage: 7,
          gesamt: { ...summe, aufrufe: 12, eingabe_tokens: 150_000, ausgabe_tokens: 32_000, abgebrochen: 3 },
          tische: [
            {
              tisch: 'veranstaltungen',
              ...summe,
              aufrufe: 9,
              eingabe_tokens: 120_000,
              ausgabe_tokens: 24_000,
              abgebrochen: 3,
              modelle: [
                {
                  modell: 'claude-sonnet-5',
                  ...summe,
                  aufrufe: 9,
                  eingabe_tokens: 120_000,
                  ausgabe_tokens: 24_000,
                  abgebrochen: 3
                }
              ],
              zwecke: [
                {
                  zweck: 'veranstaltungen:sichtung',
                  ...summe,
                  aufrufe: 9,
                  eingabe_tokens: 120_000,
                  ausgabe_tokens: 24_000,
                  abgebrochen: 3
                }
              ]
            },
            {
              tisch: 'lernen',
              ...summe,
              aufrufe: 3,
              eingabe_tokens: 30_000,
              ausgabe_tokens: 8_000,
              modelle: [],
              zwecke: []
            }
          ]
        }}
        onVerbrauchTage={onVerbrauchTage}
      />
    )
    expect(screen.getByText(/Kosten — was die Modellaufrufe der letzten 7 Tage/)).toBeInTheDocument()
    expect(screen.getByText('Veranstaltungen')).toBeInTheDocument()
    expect(screen.getByText('Lernschicht')).toBeInTheDocument()
    expect(screen.getByText('3 abgebrochen')).toBeInTheDocument()
    expect(screen.getAllByText('24,0 k').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByText('Veranstaltungen'))
    expect(screen.getByText('veranstaltungen:sichtung')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '30 Tage' }))
    expect(onVerbrauchTage).toHaveBeenCalledWith(30)
  })
})
