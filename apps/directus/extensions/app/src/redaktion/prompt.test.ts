import { describe, expect, it } from 'vitest'
import {
  artikelFelder,
  buildArtikelSystemPrompt,
  buildArtikelUserPrompt,
  buildBriefingPrompt,
  parseArtikel,
  parseBriefing,
  type Briefing
} from './prompt'

const BRIEFING: Briefing = {
  jahr: '2025',
  winkel: 'Die Abfallmengen sinken kantonsweit, aber sehr ungleich.',
  kernaussagen: [
    'Wert der Gemeinde nennen',
    'Mit dem Kantonsschnitt vergleichen'
  ],
  kanton_kontext: 'Der Kantonsschnitt lag 2025 bei 280 Kilogramm pro Person.',
  vergleichsbasis: 'Kantonsschnitt und Vorjahreswert'
}

const REGELN = [{ regel: 'Nenne immer den Bezirk.' }]

describe('buildArtikelSystemPrompt — die Cache-Invariante', () => {
  // The entire cost model of this feature rests on this one property: the
  // system half must be byte-identical across every municipality of a run, so
  // the prompt cache carries it. A municipality name slipping in here would be
  // invisible in the output and only show up as a cost spike.
  it('ist fuer jede Gemeinde derselbe String', () => {
    const einmal = buildArtikelSystemPrompt(BRIEFING, REGELN)

    for (let i = 0; i < 20; i += 1) {
      expect(buildArtikelSystemPrompt(BRIEFING, REGELN)).toBe(einmal)
    }
  })

  it('enthaelt keinen Gemeindenamen und keine Gemeindezahl', () => {
    const prompt = buildArtikelSystemPrompt(BRIEFING, REGELN)

    for (const gemeinde of ['Aesch', 'Liestal', 'Therwil', 'Muttenz']) {
      expect(prompt).not.toContain(gemeinde)
    }
  })

  it('traegt den Winkel, die Kernaussagen und die Regeln', () => {
    const prompt = buildArtikelSystemPrompt(BRIEFING, REGELN)

    expect(prompt).toContain('Die Abfallmengen sinken kantonsweit')
    expect(prompt).toContain('Mit dem Kantonsschnitt vergleichen')
    expect(prompt).toContain('Nenne immer den Bezirk.')
  })

  // The rule the whole `zeitbezug` module exists to enforce has to be stated in
  // the prompt too — checking afterwards is the safety net, not the mechanism.
  it('verlangt ausdrueckliche Jahreszahlen und nennt das Bezugsjahr', () => {
    const prompt = buildArtikelSystemPrompt(BRIEFING, REGELN)

    expect(prompt).toContain('2025')
    expect(prompt).toMatch(
      /Jahreszahlen.*ausdruecklich|ausdruecklich.*Jahreszahlen/s
    )
    expect(prompt).toContain('vergangenes Jahr')
  })

  it('kommt ohne redaktionelle Vorgaben aus', () => {
    expect(() => buildArtikelSystemPrompt(BRIEFING, [])).not.toThrow()
    expect(buildArtikelSystemPrompt(BRIEFING, [])).not.toContain(
      'Redaktionelle Vorgaben'
    )
  })
})

describe('buildArtikelUserPrompt — was variieren darf', () => {
  const eingabe = {
    gemeinde: 'Aesch',
    bezirk: 'Arlesheim',
    zahlen: 'Glas: 21.3 kg pro Einw.',
    einordnung: 'Liegt 8 Prozent unter dem Kantonsschnitt.',
    frueherText: null
  }

  it('traegt Gemeinde, Zahlen und Einordnung', () => {
    const prompt = buildArtikelUserPrompt(eingabe)

    expect(prompt).toContain('Aesch')
    expect(prompt).toContain('Arlesheim')
    expect(prompt).toContain('21.3 kg pro Einw.')
    expect(prompt).toContain('unter dem Kantonsschnitt')
  })

  // The memory, at the level of a single municipality.
  it('haengt den frueheren Text an, wenn es einen gibt', () => {
    const prompt = buildArtikelUserPrompt({
      ...eingabe,
      frueherText: 'Aesch sammelte 2024 noch 23 Kilogramm Glas pro Person.'
    })

    expect(prompt).toContain('2024 noch 23 Kilogramm')
    expect(prompt).toContain('wiederhole keine ganzen Saetze')
  })

  it('laesst den Block weg, wenn es nichts Frueheres gibt', () => {
    expect(buildArtikelUserPrompt(eingabe)).not.toContain(
      'Frueher ueber diese Gemeinde'
    )
  })

  it('nimmt eine Korrektur fuer den zweiten Versuch auf', () => {
    const prompt = buildArtikelUserPrompt({
      ...eingabe,
      korrektur: 'Der Text enthaelt "vergangenes Jahr".'
    })

    expect(prompt).toContain('Korrektur zum vorherigen Versuch')
    expect(prompt).toContain('vergangenes Jahr')
  })
})

