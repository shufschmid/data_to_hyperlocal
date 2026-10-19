import { describe, expect, it } from 'vitest'
import { auszugMitFundstellen, FUNDSTELLEN_MAX } from './auszug'

// The Regierungsbulletin of 13 October 2026, in shape: 4'800 characters of
// cantonal business, and the one Allschwil passage at character 3'000.
const BULLETIN = [
  'Der Regierungsrat hat an seiner Sitzung vom 13. Oktober 2026 folgende Beschlüsse gefasst. ',
  'Einbürgerungen: Im ordentlichen Verfahren sollen 39 Personen in das Schweizer Bürgerrecht aufgenommen werden. ',
  'x '.repeat(1400),
  '100. Geburtstage: Am Mittwoch, 16. Dezember 2026 feiert Elisabetha Maria Dörflinger in Allschwil ihren 100. Geburtstag. ',
  'Regierungsrätin Kathrin Schweizer wird der Jubilarin die Glückwünsche des Regierungsrats überbringen. ',
  'y '.repeat(800)
].join('')

describe('auszugMitFundstellen', () => {
  it('haengt die Stelle an, die die Gemeinde nennt, wenn der Anfang sie nicht zeigt', () => {
    const auszug = auszugMitFundstellen(
      { anriss: null, text: BULLETIN },
      'Allschwil',
      400
    )
    expect(auszug.startsWith('Der Regierungsrat hat an seiner Sitzung')).toBe(
      true
    )
    expect(auszug).toContain('[Fundstelle «Allschwil»] …')
    expect(auszug).toContain('in Allschwil ihren 100. Geburtstag')
    expect(auszug).toContain('Regierungsrätin Kathrin Schweizer')
    // Seams are visible on both sides of the passage.
    expect(auszug).toMatch(/Geburtstag\. Regierungsrätin[^\n]*…$/u)
  })

  it('wiederholt nicht, was der Anfang schon zeigt, und bleibt ohne Fund beim Anfang', () => {
    expect(
      auszugMitFundstellen(
        { anriss: null, text: 'Tempo 30 in Allschwil kommt.' },
        'Allschwil',
        400
      )
    ).toBe('Tempo 30 in Allschwil kommt.')
    expect(
      auszugMitFundstellen({ anriss: null, text: BULLETIN }, 'Aesch', 400)
    ).not.toContain('Fundstelle')
    // The teaser is the beginning, so a find in the TEXT always travels.
    const mitAnriss = auszugMitFundstellen(
      { anriss: 'Kurzer Anriss.', text: 'Ein Projekt in Aesch startet.' },
      'Aesch',
      400
    )
    expect(mitAnriss.startsWith('Kurzer Anriss.')).toBe(true)
    expect(mitAnriss).toContain(
      '[Fundstelle «Aesch»] Ein Projekt in Aesch startet.'
    )
  })

  it('matcht nur ganze Woerter — Aeschenplatz ist nicht Aesch', () => {
    expect(
      auszugMitFundstellen(
        { anriss: 'Anriss.', text: 'Stau am Aeschenplatz in Basel.' },
        'Aesch',
        400
      )
    ).toBe('Anriss.')
  })

  it('deckelt die Fundstellen und zaehlt den Rest', () => {
    const text = `${'z '.repeat(300)}${Array.from(
      { length: FUNDSTELLEN_MAX + 2 },
      (_, i) => `Absatz ${i + 1} über Riehen. ${'w '.repeat(200)}`
    ).join('')}`
    const auszug = auszugMitFundstellen({ anriss: null, text }, 'Riehen', 400)
    expect(auszug.match(/\[Fundstelle «Riehen»\]/gu)).toHaveLength(
      FUNDSTELLEN_MAX
    )
    expect(auszug).toContain('(2 weitere Stellen nennt Riehen ebenfalls.)')
  })
})
