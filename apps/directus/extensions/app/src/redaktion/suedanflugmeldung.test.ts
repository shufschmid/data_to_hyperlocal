import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMonatsblatt } from '../shared/euroairport'
import {
  bewerteMonat,
  buildSuedanflugPrompt,
  buildSuedanflugRevision,
  mitQuelle,
  ohneQuelle,
  ortsWarnungen,
  provisorikWarnung,
  quelleZeile,
  STANDARD_SCHWELLEN,
  suedanflugAttributionsWarnung,
  suedanflugFakten,
  zahlWarnungenSuedanflug,
  type SuedanflugFakten
} from './suedanflug'

const URL_JULI =
  'https://www.euroairport.com/sites/default/files/medias/file/2026/08/Utilisation_ILS33_pour_2026_WEBv0_07.pdf'

function fakten(
  gemeinde = 'Binningen',
  blattName = '2026-07'
): SuedanflugFakten {
  const blatt = parseMonatsblatt(
    readFileSync(
      join(
        __dirname,
        '..',
        'shared',
        'euroairport',
        'fixtures',
        `${blattName}.txt`
      ),
      'utf8'
    )
  )
  return suedanflugFakten({
    blatt,
    gemeinde,
    quelleUrl: URL_JULI,
    bewertung: bewerteMonat(blatt, [], STANDARD_SCHWELLEN),
    schwellen: STANDARD_SCHWELLEN
  })
}

describe('suedanflugFakten', () => {
  it('reicht nur Zahlen weiter, die im Blatt stehen oder gerechnet wurden', () => {
    const f = fakten()

    expect(f.gemeinde).toBe('Binningen')
    expect(f.monatText).toBe('Juli 2026')
    expect(f.anfluege).toBe(3778)
    expect(f.suedlandungen).toBe(1652)
    expect(f.quote).toBe(43.7)
    expect(f.aktualisiertAmText).toBe('4. August 2026')
    expect(f.provisorisch).toBe(true)
    expect(f.quelleUrl).toBe(URL_JULI)
  })
})

describe('buildSuedanflugPrompt', () => {
  it('nennt die Gemeinde, die Zahlen und die Ortsregel', () => {
    const prompt = buildSuedanflugPrompt(fakten())

    expect(prompt).toContain('Binningen')
    expect(prompt).toContain('3778')
    expect(prompt).toContain('1652')
    expect(prompt).toContain('43,7')
    // The whole point: the quota is the airport's, not the municipality's.
    expect(prompt).toContain('ueber den Sueden')
    expect(prompt).toContain('provisorisch')
  })

  it('haelt keine Schwelle zurueck, die gerissen wurde', () => {
    expect(buildSuedanflugPrompt(fakten())).toContain(
      'Monatsschwelle der Redaktion'
    )
  })

  it('sagt, ueber wie viele Monate die Jahresquote geht', () => {
    // Complete or declared: one month is not a year, and the text must be able
    // to say which months the figure covers.
    expect(buildSuedanflugPrompt(fakten())).toContain('1 Monat')
  })

  it('nennt die Befunde des Blatts, statt sie zu verschweigen', () => {
    const prompt = buildSuedanflugPrompt(fakten('Allschwil', '2026-08'))

    expect(prompt).toContain('widerspricht sich')
  })
})

describe('ortsWarnungen', () => {
  const f = fakten()

  it('meldet einen Satz, der die Quote der Gemeinde zuschreibt', () => {
    expect(
      ortsWarnungen('In Binningen lag die Quote im Juli bei 43,7 Prozent.', f)
    ).toEqual([
      'Die Quote gilt fuer den Flughafen, nicht fuer Binningen. Dieser Satz ' +
        'schreibt sie der Gemeinde zu: «In Binningen lag die Quote im Juli bei 43,7 Prozent.»'
    ])
  })

  it('meldet den Genitiv', () => {
    expect(
      ortsWarnungen('Binningens Suedanflugquote stieg auf 43,7 Prozent.', f)
        .length
    ).toBe(1)
  })

  it('meldet «die Quote fuer Binningen»', () => {
    expect(
      ortsWarnungen('Die Quote fuer Binningen betrug 43,7 Prozent.', f).length
    ).toBe(1)
  })

  it('laesst die richtige Form durch', () => {
    expect(
      ortsWarnungen(
        '43,7 Prozent aller Landungen erfolgten ueber den Sueden, also ueber Binningen.',
        f
      )
    ).toEqual([])
  })

  it('laesst einen Satz ueber die Gemeinde ohne Zahl durch', () => {
    expect(
      ortsWarnungen('In Binningen ist der Fluglaerm seit Jahren ein Thema.', f)
    ).toEqual([])
  })

  it('meldet jeden fehlerhaften Satz einzeln', () => {
    expect(
      ortsWarnungen(
        'In Binningen lag die Quote bei 43,7 Prozent. Binningens Anteil war hoch.',
        f
      ).length
    ).toBe(2)
  })
})