describe('buildBriefingPrompt', () => {
  const eingabe = {
    datensatzTitel: 'Abfallmengen nach Kategorie, Gemeinde und Jahr',
    datensatzBeschreibung: 'Spezifische Abfallmengen.',
    periode: '2025',
    kantonszahlen: 'Kanton gesamt: 280 kg pro Einw.',
    regeln: [],
    frueher: []
  }

  it('nennt Datensatz, Periode und Kantonszahlen', () => {
    const prompt = buildBriefingPrompt(eingabe)

    expect(prompt).toContain('Abfallmengen nach Kategorie')
    expect(prompt).toContain('2025')
    expect(prompt).toContain('280 kg pro Einw.')
  })

  // This is the memory that makes the second year better than the first.
  it('gibt frueher Publiziertes mit und verlangt einen neuen Winkel', () => {
    const prompt = buildBriefingPrompt({
      ...eingabe,
      frueher: [
        {
          periode: '2024',
          titel: 'Aesch trennt mehr Glas',
          lead: 'Ein Plus von 8 Prozent.'
        }
      ]
    })

    expect(prompt).toContain('2024: Aesch trennt mehr Glas')
    expect(prompt).toContain('Ein Plus von 8 Prozent.')
    expect(prompt).toContain('Wiederhole diesen Winkel nicht')
  })

  it('laesst den Rueckblick weg, wenn es der erste Lauf ist', () => {
    expect(buildBriefingPrompt(eingabe)).not.toContain(
      'Frueher aus demselben Datensatz'
    )
  })

  it('vertraegt einen Datensatz ohne Beschreibung', () => {
    expect(() =>
      buildBriefingPrompt({ ...eingabe, datensatzBeschreibung: null })
    ).not.toThrow()
  })
})

describe('parseBriefing', () => {
  const gut = {
    jahr: '2025',
    winkel: 'Ein Winkel.',
    kernaussagen: ['a', 'b'],
    kanton_kontext: 'Kontext.',
    vergleichsbasis: 'Kantonsschnitt'
  }

  it('nimmt eine vollstaendige Antwort an', () => {
    expect(parseBriefing(gut)).toEqual(gut)
  })

  it('lehnt fehlende Pflichtfelder ab, statt sie zu erfinden', () => {
    expect(() => parseBriefing({ ...gut, winkel: undefined })).toThrow(/winkel/)
    expect(() => parseBriefing({ ...gut, jahr: '   ' })).toThrow(/jahr/)
  })

  it('vertraegt fehlende Kernaussagen', () => {
    expect(
      parseBriefing({ ...gut, kernaussagen: undefined }).kernaussagen
    ).toEqual([])
  })

  it('siebt Nicht-Strings aus den Kernaussagen', () => {
    expect(
      parseBriefing({ ...gut, kernaussagen: ['a', 3, null, 'b'] }).kernaussagen
    ).toEqual(['a', 'b'])
  })

  it('lehnt ab, was kein Objekt ist', () => {
    expect(() => parseBriefing('nope')).toThrow()
    expect(() => parseBriefing(['a'])).toThrow()
  })
})

describe('parseArtikel', () => {
  const gut = {
    titel: 'Aesch sammelt weniger Glas',
    lead: 'Ein Rueckgang.',
    text: 'Absatz.'
  }

  it('nimmt einen vollstaendigen Artikel an', () => {
    expect(parseArtikel(gut)).toEqual(gut)
  })

  // Three separate fields, not one blob: the Dorfkönig should be able to reuse
  // the lead without parsing the text apart.
  it('verlangt alle drei Felder einzeln', () => {
    expect(() => parseArtikel({ ...gut, lead: '' })).toThrow(/lead/)
    expect(() => parseArtikel({ ...gut, titel: undefined })).toThrow(/titel/)
    expect(() => parseArtikel({ ...gut, text: null })).toThrow(/text/)
  })

  it('kuerzt statt einen Riesentext zu speichern', () => {
    expect(parseArtikel({ ...gut, titel: 'x'.repeat(300) }).titel.length).toBe(
      120
    )
    expect(parseArtikel({ ...gut, text: 'x'.repeat(9000) }).text.length).toBe(
      6000
    )
  })
})

