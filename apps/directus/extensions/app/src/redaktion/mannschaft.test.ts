import { describe, expect, it } from 'vitest'
import {
  annotierterRang,
  ersteMannschaft,
  ersteMannschaftAbgleich,
  istFrauenwettbewerb,
  ligaRang,
  mannschaftsZusatz,
  teamNummer
} from './mannschaft'

/** A match of «Verein» against someone; the club's side is printed as `eigene`. */
const s = (wettbewerb: string, eigene = 'Verein') => ({
  wettbewerb,
  heim: eigene,
  gast: 'FC Gegner'
})

const VEREIN = { name: 'Verein', liga: null }

describe('istFrauenwettbewerb', () => {
  it('erkennt die Schreibweisen des Verbands', () => {
    expect(
      istFrauenwettbewerb('Meisterschaft - Frauen 4. Liga / Vorrunde')
    ).toBe(true)
    expect(istFrauenwettbewerb('Meisterschaft - Frauen 3. Liga')).toBe(true)
    expect(istFrauenwettbewerb('Nationalliga A (Damen)')).toBe(true)
  })

  // Am 12. Oktober 2026 am Match Center gemessen: «2. Liga (FAEW)» ist die
  // regionale 2. Liga der MAENNER — der FC Pratteln fuehrt sie neben der
  // 5. Liga als seine zwei Aktivteams, und die Frauenligen heissen «Frauen
  // 3. Liga». Sechs Wochen lang galt sie als Frauenliga, und drei Vereine
  // wurden mit ihrer zweiten Mannschaft berichtet.
  it('haelt die regionale 2. Liga (FAEW) fuer das, was sie ist: Maenner', () => {
    expect(istFrauenwettbewerb('Meisterschaft - 2. Liga (FAEW)')).toBe(false)
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
  // werden, sonst raent die erste Mannschaft unter ihre eigene zweite.
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

describe('mannschaftsZusatz', () => {
  it('liest, was der Verband an den Vereinsnamen haengt', () => {
    expect(
      mannschaftsZusatz(
        { heim: 'FC Münchenstein b', gast: 'FC Kleinlützel' },
        'FC Münchenstein'
      )
    ).toBe('b')
    expect(
      mannschaftsZusatz(
        { heim: 'FC Laufen (3.)', gast: 'SC Binningen (2. (FAEW))' },
        'SC Binningen'
      )
    ).toBe('(2. (faew))')
    expect(
      mannschaftsZusatz(
        { heim: 'FC Münchenstein a (4.)', gast: 'AS Timau Basel (2. (FAEW))' },
        'FC Münchenstein'
      )
    ).toBe('a (4.)')
  })

  it('gibt den blanken Namen als leeren Zusatz', () => {
    expect(
      mannschaftsZusatz(
        { heim: 'SC Dornach', gast: 'SC Binningen' },
        'SC Binningen'
      )
    ).toBe('')
  })

  it('verwechselt den Verein nicht mit einem Namensvetter', () => {
    // «SC Münchenstein» ist ein anderer Verein als «FC Münchenstein».
    expect(
      mannschaftsZusatz(
        { heim: 'SC Münchenstein', gast: 'FC Arlesheim' },
        'FC Münchenstein'
      )
    ).toBeNull()
    // Eine Spielgemeinschaft traegt den Namen, ist aber nicht der Verein.
    expect(
      mannschaftsZusatz(
        { heim: 'FC Reinach/SC Dornach', gast: 'FC Aesch' },
        'FC Reinach'
      )
    ).toBeNull()
  })

  it('kommt mit dem Apostroph der Volleyballseite zurecht', () => {
    expect(
      mannschaftsZusatz(
        { heim: 'BTV Aarau', gast: "Sm'Aesch Pfeffingen" },
        'Sm’Aesch Pfeffingen'
      )
    ).toBe('')
  })
})

describe('teamNummer', () => {
  it('ordnet den blanken Namen vor a vor b', () => {
    expect(teamNummer('')).toBe(0)
    expect(teamNummer('a')).toBe(1)
    expect(teamNummer('b')).toBe(2)
    expect(teamNummer('a (4.)')).toBe(1)
  })

  it('liest die Nummer der Handballseite', () => {
    expect(teamNummer('1 (m1)')).toBe(1)
    expect(teamNummer('2')).toBe(2)
  })

  it('haelt eine Annotation ohne Buchstaben fuer die blanke Mannschaft', () => {
    expect(teamNummer('(2. (faew))')).toBe(0)
    expect(teamNummer(null)).toBe(0)
  })
})

describe('annotierterRang', () => {
  it('liest die Liga aus der Cup-Annotation', () => {
    expect(annotierterRang('(3.)')).toBe(ligaRang('3. Liga'))
    expect(annotierterRang('a (4.)')).toBe(ligaRang('4. Liga'))
    expect(annotierterRang('(2. (faew))')).toBe(ligaRang('2. Liga (FAEW)'))
    expect(annotierterRang('(2. inter)')).toBe(
      ligaRang('2. Liga interregional')
    )
  })

  it('sagt nichts, wo keine Annotation steht', () => {
    expect(annotierterRang('')).toBeNull()
    expect(annotierterRang('b')).toBeNull()
    expect(annotierterRang(null)).toBeNull()
  })
})

describe('ersteMannschaft', () => {
  // Der Fall aus der Produktion, 29. August 2026: vier Mannschaften, alle
  // schlicht «SC Binningen».
  it('nimmt vom SC Binningen nur die erste Mannschaft', () => {
    const alle = [
      s('Meisterschaft - 2. Liga interregional / Gruppe 3'),
      s('Meisterschaft - 2. Liga (FAEW)'),
      s('Meisterschaft - 5. Liga / Vorrunde / Gruppe 2'),
      s('Meisterschaft - 4. Liga / Gruppe 3')
    ]
    expect(
      ersteMannschaft(alle, { name: 'Verein', liga: '2. Liga interregional' })
    ).toEqual([s('Meisterschaft - 2. Liga interregional / Gruppe 3')])
  })

  // FC Pratteln, FC Aesch, FC Amicitia Riehen: die erste Mannschaft spielt
  // die regionale 2. Liga, und die hiess sechs Wochen lang faelschlich Frauen.
  it('berichtet den FC Pratteln in der 2. Liga, nicht in der 5.', () => {
    const alle = [
      s('Meisterschaft - 5. Liga / Vorrunde / Gruppe 1'),
      s('Meisterschaft - 2. Liga (FAEW)')
    ]
    expect(ersteMannschaft(alle, { name: 'Verein', liga: '2. Liga' })).toEqual([
      s('Meisterschaft - 2. Liga (FAEW)')
    ])
  })

  // Sm'Aesch Pfeffingen IST eine Damenmannschaft und das Aushaengeschild von
  // Aesch. Eine pauschale Frauen-Regel haette sie stumm geschaltet.
  it('behaelt den Verein, dessen eigene Mannschaft eine Damenmannschaft ist', () => {
    const alle = [s('Nationalliga A (Damen)'), s('Nationalliga A (Damen)')]
    expect(
      ersteMannschaft(alle, { name: 'Verein', liga: 'Nationalliga A (Damen)' })
    ).toHaveLength(2)
  })

  it('laesst eine Frauenmannschaft des Verbands weg', () => {
    const alle = [
      s('Meisterschaft - 3. Liga / Gruppe 2'),
      s('Meisterschaft - Frauen 3. Liga')
    ]
    expect(ersteMannschaft(alle, VEREIN)).toEqual([
      s('Meisterschaft - 3. Liga / Gruppe 2')
    ])
  })

  // vereine.liga ist ein Freitext-Feld des Redaktors: gemessen stehen dort
  // "3. und 4. Liga" und null. Die Regel darf davon nicht abhaengen.
  it('kommt ohne brauchbare Liga-Angabe aus', () => {
    const alle = [
      s('Meisterschaft - 3. Liga / Gruppe 2'),
      s('Meisterschaft - 4. Liga / Gruppe 3')
    ]
    expect(ersteMannschaft(alle, VEREIN)).toEqual([
      s('Meisterschaft - 3. Liga / Gruppe 2')
    ])
    expect(
      ersteMannschaft(alle, { name: 'Verein', liga: '3. und 4. Liga' })
    ).toEqual([s('Meisterschaft - 3. Liga / Gruppe 2')])
  })

  // FC Münchenstein: a in der 4. Liga Gruppe 2, b in der 4. Liga Gruppe 3.
  // Der Rang kann sie nicht trennen, der Buchstabe schon.
  it('nimmt von zwei Teams derselben Liga nur das a', () => {
    const alle = [
      s('Meisterschaft - 4. Liga / Gruppe 2', 'FC Münchenstein a'),
      s('Meisterschaft - 4. Liga / Gruppe 3', 'FC Münchenstein b'),
      s('Meisterschaft - 5. Liga / Vorrunde / Gruppe 2', 'FC Münchenstein')
    ]
    expect(
      ersteMannschaft(alle, { name: 'FC Münchenstein', liga: null })
    ).toEqual([s('Meisterschaft - 4. Liga / Gruppe 2', 'FC Münchenstein a')])
  })

  it('zieht den blanken Namen dem a vor', () => {
    const alle = [
      s('Meisterschaft - 3. Liga / Gruppe 1', 'FC Aesch a'),
      s('Meisterschaft - 3. Liga / Gruppe 2', 'FC Aesch')
    ]
    expect(ersteMannschaft(alle, { name: 'FC Aesch', liga: null })).toEqual([
      s('Meisterschaft - 3. Liga / Gruppe 2', 'FC Aesch')
    ])
  })

  it('nimmt den Cup der ersten Mannschaft mit', () => {
    const alle = [
      s('Meisterschaft - 2. Liga interregional'),
      s('Cup - 1. Runde')
    ]
    expect(ersteMannschaft(alle, VEREIN)).toHaveLength(2)
  })

  // Der Basler Cup annotiert jedes Team mit seiner Liga. Der SC Binningen
  // tritt dort mit seiner 2.-Liga-Mannschaft an — die interregionale darf
  // nicht —, und am 9. September 2026 wurde deren 6:8 gegen Laufen als
  // erste Mannschaft entworfen.
  it('liest im Cup die Annotation und laesst die zweite Mannschaft weg', () => {
    const alle = [
      s('Meisterschaft - 2. Liga interregional / Gruppe 3', 'SC Binningen'),
      {
        wettbewerb: 'Cup - Basler Cup - 1/16 - Final',
        heim: 'FC Laufen (3.)',
        gast: 'SC Binningen (2. (FAEW))'
      }
    ]
    expect(ersteMannschaft(alle, { name: 'SC Binningen', liga: null })).toEqual(
      [s('Meisterschaft - 2. Liga interregional / Gruppe 3', 'SC Binningen')]
    )
  })

  it('behaelt den Cup, wo die Annotation die erste Mannschaft nennt', () => {
    const alle = [
      s('Meisterschaft - 2. Liga (FAEW)', 'FC Aesch'),
      {
        wettbewerb: 'Cup - Basler Cup - 1/16 - Final',
        heim: 'US Olympia 1963 (3.)',
        gast: 'FC Aesch (2. (FAEW))'
      },
      s('Meisterschaft - 3. Liga / Gruppe 2', 'FC Aesch')
    ]
    expect(
      ersteMannschaft(alle, { name: 'FC Aesch', liga: null })
    ).toHaveLength(2)
  })

  it('verbindet Buchstabe und Annotation im Cup', () => {
    const cupA = {
      wettbewerb: 'Cup - Basler Cup - 1/16 - Final',
      heim: 'FC Münchenstein a (4.)',
      gast: 'AS Timau Basel (2. (FAEW))'
    }
    const cupB = {
      wettbewerb: 'Cup - Basler Cup - 1/16 - Final',
      heim: 'FC Münchenstein b (4.)',
      gast: 'FC Therwil (3.)'
    }
    const alle = [
      s('Meisterschaft - 4. Liga / Gruppe 2', 'FC Münchenstein a'),
      cupA,
      cupB
    ]
    expect(
      ersteMannschaft(alle, { name: 'FC Münchenstein', liga: null })
    ).toEqual([
      s('Meisterschaft - 4. Liga / Gruppe 2', 'FC Münchenstein a'),
      cupA
    ])
  })

  it('laesst einen Cup ohne Annotation nur weg, wenn der Buchstabe es sagt', () => {
    const alle = [
      s('Meisterschaft - 4. Liga / Gruppe 2', 'FC Münchenstein a'),
      s('Cup - 1. Runde', 'FC Münchenstein b'),
      s('Cup - 1. Runde', 'FC Münchenstein')
    ]
    expect(
      ersteMannschaft(alle, { name: 'FC Münchenstein', liga: null })
    ).toEqual([
      s('Meisterschaft - 4. Liga / Gruppe 2', 'FC Münchenstein a'),
      s('Cup - 1. Runde', 'FC Münchenstein')
    ])
  })

  // Lieber alles als nichts, wenn wir die Ligen nicht einordnen koennen.
  it('behaelt alles, wo sich nichts einordnen laesst', () => {
    const alle = [s('Irgendein Turnier'), s('Anderes Turnier')]
    expect(ersteMannschaft(alle, VEREIN)).toHaveLength(2)
  })

  it('vertraegt eine leere Liste', () => {
    expect(ersteMannschaft([], VEREIN)).toEqual([])
  })
})

describe('ersteMannschaftAbgleich', () => {
  const neu = (wettbewerb: string, eigene = 'Verein') => s(wettbewerb, eigene)
  const alt = (id: string, wettbewerb: string, eigene = 'Verein') => ({
    id,
    ...s(wettbewerb, eigene)
  })

  // Der Grund fuer die ganze Aenderung: die Frauen- und die unteren Teams
  // standen monatelang im Reiter, ohne dass je eine Meldung daraus wurde.
  it('nimmt gespeicherte Frauen- und Unterligaspiele wieder heraus', () => {
    const abgleich = ersteMannschaftAbgleich(
      [neu('Meisterschaft - 2. Liga interregional / Gruppe 3')],
      [
        alt('a', 'Meisterschaft - 2. Liga interregional / Gruppe 3'),
        alt('b', 'Meisterschaft - Frauen 3. Liga'),
        alt('c', 'Meisterschaft - 5. Liga / Vorrunde / Gruppe 2')
      ],
      { name: 'Verein', liga: '2. Liga interregional' }
    )
    expect(abgleich.behalten).toHaveLength(1)
    expect(abgleich.entfernen.map((s) => s.id)).toEqual(['b', 'c'])
  })

  // Was die alte Regel beim FC Pratteln liegen liess: die 5. Liga steht im
  // Bestand, die 2. Liga kommt neu — und der Bestand muss weichen.
  it('ersetzt die zweite Mannschaft im Bestand durch die erste', () => {
    const abgleich = ersteMannschaftAbgleich(
      [neu('Meisterschaft - 2. Liga (FAEW)')],
      [alt('x', 'Meisterschaft - 5. Liga / Vorrunde / Gruppe 1')],
      { name: 'Verein', liga: '2. Liga' }
    )
    expect(abgleich.behalten).toHaveLength(1)
    expect(abgleich.entfernen.map((s) => s.id)).toEqual(['x'])
  })

  it('schreibt gar nicht erst, was unter der ersten Mannschaft liegt', () => {
    const abgleich = ersteMannschaftAbgleich(
      [
        neu('Meisterschaft - 2. Liga interregional / Gruppe 3'),
        neu('Meisterschaft - 4. Liga / Gruppe 3'),
        neu('Meisterschaft - Frauen 4. Liga / Vorrunde')
      ],
      [],
      VEREIN
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
      VEREIN
    )
    expect(abgleich.behalten).toEqual([])
    expect(abgleich.entfernen).toEqual([])
  })

  it('kennt auch den Buchstaben aus dem Bestand', () => {
    const abgleich = ersteMannschaftAbgleich(
      [neu('Meisterschaft - 4. Liga / Gruppe 3', 'FC Münchenstein b')],
      [alt('a', 'Meisterschaft - 4. Liga / Gruppe 2', 'FC Münchenstein a')],
      { name: 'FC Münchenstein', liga: null }
    )
    expect(abgleich.behalten).toEqual([])
    expect(abgleich.entfernen).toEqual([])
  })

  // Sm'Aesch Pfeffingen: die eigene Mannschaft IST eine Damenmannschaft.
  it('laesst dem Damenverein seine Spiele', () => {
    const abgleich = ersteMannschaftAbgleich(
      [neu('Nationalliga A (Damen)')],
      [alt('a', 'Nationalliga A (Damen)')],
      { name: 'Verein', liga: 'Nationalliga A (Damen)' }
    )
    expect(abgleich.behalten).toHaveLength(1)
    expect(abgleich.entfernen).toEqual([])
  })

  it('raeumt nichts weg, wo sich nichts einordnen laesst', () => {
    const abgleich = ersteMannschaftAbgleich(
      [],
      [alt('a', 'Irgendein Turnier'), alt('b', 'Anderes Turnier')],
      VEREIN
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
  // The source names the team, not the club: neither side matches, and the
  // rule has to cope with a match it cannot attach a letter to.
  const partie = (wettbewerb: string) => ({
    wettbewerb,
    heim: 'Arlesheim Women',
    gast: 'Riva Basket'
  })

  it('haelt die Damenmannschaft, wenn die Liga des Vereins sie nennt', () => {
    const arlesheim = 'Damen 1: Nationalliga B — Herren 1: 1. Liga National'
    expect(
      ersteMannschaft([partie('NLB Women')], {
        name: 'BC Arlesheim',
        liga: arlesheim
      })
    ).toHaveLength(1)
  })

  it('haelt sie auch, wenn nur die Quelle sie englisch benennt', () => {
    // `istFrauenwettbewerb` kennt «Women» nicht, und das ist hier richtig: die
    // Regel wirft nur weg, was sie als Frauenwettbewerb ERKENNT. Ein
    // «women» im Muster wuerde das Aushaengeschild von Arlesheim
    // stummschalten, sobald die Liga des Vereins nicht «Damen» sagt.
    expect(istFrauenwettbewerb('NLB Women')).toBe(false)
    expect(
      ersteMannschaft([partie('NLB Women')], {
        name: 'BC Arlesheim',
        liga: null
      })
    ).toHaveLength(1)
  })

  it('stellt die NLB der Frauen ueber die NL1 der Maenner', () => {
    expect(ligaRang('NLB Women')).toBe(1)
    // «NL1 Men» steht in der Rangfolge nicht — ein unbekannter Name ordnet
    // sich nicht ein, statt sich nach oben zu sortieren.
    expect(ligaRang('NL1 Men')).toBeNull()
  })
})
