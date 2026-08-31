import { describe, expect, it } from 'vitest'
import type { AmtsblattFakten } from './amtsblatt'
import {
  artikelUnterlage,
  darfWeg,
  attributionsWarnung,
  buildAmtsblattPrompt,
  buildPlanMessages,
  buildTriagePrompt,
  lernDigest,
  mitQuelle,
  parsePlanbefund,
  parseTriage,
  personenWarnungen,
  quelleZeile,
  quellenName,
  TRIAGE_SYSTEM_PROMPT,
  zahlWarnungen,
  type TriageZeile
} from './amtsblatt'

const ZEILEN: TriageZeile[] = [
  {
    id: 'a',
    titel: 'Baugesuch - Solaranlage, Aesch',
    rubrikName: 'Baugesuch',
    gruppe: 'bauen',
    amt: 'Bauinspektorat'
  },
  {
    id: 'b',
    titel: 'Mutation Casipra GmbH, Pratteln',
    rubrikName: 'Mutation',
    gruppe: 'wirtschaft',
    amt: ''
  }
]

function fakten(ueber: Partial<AmtsblattFakten> = {}): AmtsblattFakten {
  return {
    gemeinde: 'Aesch',
    kanton: 'BL',
    titel: 'Baugesuch - Solaranlage, Aesch',
    rubrikName: 'Baugesuch',
    gruppe: 'bauen',
    amt: 'Kanton Basel-Landschaft - Bauinspektorat',
    publiziertAm: '2026-08-27',
    frist: '2026-09-07',
    angaben: [
      { bezeichnung: 'Titel des Bauprojekts', wert: 'Solaranlage' },
      {
        bezeichnung: 'Parzelle Nr. / Strassenname',
        wert: '800 - Hauptstrasse 3'
      }
    ],
    planbefunde: [],
    personen: [],
    pdfUrl: 'https://amtsblattportal.ch/api/v1/publications/4dc2b146/pdf',
    unterlage: null,
    ...ueber
  }
}

describe('Triage', () => {
  // Same invariant as `buildArtikelSystemPrompt`: what the prompt cache carries
  // must not move. The municipality's name and its decision history are per
  // municipality and belong in the user turn.
  it('haelt nichts Gemeindespezifisches im Systemprompt', () => {
    for (const wort of ['Aesch', 'Riehen', 'Dornach', 'Pratteln']) {
      expect(TRIAGE_SYSTEM_PROMPT).not.toContain(wort)
    }
  })

  it('nummeriert die Publikationen, damit die Antwort zuordenbar ist', () => {
    const prompt = buildTriagePrompt('Aesch', ZEILEN, '')

    expect(prompt).toContain(
      '1. [Bauen, Planung, Verkehr · Baugesuch] "Baugesuch - Solaranlage, Aesch"'
    )
    expect(prompt).toContain(
      '2. [Handelsregister · Mutation] "Mutation Casipra GmbH, Pratteln"'
    )
    expect(prompt).toContain('Beurteile alle 2')
  })

  it('ordnet die Urteile ueber die Nummer den Zeilen zu', () => {
    const urteile = parseTriage(
      {
        urteile: [
          { nummer: 2, vorschlag: false, begruendung: 'Routinemutation.' },
          {
            nummer: 1,
            vorschlag: true,
            begruendung: 'Solaranlage mit Aussenwirkung.'
          }
        ]
      },
      ZEILEN
    )

    expect(urteile).toEqual([
      { id: 'b', vorschlag: false, begruendung: 'Routinemutation.' },
      {
        id: 'a',
        vorschlag: true,
        begruendung: 'Solaranlage mit Aussenwirkung.'
      }
    ])
  })

  // A number that points nowhere would otherwise stamp a verdict onto the wrong
  // publication — the one failure mode of answering by position.
  it('verwirft Nummern ausserhalb der Liste und Doppelurteile', () => {
    const urteile = parseTriage(
      {
        urteile: [
          { nummer: 9, vorschlag: true, begruendung: 'x' },
          { nummer: 0, vorschlag: true, begruendung: 'x' },
          { nummer: 1, vorschlag: true, begruendung: 'erste' },
          { nummer: 1, vorschlag: false, begruendung: 'zweite' }
        ]
      },
      ZEILEN
    )

    expect(urteile).toEqual([
      { id: 'a', vorschlag: true, begruendung: 'erste' }
    ])
  })

  it('meldet eine unbrauchbare Antwort als Fehler', () => {
    expect(() => parseTriage({ nichts: true }, ZEILEN)).toThrow('urteile')
  })
})