describe('artikelFelder', () => {
  it('bildet die Antwort auf die Spalten ab', () => {
    expect(
      artikelFelder({ titel: 'T', lead: 'L', text: 'X' }, ['Vorjahr'])
    ).toEqual({ titel: 'T', lead: 'L', text: 'X', zeit_warnungen: ['Vorjahr'] })
  })

  // `zeit_warnungen` is a cast-csv column: a string array in and out, never a
  // joined string the UI would have to split again.
  it('gibt die Warnungen als Liste, nicht als Text', () => {
    const felder = artikelFelder({ titel: 'T', lead: 'L', text: 'X' }, [
      'a',
      'b'
    ])
    expect(Array.isArray(felder.zeit_warnungen)).toBe(true)
  })

  it('kopiert die Warnungen, statt die Eingabe zu verlinken', () => {
    const warnungen = ['a']
    const felder = artikelFelder(
      { titel: 'T', lead: 'L', text: 'X' },
      warnungen
    )
    warnungen.push('b')
    expect(felder.zeit_warnungen).toEqual(['a'])
  })
})

describe('Vorgabe der Redaktion', () => {
  const briefing = {
    jahr: '2023',
    winkel: 'Die Zahl der Betriebe sinkt.',
    kernaussagen: ['Betriebe 2023', 'Vergleich mit 2011'],
    kanton_kontext: 'Kantonal 1200 Betriebe.',
    vergleichsbasis: 'Vorjahr und 2011'
  }

  it('steht im Briefing-Prompt und wird nicht paraphrasiert', () => {
    const prompt = buildBriefingPrompt({
      datensatzTitel: 'Arbeitsstaetten',
      datensatzBeschreibung: null,
      periode: '2023',
      kantonszahlen: '- 1 — arbeitsstatten: Schnitt 14',
      vorgabe:
        'Vergleiche die Zahl der Betriebe mit dem Vorjahr und mit vor zehn Jahren.',
      regeln: [],
      frueher: []
    })

    expect(prompt).toContain('Auftrag der Redaktion')
    expect(prompt).toContain('mit vor zehn Jahren')
  })

  it('steht im gecachten Artikel-Praefix', () => {
    const prompt = buildArtikelSystemPrompt(
      briefing,
      [],
      'Vergleiche mit vor zehn Jahren.'
    )
    expect(prompt).toContain('Vergleiche mit vor zehn Jahren.')
  })

  // Die Cache-Invariante: die Vorgabe gehoert zum Lauf, nicht zur Gemeinde. Sie
  // darf den Praefix aendern — aber fuer alle Gemeinden gleich.
  it('laesst den Praefix ueber alle Gemeinden identisch', () => {
    const vorgabe = 'Vergleiche die Gemeinden untereinander.'
    const prompts = ['Aesch', 'Liestal', 'Therwil'].map(() =>
      buildArtikelSystemPrompt(briefing, [], vorgabe)
    )

    expect(new Set(prompts).size).toBe(1)
  })

  it('aendert nichts, wenn keine Vorgabe gesetzt ist', () => {
    expect(buildArtikelSystemPrompt(briefing, [], null)).toBe(
      buildArtikelSystemPrompt(briefing, [])
    )
    expect(buildArtikelSystemPrompt(briefing, [], '   ')).toBe(
      buildArtikelSystemPrompt(briefing, [])
    )
  })

  it('verlangt bei fehlenden Zahlen den Hinweis statt einer Erfindung', () => {
    const prompt = buildArtikelSystemPrompt(
      briefing,
      [],
      'Nenne die Zahl von 1950.'
    )
    expect(prompt).toContain('nicht vorliegt')
  })
})

describe('Verlauf im Artikel-Prompt', () => {
  it('liefert die frueheren Perioden mit und verbietet eigene Raten', () => {
    const prompt = buildArtikelUserPrompt({
      gemeinde: 'Aesch',
      bezirk: 'Arlesheim',
      zahlen: '- 1 — arbeitsstatten: 3',
      einordnung: 'unter dem Kantonsschnitt',
      verlauf: '- 1 — arbeitsstatten: 2011: 12 · 2023: 3',
      frueherText: null
    })

    expect(prompt).toContain('2011: 12')
    expect(prompt).toContain('keine Veraenderungsraten')
  })

  it('kommt ohne Verlauf aus', () => {
    const prompt = buildArtikelUserPrompt({
      gemeinde: 'Aesch',
      bezirk: 'Arlesheim',
      zahlen: '- x: 1',
      einordnung: 'y',
      frueherText: null
    })

    expect(prompt).not.toContain('Entwicklung dieser Gemeinde')
  })
})
