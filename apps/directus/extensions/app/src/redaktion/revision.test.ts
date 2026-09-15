import { describe, expect, it } from 'vitest'
import type { OdsRecord } from '../shared/ods'
import { revisionsBefund, revisionsHinweis } from './revision'

const meldung = (
  text: string
): { titel: string | null; lead: string | null; text: string | null } => ({
  titel: 'Abfall in Binningen',
  lead: null,
  text
})

const zeilen: OdsRecord[] = [
  { gemeinde: 'Binningen', kategorie: 'Papier', menge: 25 },
  { gemeinde: 'Binningen', kategorie: 'Glas', menge: 75 }
]

describe('revisionsBefund', () => {
  it('schweigt, wenn jede Prozentangabe im neuen Stand noch traegt', () => {
    // 25 von 100 sind 25 Prozent — auch nach der Revision ableitbar.
    expect(
      revisionsBefund(meldung('Papier macht 25 Prozent aus.'), zeilen, [])
    ).toBeNull()
  })

  it('nennt die Zahlen, die der neue Stand nicht mehr belegt', () => {
    expect(
      revisionsBefund(meldung('Papier macht 31 Prozent aus.'), zeilen, [])
    ).toEqual([31])
  })

  it('nimmt die Einordnung des neuen Standes als weitere Erlaubnis', () => {
    expect(
      revisionsBefund(
        meldung('Das sind 42 Prozent des Kantonsschnitts.'),
        zeilen,
        [42]
      )
    ).toBeNull()
  })

  it('prueft Titel, Lead und Text zusammen', () => {
    const m = {
      titel: 'Ein Plus von 88 Prozent',
      lead: 'und 91 Prozent im Lead',
      text: 'Papier macht 25 Prozent aus.'
    }
    expect(revisionsBefund(m, zeilen, [])).toEqual([88, 91])
  })

  it('schweigt bei einer Meldung ohne Text', () => {
    expect(
      revisionsBefund({ titel: null, lead: null, text: null }, zeilen, [])
    ).toBeNull()
  })

  it('schweigt, wenn der neue Stand fuer diese Gemeinde leer ist', () => {
    // Keine Zeilen heisst keine Grundlage, nicht "alles falsch": der Waechter
    // darf nicht anschlagen, weil eine Gemeinde aus dem Datensatz fiel.
    expect(
      revisionsBefund(meldung('Papier macht 25 Prozent aus.'), [], [])
    ).toBeNull()
  })
})

describe('revisionsHinweis', () => {
  it('nennt jede Zahl und sagt, was der Leser tun muss', () => {
    const hinweis = revisionsHinweis([31, 68])
    expect(hinweis).toContain('31')
    expect(hinweis).toContain('68')
    expect(hinweis).toContain('revidiert')
  })
})