describe('provisorikWarnung', () => {
  const f = fakten()

  it('meldet, wenn die Provisorik ganz fehlt', () => {
    expect(
      provisorikWarnung('Im Juli 2026 gingen 43,7 Prozent ueber den Sueden.', f)
    ).toContain('provisorisch')
  })

  it('meldet, wenn die nachtraegliche Korrektur fehlt', () => {
    const warnung = provisorikWarnung(
      'Die Zahlen des EuroAirport sind provisorisch.',
      f
    )

    expect(warnung).not.toBeNull()
    expect(warnung).toContain('nachtraeglich')
  })

  it('schweigt, wenn beides dasteht', () => {
    expect(
      provisorikWarnung(
        'Die Zahlen sind provisorisch; der EuroAirport korrigiert einzelne Monate nachtraeglich.',
        f
      )
    ).toBeNull()
  })

  it('schweigt bei einem Blatt, das sich nicht selbst provisorisch nennt', () => {
    const endgueltig: SuedanflugFakten = { ...f, provisorisch: false }

    expect(
      provisorikWarnung('Im Juli waren es 43,7 Prozent.', endgueltig)
    ).toBeNull()
  })
})

describe('suedanflugAttributionsWarnung', () => {
  const f = fakten()

  it('meldet einen Text, der den EuroAirport nicht nennt', () => {
    expect(
      suedanflugAttributionsWarnung('Im Juli 2026 waren es 43,7 Prozent.', f)
    ).not.toBeNull()
  })

  it('schweigt, wenn der Flughafen als Quelle dasteht', () => {
    expect(
      suedanflugAttributionsWarnung(
        'Wie der EuroAirport meldet, waren es 43,7 Prozent.',
        f
      )
    ).toBeNull()
  })
})

describe('zahlWarnungenSuedanflug', () => {
  const f = fakten()

  it('laesst die uebergebenen Zahlen durch', () => {
    expect(
      zahlWarnungenSuedanflug(
        'Im Juli 2026 gingen 1652 von 3778 Landungen ueber den Sueden, 43,7 Prozent. ' +
          'An 21 Tagen lag der Anteil ueber 30 Prozent.',
        f
      )
    ).toEqual([])
  })

  it('meldet eine Zahl, die nirgends steht', () => {
    expect(
      zahlWarnungenSuedanflug('Rund 4000 Menschen beschwerten sich.', f)
    ).toEqual(['Zahl "4000" steht nicht in den Angaben.'])
  })

  it('laesst das Datum des hoechsten Tages durch', () => {
    // 20 July 2026, 120 of 126 — handed over by `bewerteMonat`, so the day,
    // the month and the year are all material the text may carry.
    expect(
      zahlWarnungenSuedanflug(
        'Am 20. Juli 2026 gingen 120 von 126 Landungen ueber den Sueden.',
        f
      )
    ).toEqual([])
  })
})

describe('quelleZeile und mitQuelle', () => {
  it('baut genau eine Adresse, und zwar die des Monatsblatts', () => {
    expect(quelleZeile(fakten())).toBe(
      `Quelle: EuroAirport, ILS-33-Nutzungsstatistik Juli 2026 (provisorisch), ${URL_JULI}`
    )
  })

  it('haengt sie als eigenen Absatz an', () => {
    const text = mitQuelle('Ein Satz.', fakten())

    expect(text).toBe(`Ein Satz.\n\n${quelleZeile(fakten())}`)
  })

  it('nimmt sie vor einer Ueberarbeitung wieder weg', () => {
    const text = mitQuelle('Ein Satz.', fakten())

    expect(ohneQuelle(text)).toBe('Ein Satz.')
  })
})

describe('buildSuedanflugRevision', () => {
  it('wiederholt die Angaben und nennt die Anweisung', () => {
    const prompt = buildSuedanflugRevision(
      fakten(),
      { titel: 'Alt', lead: 'Alter Lead', text: 'Alter Text' },
      'Kuerzer, bitte.'
    )

    expect(prompt).toContain('3778')
    expect(prompt).toContain('Alter Lead')
    expect(prompt).toContain('Kuerzer, bitte.')
  })
})
