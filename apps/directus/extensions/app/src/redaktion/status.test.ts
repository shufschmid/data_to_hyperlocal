import { describe, expect, it } from 'vitest'
import type { MeldungStatus } from '../types/schema'
import {
  hatInhalt,
  inhaltGeaendert,
  istFreigegeben,
  istUebergangErlaubt,
  pruefeUebergang,
  ruecksetzungNachAenderung,
  type MeldungZustand
} from './status'

function zustand(ueber: Partial<MeldungZustand> = {}): MeldungZustand {
  return {
    status: 'entwurf',
    titel: 'Aesch sammelt weniger Glas',
    lead: 'Ein Rueckgang.',
    text: 'Im Jahr 2025 ...',
    entscheidung: null,
    freigegeben_am: null,
    ...ueber
  }
}

describe('istUebergangErlaubt', () => {
  // THE invariant. An article sent out for checking must not reach publication
  // without someone having said yes — that is the entire reason for sending it.
  it('laesst eine Meldung in der Gegenpruefung nicht direkt publizieren', () => {
    expect(istUebergangErlaubt('in_pruefung', 'publiziert')).toBe(false)
  })

  it('erlaubt den Weg ueber die Freigabe', () => {
    expect(istUebergangErlaubt('in_pruefung', 'freigegeben')).toBe(true)
    expect(istUebergangErlaubt('freigegeben', 'publiziert')).toBe(true)
  })

  // The editor may publish without a counter-check — that is one of the three
  // options in the brief. Only *starting* a check creates the obligation.
  it('erlaubt der Redaktion, direkt zu publizieren', () => {
    expect(istUebergangErlaubt('entwurf', 'publiziert')).toBe(true)
  })

  it('erlaubt das Zurueckholen einer publizierten Meldung', () => {
    expect(istUebergangErlaubt('publiziert', 'entwurf')).toBe(true)
    expect(istUebergangErlaubt('publiziert', 'verworfen')).toBe(true)
  })

  it('haelt einen Status auf sich selbst fuer erlaubt', () => {
    for (const s of [
      'entwurf',
      'in_pruefung',
      'publiziert'
    ] as MeldungStatus[]) {
      expect(istUebergangErlaubt(s, s)).toBe(true)
    }
  })

  it('lehnt einen Sprung aus dem Papierkorb in die Publikation ab', () => {
    expect(istUebergangErlaubt('verworfen', 'publiziert')).toBe(false)
    expect(istUebergangErlaubt('verworfen', 'freigegeben')).toBe(false)
  })
})

describe('hatInhalt', () => {
  it('verlangt Titel, Lead und Text', () => {
    expect(hatInhalt(zustand())).toBe(true)
    expect(hatInhalt(zustand({ lead: '' }))).toBe(false)
    expect(hatInhalt(zustand({ text: null }))).toBe(false)
    expect(hatInhalt(zustand({ titel: '   ' }))).toBe(false)
  })
})

describe('istFreigegeben', () => {
  it('erkennt nur ein eindeutiges Ja als Freigabe', () => {
    expect(istFreigegeben('ja')).toBe(true)
  })

  // The classifier returns `unklar` for a reply it could not read as a
  // decision. Treating that as approval is how something gets published that
  // nobody actually cleared.
  it('nimmt "unklar" nie als Freigabe', () => {
    expect(istFreigegeben('unklar')).toBe(false)
    expect(istFreigegeben('nein')).toBe(false)
    expect(istFreigegeben(null)).toBe(false)
  })
})

