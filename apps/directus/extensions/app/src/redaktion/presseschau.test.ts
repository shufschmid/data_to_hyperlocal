import { describe, expect, it } from 'vitest'
import {
  attributionsWarnung,
  buildInventarMessages,
  buildPresseschauPrompt,
  buildPresseschauRevision,
  lernDigest,
  mitQuelle,
  parseInventar,
  quelleZeile,
  ueberlappungsWarnungen,
  zahlWarnungenPresseschau,
  type LernEintrag,
  type PresseschauFakten
} from './presseschau'

const FAKTEN: PresseschauFakten = {
  blatt: 'Binninger Wochenblatt',
  nummer: '34',
  datum: '2026-08-20',
  gemeinde: 'Binningen',
  titel: 'Wo die Temperaturrekorde purzeln',
  seite: 3,
  typ: 'reportage',
  frontseite: true,
  zusammenfassung:
    'Max Baumann und Albert Braun vom Meteorologischen Verein lesen die Messstation an der Venusstrasse 7 von Hand ab. Die Basler Klimamessreihe reicht bis 1755 zurueck. In 100 Jahren gab es 15 Tage ueber 35 Grad, dieses Jahr so viele bis zum 10. August.',
  pdfUrl:
    'https://www.binninger-wochenblatt.ch/wp-content/uploads/2026/08/BWB-KW34-2026.pdf'
}

const KANDIDAT = {
  titel: 'Wo die Temperaturrekorde purzeln',
  seite: 3,
  typ: 'reportage',
  gemeinde: 'Binningen',
  frontseite: true,
  warum_exklusiv: 'Eigene Reportage mit Besuch vor Ort.',
  zusammenfassung: 'Fakten.',
  perle_vorschlag: true,
  perle_begruendung: 'Weltweit einmalige Messreihe.'
}

const EINE_GEMEINDE = ['Binningen']

describe('parseInventar', () => {
  it('nimmt gueltige Kandidaten und prueft die Seite gegen unsere Seitenzahl', () => {
    const inventar = parseInventar(
      { kandidaten: [KANDIDAT], recherchehinweise: [], hinweise: [] },
      16,
      EINE_GEMEINDE
    )
    expect(inventar.kandidaten).toHaveLength(1)
    expect(inventar.kandidaten[0]?.perle_vorschlag).toBe(true)
    expect(inventar.kandidaten[0]?.gemeinde).toBe('Binningen')
  })

  it('entfernt eine Seitenangabe ausserhalb der Ausgabe, statt ihr zu glauben', () => {
    const inventar = parseInventar(
      { kandidaten: [{ ...KANDIDAT, seite: 99 }], hinweise: [] },
      16,
      EINE_GEMEINDE
    )
    expect(inventar.kandidaten[0]?.seite).toBeNull()
    expect(inventar.hinweise[0]).toContain('Seite 99')
  })

  it('verwirft unbekannte Typen und sagt es', () => {
    const inventar = parseInventar(
      { kandidaten: [{ ...KANDIDAT, typ: 'leitartikel' }], hinweise: [] },
      16,
      EINE_GEMEINDE
    )
    expect(inventar.kandidaten).toHaveLength(0)
    expect(inventar.hinweise[0]).toContain('leitartikel')
  })

  it('dedupliziert auf Titel und Seite', () => {
    const inventar = parseInventar(
      { kandidaten: [KANDIDAT, { ...KANDIDAT }], hinweise: [] },
      16,
      EINE_GEMEINDE
    )
    expect(inventar.kandidaten).toHaveLength(1)
  })

  it('prueft die Gemeinde gegen die Abdeckung — und teilt Unklares der Hauptgemeinde zu', () => {
    // Der Muttenzer & Prattler Anzeiger deckt zwei Gemeinden ab. Eine Behaup-
    // tung ausserhalb der Abdeckung wird nicht geglaubt, sondern benannt.
    const inventar = parseInventar(
      {
        kandidaten: [
          { ...KANDIDAT, titel: 'Prattler Sache', gemeinde: 'pratteln' },
          { ...KANDIDAT, titel: 'Fremde Sache', gemeinde: 'Basel' }
        ],
        recherchehinweise: [],
        hinweise: []
      },
      16,
      ['Muttenz', 'Pratteln']
    )

    expect(inventar.kandidaten[0]?.gemeinde).toBe('Pratteln')
    expect(inventar.kandidaten[1]?.gemeinde).toBe('Muttenz')
    expect(inventar.hinweise[0]).toContain('"Basel" nicht in der Abdeckung')
  })

  it('nimmt Recherche-Faehrten mit, validiert aber deren Gemeinde', () => {
    const inventar = parseInventar(
      {
        kandidaten: [],
        recherchehinweise: [
          {
            titel: 'Sechs Meter hohe Daemme geplant',
            fundort: "Leserbrief 'Wertvoller Regen', S. 2",
            begruendung: 'Konkretes Bauprojekt, das niemand eingeordnet hat.',
            gemeinde: 'Muttenz'
          },
          {
            titel: 'Ohne Gemeinde',
            fundort: null,
            begruendung: null,
            gemeinde: 'Bern'
          }
        ],
        hinweise: []
      },
      16,
      ['Muttenz', 'Pratteln']
    )

    expect(inventar.recherchehinweise).toHaveLength(2)
    expect(inventar.recherchehinweise[0]?.gemeinde).toBe('Muttenz')
    expect(inventar.recherchehinweise[0]?.fundort).toContain('Leserbrief')
    // Eine Faehrte wird nie zum Artikel — null ist hier ehrlicher als raten.
    expect(inventar.recherchehinweise[1]?.gemeinde).toBeNull()
  })
})

