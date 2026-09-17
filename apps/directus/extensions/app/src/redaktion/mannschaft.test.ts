import { describe, expect, it } from 'vitest'
import {
  ersteMannschaft,
  ersteMannschaftAbgleich,
  istFrauenwettbewerb,
  ligaRang
} from './mannschaft'

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

describe('ersteMannschaftAbgleich', () => {
  const neu = (wettbewerb: string) => ({ wettbewerb })
  const alt = (id: string, wettbewerb: string) => ({ id, wettbewerb })

  // Der Grund fuer die ganze Aenderung: die Frauen- und die unteren Teams
  // standen monatelang im Reiter, ohne dass je eine Meldung daraus wurde.
  it('nimmt gespeicherte Frauen- und Unterligaspiele wieder heraus', () => {
    const abgleich = ersteMannschaftAbgleich(
      [neu('Meisterschaft - 2. Liga interregional / Gruppe 3')],
      [
        alt('a', 'Meisterschaft - 2. Liga interregional / Gruppe 3'),
        alt('b', 'Meisterschaft - 2. Liga (FAEW)'),
        alt('c', 'Meisterschaft - 5. Liga / Vorrunde / Gruppe 2')
      ],
      '2. Liga interregional'
    )
    expect(abgleich.behalten).toHaveLength(1)
    expect(abgleich.entfernen.map((s) => s.id)).toEqual(['b', 'c'])
  })

  it('schreibt gar nicht erst, was unter der ersten Mannschaft liegt', () => {
    const abgleich = ersteMannschaftAbgleich(
      [
        neu('Meisterschaft - 2. Liga interregional / Gruppe 3'),
        neu('Meisterschaft - 4. Liga / Gruppe 3'),
        neu('Meisterschaft - Frauen 4. Liga / Vorrunde')
      ],
      [],
      null
    )
    expect(abgleich.behalten).toEqual([
      neu('Meisterschaft - 2. Liga interregional / Gruppe 3')
    ])
    expect(abgleich.entfernen).toEqual([])
  })

  // Der Grund, warum Gespeichertes ueberhaupt mitzaehlt: an einem Wochenende
  // ohne Spiel der ersten Mannschaft waere sonst die vierte die erste — mit
  // Resultat, Meldung und allem.
  it('kennt die beste Liga aus dem Bestand, auch wenn sie heute nicht spielt', () => {
    const abgleich = ersteMannschaftAbgleich(
      [neu('Meisterschaft - 4. Liga / Gruppe 3')],
      [alt('a', 'Meisterschaft - 2. Liga interregional / Gruppe 3')],
      null
    )
    expect(abgleich.behalten).toEqual([])
    expect(abgleich.entfernen).toEqual([])
  })

  // Sm'Aesch Pfeffingen: die eigene Mannschaft IST eine Damenmannschaft.
  it('laesst dem Damenverein seine Spiele', () => {
    const abgleich = ersteMannschaftAbgleich(
      [neu('Nationalliga A (Damen)')],
      [alt('a', 'Nationalliga A (Damen)')],
      'Nationalliga A (Damen)'
    )
    expect(abgleich.behalten).toHaveLength(1)
    expect(abgleich.entfernen).toEqual([])
  })

  it('raeumt nichts weg, wo sich nichts einordnen laesst', () => {
    const abgleich = ersteMannschaftAbgleich(
      [],
      [alt('a', 'Irgendein Turnier'), alt('b', 'Anderes Turnier')],
      null
    )
    expect(abgleich.entfernen).toEqual([])
  })
})

// Basketball, seit dem 17. September 2026. Dort wird pro GRUPPE gelesen, und
// eine Gruppe ist genau eine Liga: alle Spiele eines Vereins tragen denselben
// `wettbewerb`, die Regel hat also nichts zu entscheiden. Was sie trotzdem
// koennen muss, ist die Damenmannschaft von BC Arlesheim stehen zu lassen —
// sie spielt eine Stufe hoeher als die Herren, und das ist der Fall
// Sm'Aesch Pfeffingen ein zweites Mal.
describe('Basketball', () => {
  const partie = (wettbewerb: string) => ({ wettbewerb })

  it('haelt die Damenmannschaft, wenn die Liga des Vereins sie nennt', () => {
    const arlesheim = 'Damen 1: Nationalliga B — Herren 1: 1. Liga National'
    expect(ersteMannschaft([partie('NLB Women')], arlesheim)).toHaveLength(1)
  })

  it('haelt sie auch, wenn nur die Quelle sie englisch benennt', () => {
    // `istFrauenwettbewerb` kennt «Women» nicht, und das ist hier richtig: die
    // Regel wirft nur weg, was sie als Frauenwettbewerb ERKENNT. Ein
    // «women» im Muster wuerde das Aushaengeschild von Arlesheim
    // stummschalten, sobald die Liga des Vereins nicht «Damen» sagt.
    expect(istFrauenwettbewerb('NLB Women')).toBe(false)
    expect(ersteMannschaft([partie('NLB Women')], null)).toHaveLength(1)
  })

  it('stellt die NLB der Frauen ueber die NL1 der Maenner', () => {
    expect(ligaRang('NLB Women')).toBe(1)
    // «NL1 Men» steht in der Rangfolge nicht — ein unbekannter Name ordnet
    // sich nicht ein, statt sich nach oben zu sortieren.
    expect(ligaRang('NL1 Men')).toBeNull()
  })
})