describe('lernDigest', () => {
  it('rendert die Entscheide der Redaktion als Beispiele', () => {
    const digest = lernDigest([
      {
        titel: 'Whirlpool',
        rubrikName: 'Baugesuch',
        entscheid: 'abgelehnt',
        grund: 'privat'
      },
      {
        titel: 'Schulhaus',
        rubrikName: 'Beschluss',
        entscheid: 'uebernommen',
        grund: null
      },
      {
        titel: 'Deponie',
        rubrikName: 'Planauflage',
        entscheid: 'weitergereicht',
        grund: null
      }
    ])

    expect(digest).toContain('"Whirlpool" → nein (privat)')
    expect(digest).toContain('"Schulhaus" → ja, daraus wurde eine Meldung')
    expect(digest).toContain('"Deponie" → ja, aber zuerst zu recherchieren')
  })

  // The digest feeds a prompt; unbounded it would grow without limit.
  it('bleibt bei den letzten zwanzig', () => {
    const viele = Array.from({ length: 40 }, (_, i) => ({
      titel: `T${i}`,
      rubrikName: 'Baugesuch',
      entscheid: 'abgelehnt' as const,
      grund: null
    }))

    expect(lernDigest(viele).split('\n')).toHaveLength(21)
  })

  it('bleibt leer, solange nichts entschieden wurde', () => {
    expect(lernDigest([])).toBe('')
  })
})

describe('darfWeg', () => {
  const zeile = (ueber = {}) => ({
    id: 'a',
    entscheid: 'offen',
    vorschlag: false,
    frist: null as string | null,
    publiziert_am: '2026-08-01',
    ...ueber
  })

  // Eine abgelaufene Frist ist endgueltig: gegen ein Baugesuch, dessen
  // Einsprachefrist zu ist, kann niemand mehr etwas unternehmen.
  it('laesst eine abgelaufene Frist weg, auch als Vorschlag', () => {
    expect(darfWeg(zeile({ frist: '2026-08-30' }), '2026-08-31')).toBe(true)
    expect(
      darfWeg(zeile({ frist: '2026-08-30', vorschlag: true }), '2026-08-31')
    ).toBe(true)
    expect(darfWeg(zeile({ frist: '2026-09-07' }), '2026-08-31')).toBe(false)
  })

  it('raeumt nach sieben Tagen weg, was die Sichtung nicht vorschlug', () => {
    expect(darfWeg(zeile({ publiziert_am: '2026-08-24' }), '2026-08-31')).toBe(
      true
    )
    expect(darfWeg(zeile({ publiziert_am: '2026-08-25' }), '2026-08-31')).toBe(
      false
    )
  })

  // Ein Vorschlag ohne Frist ist die Warteschlange der Redaktorin — er leert
  // sich durch Entscheiden, nicht durch Verfallen, und der Entscheid ist das
  // Lernsignal der naechsten Sichtung.
  it('laesst einen Vorschlag ohne Frist stehen, egal wie alt', () => {
    expect(
      darfWeg(
        zeile({ vorschlag: true, publiziert_am: '2026-01-01' }),
        '2026-08-31'
      )
    ).toBe(false)
  })

  // Gemessen: mit sieben Tagen Rueckschau und sieben Tagen Aufbewahrung
  // loeschte ein Lauf 32 Zeilen und holte sie Minuten spaeter zurueck — und
  // bezahlte die Sichtung jeden Morgen neu.
  it('fasst nichts an, was der Lauf gleich wieder holen wuerde', () => {
    const frisch = zeile({ publiziert_am: '2026-08-24', frist: '2026-08-30' })

    expect(darfWeg(frisch, '2026-08-31')).toBe(true)
    expect(darfWeg(frisch, '2026-08-31', 7, 8)).toBe(false)
  })

  // Entschiedene Zeilen sind das Gedaechtnis dieses Feeds.
  it('fasst nie an, worueber schon entschieden ist', () => {
    for (const entscheid of ['uebernommen', 'abgelehnt', 'weitergereicht']) {
      expect(
        darfWeg(zeile({ entscheid, frist: '2020-01-01' }), '2026-08-31')
      ).toBe(false)
    }
  })
})

