import { describe, expect, it } from 'vitest'
import { ersteMannschaft, istFrauenwettbewerb, ligaRang } from './mannschaft'

const s = (wettbewerb: string) => ({ wettbewerb })

describe('istFrauenwettbewerb', () => {
  it('erkennt die Schreibweisen des Verbands', () => {
    expect(istFrauenwettbewerb('Meisterschaft - 2. Liga (FAEW)')).toBe(true)
    expect(
      istFrauenwettbewerb('Meisterschaft - Frauen 4. Liga / Vorrunde')
    ).toBe(true)
    expect(istFrauenwettbewerb('Nationalliga A (Damen)')).toBe(true)
  })

  it('haelt Herren- und neutrale Wettbewerbe heraus', () => {
    expect(
      istFrauenwettbewerb('Meisterschaft - 2. Liga interregional / Gruppe 3')
    ).toBe(false)
    expect(istFrauenwettbewerb('1. Liga (Herren)')).toBe(false)
  })
})

describe('ligaRang', () => {
  // Die Reihenfolge ist der Kern: interregional muss VOR "2. Liga" geprueft
  // werden, sonst raent die erste Mannschaft unter ihre eigene dritte.
  it('setzt die interregionale Liga ueber die 2. Liga', () => {
    const inter = ligaRang('Meisterschaft - 2. Liga interregional / Gruppe 3')
    const zweite = ligaRang('Meisterschaft - 2. Liga (FAEW)')
    expect(inter).not.toBeNull()
    expect(zweite).not.toBeNull()
    expect(inter as number).toBeLessThan(zweite as number)
  })

  it('ordnet die uebrigen Ligen absteigend', () => {
    const r = [
      'Nationalliga A (Damen)',
      '1. Liga',
      'Meisterschaft - 3. Liga',
      'Meisterschaft - 5. Liga'
    ]
      .map(ligaRang)
      .map((x) => x as number)
    expect(r).toEqual([...r].sort((a, b) => a - b))
  })

  it('sagt nichts, wo es nichts zu ordnen gibt', () => {
    expect(ligaRang('Meisterschaft - Cup / 1. Runde')).toBeNull()
  })
})

describe('ersteMannschaft', () => {
  // Der Fall aus der Produktion, 29. August 2026.
  it('nimmt vom SC Binningen nur die erste Mannschaft', () => {
    const alle = [
      s('Meisterschaft - 2. Liga interregional / Gruppe 3'),
      s('Meisterschaft - 2. Liga (FAEW)'),
      s('Meisterschaft - 5. Liga / Vorrunde / Gruppe 2'),
      s('Meisterschaft - 4. Liga / Gruppe 3')
    ]
    expect(ersteMannschaft(alle, '2. Liga interregional')).toEqual([
      s('Meisterschaft - 2. Liga interregional / Gruppe 3')
    ])
  })

  // Sm'Aesch Pfeffingen IST eine Damenmannschaft und das Aushaengeschild von
  // Aesch. Eine pauschale Frauen-Regel haette sie stumm geschaltet.
  it('behaelt den Verein, dessen eigene Mannschaft eine Damenmannschaft ist', () => {
    const alle = [s('Nationalliga A (Damen)'), s('Nationalliga A (Damen)')]
    expect(ersteMannschaft(alle, 'Nationalliga A (Damen)')).toHaveLength(2)
  })

  // vereine.liga ist ein Freitext-Feld des Redaktors: gemessen stehen dort
  // "3. und 4. Liga" und null. Die Regel darf davon nicht abhaengen.
  it('kommt ohne brauchbare Liga-Angabe aus', () => {
    const alle = [
      s('Meisterschaft - 3. Liga / Gruppe 2'),
      s('Meisterschaft - 4. Liga / Gruppe 3')
    ]
    expect(ersteMannschaft(alle, null)).toEqual([
      s('Meisterschaft - 3. Liga / Gruppe 2')
    ])
    expect(ersteMannschaft(alle, '3. und 4. Liga')).toEqual([
      s('Meisterschaft - 3. Liga / Gruppe 2')
    ])
  })

  it('nimmt den Cup der ersten Mannschaft mit', () => {
    const alle = [
      s('Meisterschaft - 2. Liga interregional'),
      s('Cup - 1. Runde')
    ]
    expect(ersteMannschaft(alle, null)).toHaveLength(2)
  })

  // Lieber alles als nichts, wenn wir die Ligen nicht einordnen koennen.
  it('behaelt alles, wo sich nichts einordnen laesst', () => {
    const alle = [s('Irgendein Turnier'), s('Anderes Turnier')]
    expect(ersteMannschaft(alle, null)).toHaveLength(2)
  })

  it('vertraegt eine leere Liste', () => {
    expect(ersteMannschaft([], null)).toEqual([])
  })
})