describe('lernDigest', () => {
  const eintrag = (ueber: Partial<LernEintrag>): LernEintrag => ({
    titel: 'Ein Beitrag',
    typ: 'reportage',
    entscheid: 'offen',
    ablehnungsgrund: null,
    ablehnungskommentar: null,
    perleVorschlag: false,
    perleBestaetigt: null,
    ...ueber
  })

  it('ist leer, solange nichts entschieden wurde', () => {
    expect(lernDigest([])).toBe('')
    expect(lernDigest([eintrag({})])).toBe('')
  })

  it('trennt Positiv-, Negativ- und Perlen-Beispiele', () => {
    const digest = lernDigest([
      eintrag({ titel: 'Gutes Interview', entscheid: 'uebernommen' }),
      eintrag({
        titel: 'Alter Hut',
        entscheid: 'abgelehnt',
        ablehnungsgrund: 'veraltet',
        ablehnungskommentar: 'stand schon im Amtsblatt'
      }),
      eintrag({
        titel: 'Kuriose Messreihe',
        entscheid: 'uebernommen',
        perleVorschlag: true,
        perleBestaetigt: true
      })
    ])

    expect(digest).toContain('Uebernommen')
    expect(digest).toContain('"Gutes Interview"')
    expect(digest).toContain(
      '"Alter Hut" (reportage) — veraltet: stand schon im Amtsblatt'
    )
    expect(digest).toContain('"Kuriose Messreihe": als Perle bestaetigt')
  })

  it('landet im User-Turn des Inventars, nie im System-Prompt', () => {
    const digest = 'Was die Redaktion entschieden hat: …'
    const [nachricht] = buildInventarMessages(
      'JVBERi0=',
      {
        name: 'Binninger Wochenblatt',
        gemeinden: ['Binningen'],
        nummer: '35',
        datum: null
      },
      digest
    )
    const inhalt = nachricht?.content
    if (!Array.isArray(inhalt)) throw new Error('Content fehlt')
    const text = inhalt.find((b) => b.type === 'text')
    expect(text && 'text' in text ? text.text : '').toContain(digest)
    expect(inhalt[0]?.type).toBe('document')
  })

  it('nennt bei mehreren Gemeinden die ganze Abdeckung im Auftrag', () => {
    const [nachricht] = buildInventarMessages(
      'JVBERi0=',
      {
        name: 'Muttenzer & Prattler Anzeiger',
        gemeinden: ['Muttenz', 'Pratteln'],
        nummer: '34',
        datum: '2026-08-21'
      },
      ''
    )
    const inhalt = nachricht?.content
    if (!Array.isArray(inhalt)) throw new Error('Content fehlt')
    const text = inhalt.find((b) => b.type === 'text')
    const auftrag = text && 'text' in text ? text.text : ''
    expect(auftrag).toContain('Muttenz, Pratteln')
    expect(auftrag).toContain('ordne jeden Kandidaten')
  })

  it('traegt Gemeinde-Korrekturen und Faehrten-Urteile in den Digest', () => {
    const digest = lernDigest(
      [],
      [{ titel: 'Neues Schulhaus', gemeinde: 'Pratteln' }],
      [
        { titel: 'Sechs Meter hohe Daemme', brauchbar: true, kommentar: null },
        {
          titel: 'Aerger ueber Laub',
          brauchbar: false,
          kommentar: 'blosse Stimmung'
        }
      ]
    )

    expect(digest).toContain('"Neues Schulhaus" gehoert zu Pratteln')
    expect(digest).toContain('"Sechs Meter hohe Daemme": brauchbare Faehrte')
    expect(digest).toContain(
      '"Aerger ueber Laub": keine Faehrte — blosse Stimmung'
    )
  })
})

