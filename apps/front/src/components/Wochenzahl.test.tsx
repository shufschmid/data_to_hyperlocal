import { render, screen } from '@testing-library/react'
import { Wochenzahl, wochenzahlText, type WochenzahlBilanz } from './Wochenzahl'

function bilanz(teil: Partial<WochenzahlBilanz['gesamt']> = {}): WochenzahlBilanz {
  return {
    fenster_tage: 7,
    gesamt: {
      offen: 31,
      freigegeben: 0,
      aeltester_tage: 9,
      publiziert_im_fenster: 12,
      ...teil
    }
  }
}

describe('wochenzahlText', () => {
  it('sagt in einer Zeile, was diese Woche geschah und was liegen blieb', () => {
    expect(wochenzahlText(bilanz())).toBe('Diese Woche: 12 publiziert, 31 offen, aeltester Entwurf 9 Tage')
  })

  it('laesst das Alter weg, wenn nichts wartet', () => {
    // «0 Tage» hiesse «das aelteste ist von heute». Das ist eine andere Aussage
    // als «es wartet nichts», und die Kopfzeile darf sie nicht verwechseln.
    expect(wochenzahlText(bilanz({ offen: 0, aeltester_tage: null }))).toBe(
      'Diese Woche: 12 publiziert, 0 offen'
    )
  })

  it('nennt das Unterschriebene nur, wenn es welches gibt', () => {
    expect(wochenzahlText(bilanz({ freigegeben: 3 }))).toContain('3 unterschrieben')
    expect(wochenzahlText(bilanz({ freigegeben: 0 }))).not.toContain('unterschrieben')
  })

  it('nennt ein anderes Fenster beim Namen, statt es «diese Woche» zu nennen', () => {
    expect(wochenzahlText({ ...bilanz(), fenster_tage: 30 })).toContain('Diese 30 Tage:')
  })

  it('schweigt, solange nichts geladen ist', () => {
    // Kein Platzhalter und keine Null: eine Zahl, die noch nicht da ist, darf
    // nicht wie eine Zahl aussehen, die null lautet.
    expect(wochenzahlText(null)).toBeNull()
  })
})

describe('Wochenzahl', () => {
  it('zeigt die Zeile', () => {
    render(<Wochenzahl bilanz={bilanz()} />)
    expect(screen.getByText(/12 publiziert/)).toBeInTheDocument()
  })

  it('rendert nichts ohne Bilanz', () => {
    const { container } = render(<Wochenzahl bilanz={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