describe('Planlesung', () => {
  it('schickt jedes Blatt als Bildblock, mit den Angaben daneben', () => {
    const messages = buildPlanMessages(
      [
        { url: 'a.jpg', medienTyp: 'image/jpeg', base64: 'AAA', bytes: 3 },
        { url: 'b.jpg', medienTyp: 'image/jpeg', base64: 'BBB', bytes: 3 }
      ],
      {
        titel: 'Solaranlage',
        gemeinde: 'Aesch',
        angaben: [{ bezeichnung: 'Parzelle', wert: '800' }]
      }
    )
    const inhalt = messages[0]?.content
    if (!Array.isArray(inhalt)) throw new Error('erwartet Bloecke')

    expect(inhalt.filter((b) => b.type === 'image')).toHaveLength(2)
    expect(JSON.stringify(inhalt.at(-1))).toContain('Parzelle: 800')
  })

  // The article prompt gets this list as its only source, so every digit in it
  // becomes an allowed digit. The first real run returned 24 findings, half of
  // them survey marks.
  it('deckelt die Befunde bei zwoelf', () => {
    const viele = Array.from({ length: 30 }, (_, i) => ({
      blatt: 1,
      aussage: `Befund ${i}`
    }))

    expect(
      parsePlanbefund({ befunde: viele, fazit: '' }, 1).befunde
    ).toHaveLength(12)
  })

  // A finding whose sheet does not exist has no source to point at — and an
  // unsourced number read off a drawing is exactly what must not reach an
  // article.
  it('verwirft Befunde ohne gueltiges Blatt', () => {
    const lesung = parsePlanbefund(
      {
        befunde: [
          { blatt: 1, aussage: 'Vier Wohnungen.' },
          { blatt: 7, aussage: 'Zwoelf Parkplaetze.' },
          { blatt: 0, aussage: 'Nichts.' },
          { blatt: 2, aussage: '   ' }
        ],
        fazit: 'Die Plaene tragen die Meldung.'
      },
      2
    )

    expect(lesung.befunde).toEqual([{ blatt: 1, aussage: 'Vier Wohnungen.' }])
    expect(lesung.fazit).toBe('Die Plaene tragen die Meldung.')
  })
})

describe('Meldung', () => {
  it('haelt die Frist und die Angaben im Prompt', () => {
    const prompt = buildAmtsblattPrompt(fakten())

    expect(prompt).toContain('Frist fuer Einsprachen/Einwendungen: 2026-09-07')
    expect(prompt).toContain(
      '- Parzelle Nr. / Strassenname: 800 - Hauptstrasse 3'
    )
  })

  it('nennt die Planbefunde als gelesen, nicht als geschaetzt', () => {
    const prompt = buildAmtsblattPrompt(
      fakten({ planbefunde: ['Vier Wohnungen auf Blatt 1.'] })
    )

    expect(prompt).toContain('gelesen, nicht geschaetzt')
    expect(prompt).toContain('- Vier Wohnungen auf Blatt 1.')
  })

  it('uebergibt die Personennamen ausdruecklich als nicht zu nennen', () => {
    expect(
      buildAmtsblattPrompt(fakten({ personen: ['Anna Lehmann'] }))
    ).toContain('NICHT nennen (natuerliche Personen): Anna Lehmann')
  })

  // Both addresses are built here from values the connector resolved. Asked for
  // a link without being given one, a model produces the bare host — that is
  // the lesson in `quelle.ts`, and it holds here.
  it('baut die Quellenzeile, mit dem Dokument als zweiter Adresse', () => {
    const zeile = quelleZeile(
      fakten({
        unterlage: {
          art: 'plaene',
          bezeichnung: 'Baugesuchsplaene',
          url: 'https://bgauflage.bl.ch/pages/1197_2026.html',
          lesbar: true
        }
      })
    )

    expect(zeile).toContain(
      'https://amtsblattportal.ch/api/v1/publications/4dc2b146/pdf'
    )
    // Die Beschriftung kommt aus der Art, nicht aus dem gespeicherten Text —
    // sonst traegt ein veroeffentlichter Artikel eine alte Schreibweise ewig.
    expect(zeile).toContain(
      'Baugesuchspläne: https://bgauflage.bl.ch/pages/1197_2026.html'
    )
    // Eigener Absatz: die Darstellung trennt an einer LEERZEILE, ein einfacher
    // Umbruch liesse die beiden Adressen zu einem Block zusammenlaufen.
    expect(zeile.split('\n\n')).toHaveLength(2)
  })

  it('haengt die Quelle an, mit deutschem Datum', () => {
    expect(mitQuelle('Text.', fakten())).toBe(
      'Text.\n\nQuelle: Amtliche Publikation vom 27. August 2026, https://amtsblattportal.ch/api/v1/publications/4dc2b146/pdf'
    )
  })
})