describe('quelleZeile / mitQuelle', () => {
  it('verlinkt mit #page direkt auf die Beitragsseite', () => {
    expect(quelleZeile(FAKTEN)).toBe(
      'Quelle: Binninger Wochenblatt Nr. 34, https://www.binninger-wochenblatt.ch/wp-content/uploads/2026/08/BWB-KW34-2026.pdf#page=3'
    )
  })

  it('laesst das Fragment weg, wenn die Seite fehlt', () => {
    expect(quelleZeile({ ...FAKTEN, seite: null })).not.toContain('#page')
    expect(quelleZeile({ ...FAKTEN, pdfUrl: null })).toBe(
      'Quelle: Binninger Wochenblatt Nr. 34'
    )
  })

  it('haengt die Zeile deterministisch an den Text', () => {
    expect(mitQuelle('Ein Text.', FAKTEN)).toBe(
      `Ein Text.\n\n${quelleZeile(FAKTEN)}`
    )
  })
})

describe('attributionsWarnung', () => {
  it('ist zufrieden, wenn Blatt und Nummer im Text stehen', () => {
    expect(
      attributionsWarnung(
        'Wie das Binninger Wochenblatt (Nr. 34) berichtet, purzeln die Rekorde.',
        FAKTEN
      )
    ).toBeNull()
  })

  it('beanstandet fehlenden Blattnamen und fehlende Nummer getrennt', () => {
    expect(attributionsWarnung('Die Rekorde purzeln.', FAKTEN)).toContain(
      'Binninger Wochenblatt'
    )
    expect(
      attributionsWarnung('Das Binninger Wochenblatt berichtet.', FAKTEN)
    ).toContain('Nr. 34')
  })

  it('kommt mit Doppelnummern zurecht', () => {
    expect(
      attributionsWarnung(
        'Wie das Binninger Wochenblatt (Nr. 30/31) schreibt.',
        {
          blatt: 'Binninger Wochenblatt',
          nummer: '30/31'
        }
      )
    ).toBeNull()
  })
})

describe('zahlWarnungenPresseschau', () => {
  it('erlaubt Zahlen aus Zusammenfassung, Nummer, Datum und Seite', () => {
    const text =
      'Wie das Binninger Wochenblatt (Nr. 34) vom 20. August 2026 berichtet, reicht die Reihe bis 1755 zurueck — 15 Tage ueber 35 Grad.'
    expect(zahlWarnungenPresseschau(text, FAKTEN)).toEqual([])
  })

  it('meldet erfundene Zahlen', () => {
    const warnungen = zahlWarnungenPresseschau(
      'Der Verein hat 50 Mitglieder.',
      FAKTEN
    )
    expect(warnungen[0]).toContain('"50"')
  })
})

describe('ueberlappungsWarnungen', () => {
  const quelle =
    'Wenige Schritte hinter einem niedrigen Gebaeude an der Venusstrasse liegt das Messfeld der Meteorologischen Station Basel-Binningen: Antennen, kleinere und groessere Haeuschen und Zylinder stehen im strohgelben, hohen Gras.'

  it('meldet einen eingeschmuggelten Originalsatz', () => {
    const text =
      'Wie das Blatt schreibt: Wenige Schritte hinter einem niedrigen Gebaeude an der Venusstrasse liegt das Messfeld der Meteorologischen Station.'
    const warnungen = ueberlappungsWarnungen(text, quelle)
    expect(warnungen).toHaveLength(1)
    expect(warnungen[0]).toContain('wenige schritte hinter einem niedrigen')
  })

  it('laesst eine eigene Paraphrase in Ruhe', () => {
    const text =
      'Das Messfeld an der Venusstrasse wird von Hand abgelesen; die Station Basel-Binningen liefert die Referenzwerte der Region.'
    expect(ueberlappungsWarnungen(text, quelle)).toEqual([])
  })
})

describe('Prompts', () => {
  it('stellt die Fakten vor die Aufgabe und wiederholt sie in der Revision', () => {
    const prompt = buildPresseschauPrompt(FAKTEN)
    expect(prompt).toContain('Binninger Wochenblatt, Ausgabe Nr. 34')
    expect(prompt).toContain('Frontseite')

    const revision = buildPresseschauRevision(
      FAKTEN,
      { titel: 'Alt', lead: 'Alt.', text: 'Alter Text.' },
      'Kuerzer bitte.'
    )
    expect(revision).toContain('Fakten aus dem Beitrag')
    expect(revision).toContain('Kuerzer bitte.')
  })
})
