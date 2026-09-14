import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Chefredaktion } from './Chefredaktion'
import type { PerleFelder, RecherchehinweisFelder } from '@/graphql/redaktion'

function hinweis(ueber: Partial<RecherchehinweisFelder>): RecherchehinweisFelder {
  return {
    id: 'h-1',
    titel: 'Sechs Meter hohe Daemme geplant',
    fundort: "Leserbrief 'Wertvoller Regen', S. 2",
    seite: 2,
    begruendung: 'Konkretes Bauprojekt.',
    quelltext: 'Wortlaut des Leserbriefs auf Seite zwei.',
    status: 'offen',
    kommentar: null,
    date_created: null,
    automatisch: false,
    regel: null,
    kandidat: null,
    amtsblattmeldung: null,
    sendungskandidat: null,
    gemeinde: { id: 'g-1', name: 'Binningen' },
    ausgabe: {
      id: 'a-1',
      nummer: '34',
      pdf_url: 'https://www.binninger-wochenblatt.ch/wp-content/uploads/2026/08/BWB-KW34-2026.pdf',
      wochenblatt: { id: 'w-1', name: 'Binninger Wochenblatt' }
    },
    ...ueber
  }
}

function perle(ueber: Partial<PerleFelder>): PerleFelder {
  return {
    id: 'k-1',
    titel: 'Wo die Temperaturrekorde purzeln',
    seite: 3,
    zusammenfassung: 'Die Basler Klimamessreihe reicht bis 1755 zurueck.',
    perle_begruendung: 'Weltweit einmalige Messreihe.',
    entscheid: 'offen',
    gemeinde: { id: 'g-1', name: 'Binningen' },
    ausgabe: {
      id: 'a-1',
      nummer: '34',
      pdf_url: 'https://www.binninger-wochenblatt.ch/wp-content/uploads/2026/08/BWB-KW34-2026.pdf',
      seiten_texte: ['Front', 'Seite zwei', 'Wortlaut des Klimastuecks auf Seite drei.'],
      wochenblatt: { id: 'w-1', name: 'Binninger Wochenblatt' }
    },
    ...ueber
  }
}

const NICHTS = {
  onHinweisUrteil: jest.fn().mockResolvedValue(undefined),
  onPerle: jest.fn().mockResolvedValue(undefined)
}

describe('Chefredaktion', () => {
  beforeEach(() => {
    for (const f of Object.values(NICHTS)) f.mockClear()
  })

  it('meldet den leeren Tisch statt nichts zu zeigen', () => {
    render(<Chefredaktion hinweise={[]} perlen={[]} {...NICHTS} />)

    expect(screen.getByText(/Der Tisch ist leer/)).toBeInTheDocument()
  })

  it('verlinkt eine Faehrte auf ihre Seite und traegt den Originaltext', async () => {
    render(<Chefredaktion hinweise={[hinweis({})]} perlen={[]} {...NICHTS} />)

    expect(screen.getByRole('link', { name: /Binninger Wochenblatt Nr\. 34, S\. 2/ })).toHaveAttribute(
      'href',
      'https://www.binninger-wochenblatt.ch/wp-content/uploads/2026/08/BWB-KW34-2026.pdf#page=2'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Originaltext lesen (S. 2)' }))
    expect(screen.getByText(/Wortlaut des Leserbriefs/)).toBeInTheDocument()
  })

  it('fragt beim Faehrten-Urteil nach dem Kommentar — das Lernsignal', async () => {
    render(<Chefredaktion hinweise={[hinweis({})]} perlen={[]} {...NICHTS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Brauchbare Fährte' }))
    await userEvent.type(screen.getByLabelText(/Kommentar/), 'nachrecherchieren')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(NICHTS.onHinweisUrteil).toHaveBeenCalledWith('h-1', true, 'nachrecherchieren')
  })

  it('zeigt beurteilte Faehrten nicht mehr auf dem Tisch', () => {
    render(<Chefredaktion hinweise={[hinweis({ status: 'brauchbar' })]} perlen={[]} {...NICHTS} />)

    expect(screen.queryByText(/Sechs Meter hohe Daemme/)).not.toBeInTheDocument()
  })

  it('legt der Chefin den Perlen-Entscheid vor — am Kandidaten, nicht an einer Meldung', async () => {
    render(<Chefredaktion hinweise={[]} perlen={[perle({})]} {...NICHTS} />)

    expect(screen.getByText(/Perle, weil: Weltweit einmalige Messreihe/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Binninger Wochenblatt Nr\. 34, S\. 3/ })).toHaveAttribute(
      'href',
      'https://www.binninger-wochenblatt.ch/wp-content/uploads/2026/08/BWB-KW34-2026.pdf#page=3'
    )
    // Das Urteil fragt nach dem Warum — optional, wie bei den Faehrten.
    await userEvent.click(screen.getByRole('button', { name: 'Als Perle markieren' }))
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(NICHTS.onPerle).toHaveBeenCalledWith('k-1', true, '')
  })

  it('reicht das Warum zu «keine Perle» mit — Geschmack laesst sich sonst nicht lernen', async () => {
    render(<Chefredaktion hinweise={[]} perlen={[perle({})]} {...NICHTS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Keine Perle' }))
    await userEvent.type(
      screen.getByLabelText('Kommentar (optional, hilft dem Lernen)'),
      'kurios, aber rein lokal'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(NICHTS.onPerle).toHaveBeenCalledWith('k-1', false, 'kurios, aber rein lokal')
  })

  it('zeigt an jeder Faehrte, von welchem Tisch sie kommt', () => {
    render(
      <Chefredaktion
        hinweise={[
          hinweis({ id: 'h-1', titel: 'Aus dem Blatt', kandidat: { id: 'k-9' } }),
          hinweis({ id: 'h-2', titel: 'Aus dem Amtsblatt', amtsblattmeldung: { id: 'p-9' } }),
          hinweis({ id: 'h-3', titel: 'Aus der Sendung', sendungskandidat: { id: 's-9', quelle: 'punkt6' } })
        ]}
        perlen={[]}
        {...NICHTS}
      />
    )

    expect(screen.getByText('Wochenblatt')).toBeInTheDocument()
    expect(screen.getByText('Amtsblatt')).toBeInTheDocument()
    expect(screen.getByText('punkt6')).toBeInTheDocument()
  })

  it('zeigt automatische Faehrten mit ihrer Regel und bietet den Weg zurueck an', async () => {
    const onZurueck = jest.fn().mockResolvedValue(undefined)
    render(
      <Chefredaktion
        hinweise={[
          hinweis({
            automatisch: true,
            kandidat: { id: 'k-9' },
            regel: { id: 'r-1', regel: 'Leserbriefe zu Bauprojekten an die Chefredaktion.' }
          })
        ]}
        perlen={[]}
        {...NICHTS}
        onZurueck={onZurueck}
      />
    )

    expect(
      screen.getByText('automatisch · Regel: Leserbriefe zu Bauprojekten an die Chefredaktion.')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Zurück auf den Tisch' }))
    expect(onZurueck).toHaveBeenCalledWith('h-1')
  })

  it('haelt fuer den Perlen-Entscheid den Originaltext bereit', async () => {
    render(<Chefredaktion hinweise={[]} perlen={[perle({})]} {...NICHTS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Originaltext lesen (S. 3)' }))
    expect(screen.getByText(/Wortlaut des Klimastuecks/)).toBeInTheDocument()
  })
})