describe('pruefeUebergang', () => {
  it('laesst einen sauberen Weg durch', () => {
    const nachPruefung = pruefeUebergang(zustand(), 'in_pruefung')
    expect(nachPruefung.erlaubt).toBe(true)
  })

  it('erklaert verstaendlich, warum direkt publizieren nicht geht', () => {
    const ergebnis = pruefeUebergang(
      zustand({ status: 'in_pruefung' }),
      'publiziert'
    )

    expect(ergebnis.erlaubt).toBe(false)
    expect(ergebnis.grund).toContain('Gegenpruefung')
    expect(ergebnis.grund).toContain('Freigabe')
  })

  it('verweigert die Freigabe ohne Rueckmeldung', () => {
    const ergebnis = pruefeUebergang(
      zustand({ status: 'in_pruefung', entscheidung: null }),
      'freigegeben'
    )

    expect(ergebnis.erlaubt).toBe(false)
    expect(ergebnis.grund).toContain('noch keine Rueckmeldung')
  })

  it('verweigert die Freigabe bei einer unklaren Rueckmeldung', () => {
    const ergebnis = pruefeUebergang(
      zustand({ status: 'in_pruefung', entscheidung: 'unklar' }),
      'freigegeben'
    )

    expect(ergebnis.erlaubt).toBe(false)
    expect(ergebnis.grund).toContain('keine eindeutige Freigabe')
  })

  it('laesst die Freigabe bei einem klaren Ja zu', () => {
    expect(
      pruefeUebergang(
        zustand({ status: 'in_pruefung', entscheidung: 'ja' }),
        'freigegeben'
      ).erlaubt
    ).toBe(true)
  })

  it('publiziert keine Meldung ohne Text', () => {
    const ergebnis = pruefeUebergang(zustand({ text: null }), 'publiziert')

    expect(ergebnis.erlaubt).toBe(false)
    expect(ergebnis.grund).toContain('vollstaendigen Text')
  })

  it('schickt keine leere Meldung in die Gegenpruefung', () => {
    expect(pruefeUebergang(zustand({ lead: '' }), 'in_pruefung').erlaubt).toBe(
      false
    )
  })

  // Without a timestamp the approval cannot be traced back to anything.
  it('publiziert nicht aus einer Freigabe ohne Zeitpunkt', () => {
    const ergebnis = pruefeUebergang(
      zustand({ status: 'freigegeben', freigegeben_am: null }),
      'publiziert'
    )

    expect(ergebnis.erlaubt).toBe(false)
    expect(ergebnis.grund).toContain('nachvollziehbar')
  })

  it('publiziert aus einer belegten Freigabe', () => {
    expect(
      pruefeUebergang(
        zustand({
          status: 'freigegeben',
          freigegeben_am: '2026-08-11T09:00:00Z'
        }),
        'publiziert'
      ).erlaubt
    ).toBe(true)
  })
})

describe('inhaltGeaendert', () => {
  it('erkennt eine echte Textaenderung', () => {
    expect(inhaltGeaendert(zustand(), { text: 'Etwas ganz anderes.' })).toBe(
      true
    )
    expect(inhaltGeaendert(zustand(), { titel: 'Neuer Titel' })).toBe(true)
  })

  it('haelt eine unveraenderte Wiedervorlage nicht fuer eine Aenderung', () => {
    expect(inhaltGeaendert(zustand(), { text: 'Im Jahr 2025 ...' })).toBe(false)
  })

  it('ignoriert Felder, die gar nicht geschrieben werden', () => {
    expect(inhaltGeaendert(zustand(), { status: 'publiziert' })).toBe(false)
  })
})

describe('ruecksetzungNachAenderung', () => {
  // An approval refers to the text somebody read. Rewriting it afterwards and
  // keeping the approval would publish something nobody checked — the same
  // principle as clearing a stale summary when its source changes.
  it('nimmt eine Freigabe zurueck, wenn der Text geaendert wird', () => {
    const zuruecksetzen = ruecksetzungNachAenderung({ status: 'freigegeben' })

    expect(zuruecksetzen?.['status']).toBe('entwurf')
    expect(zuruecksetzen?.['entscheidung']).toBeNull()
    expect(zuruecksetzen?.['freigegeben_am']).toBeNull()
    // The old approval link must stop working, too.
    expect(zuruecksetzen?.['freigabe_token_hash']).toBeNull()
  })

  it('holt eine laufende Gegenpruefung zurueck', () => {
    expect(
      ruecksetzungNachAenderung({ status: 'in_pruefung' })?.['status']
    ).toBe('entwurf')
  })

  it('laesst einen Entwurf in Ruhe', () => {
    expect(ruecksetzungNachAenderung({ status: 'entwurf' })).toBeNull()
  })

  // Editing a published article is a separate decision — the state machine
  // handles pulling it back, this function does not silently unpublish.
  it('setzt eine publizierte Meldung nicht von selbst zurueck', () => {
    expect(ruecksetzungNachAenderung({ status: 'publiziert' })).toBeNull()
  })
})