describe('artikelUnterlage', () => {
  // `lesbar` says whether WE can read it; this says what a READER can open.
  // Solothurn's eBau portal is unreadable for us and fine for a person.
  it('nimmt Plaene vor Akten vor eBau, aber nie die Karte', () => {
    const karte = {
      art: 'karte' as const,
      bezeichnung: 'Karte',
      url: 'k',
      lesbar: false
    }
    const ebau = {
      art: 'ebau' as const,
      bezeichnung: 'eBau',
      url: 'e',
      lesbar: false
    }
    const plaene = {
      art: 'plaene' as const,
      bezeichnung: 'Plaene',
      url: 'p',
      lesbar: true
    }

    expect(artikelUnterlage([karte, ebau, plaene])?.art).toBe('plaene')
    expect(artikelUnterlage([karte, ebau])?.art).toBe('ebau')
    expect(artikelUnterlage([karte])).toBeNull()
  })
})

describe('Pruefungen', () => {
  it('nennt das richtige Blatt je Kanton und Gruppe', () => {
    expect(quellenName('BL', 'bauen')).toBe('Basel-Landschaft')
    expect(quellenName('BS', 'behoerden')).toBe('Basel-Stadt')
    expect(quellenName('SO', 'bauen')).toBe('Solothurn')
    expect(quellenName('BL', 'wirtschaft')).toBe('Handelsamtsblatt')
  })

  it('meldet eine fehlende Attribution', () => {
    expect(
      attributionsWarnung('In Aesch entsteht eine Solaranlage.', fakten())
    ).toContain('amtlichen Publikation')
    expect(
      attributionsWarnung(
        'Wie das Amtsblatt des Kantons Zug publiziert …',
        fakten()
      )
    ).toContain('Basel-Landschaft')
    expect(
      attributionsWarnung(
        'Wie das Amtsblatt des Kantons Basel-Landschaft publiziert …',
        fakten()
      )
    ).toBeNull()
  })

  // The rule the whole feed hangs on: an official publication may name a
  // private person, a piece of journalism decides that for itself.
  it('findet den Namen einer Privatperson, auch umgestellt', () => {
    const warnungen = personenWarnungen(
      'Die Bauherrschaft Dieter Faller hat das Gesuch eingereicht.',
      ['Faller Dieter']
    )

    expect(warnungen).toEqual([
      'Name einer Privatperson im Text: "Faller Dieter".'
    ])
  })

  it('schlaegt bei kurzen Namensteilen nicht blind an', () => {
    // "Ott" would otherwise match inside half the German language.
    expect(
      personenWarnungen('Die Wohnung liegt im dritten Stock.', ['Ott Urs'])
    ).toEqual([])
    expect(personenWarnungen('Ein Neubau entsteht.', ['Anna Lehmann'])).toEqual(
      []
    )
  })

  it('meldet jede Zahl, die nicht in den Angaben steht', () => {
    const warnungen = zahlWarnungen(
      'Auf Parzelle 800 entstehen 4 Wohnungen; Frist ist der 7. September 2026.',
      fakten()
    )

    expect(warnungen).toEqual(['Zahl "4" steht nicht in den Angaben.'])
  })

  it('laesst eine Zahl aus einem Planbefund durch', () => {
    expect(
      zahlWarnungen(
        'Es entstehen 4 Wohnungen.',
        fakten({ planbefunde: ['Vier Wohnungen: 4 Stueck.'] })
      )
    ).toEqual([])
  })
})
