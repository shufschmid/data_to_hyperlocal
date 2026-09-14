import { describe, expect, it } from 'vitest'
import type { AmtsblattFakten } from './amtsblatt'
import {
  artikelUnterlage,
  aufraeumAktion,
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
    quelleTyp: 'amtsblatt',
    amt: 'Kanton Basel-Landschaft - Bauinspektorat',
    blaetter: null,
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

/** Dieselben Fakten, aber aus der anderen Tuer: eine Beschaffung von simap.ch. */
function simapFakten(ueber: Partial<AmtsblattFakten> = {}): AmtsblattFakten {
  return fakten({
    quelleTyp: 'simap',
    gruppe: 'beschaffung',
    rubrikName: 'Zuschlag',
    titel: 'BKP 421 Gaertnerarbeiten, Neubau Gemeindezentrum',
    amt: 'Gemeinde Pratteln',
    angaben: [
      {
        bezeichnung: 'Auftraggeberin',
        wert: 'Gemeinde Pratteln, 4133 Pratteln'
      },
      {
        bezeichnung: 'Zuschlag an',
        wert: "Schneider Gartengestaltung AG, 4107 Ettingen, CHF 616'183.15"
      },
      { bezeichnung: 'Eingegangene Angebote', wert: '6' }
    ],
    pdfUrl: 'https://www.simap.ch/de/project-detail/abc',
    ...ueber
  })
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
      {
        id: 'b',
        vorschlag: false,
        begruendung: 'Routinemutation.',
        empfehlung: null,
        empfehlung_regel: null
      },
      {
        id: 'a',
        vorschlag: true,
        begruendung: 'Solaranlage mit Aussenwirkung.',
        empfehlung: null,
        empfehlung_regel: null
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
      {
        id: 'a',
        vorschlag: true,
        begruendung: 'erste',
        empfehlung: null,
        empfehlung_regel: null
      }
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

  // Eine Beschaffung von simap.ch traegt dieselbe Form: ein Zuschlag hat keine
  // Frist (die Beschwerdefrist ist nicht als Datum publiziert), eine
  // Ausschreibung schon. Dieselben Regeln muessen greifen.
  it('behandelt eine Beschaffung wie jede andere Zeile', () => {
    // Zuschlag ohne Frist, nicht vorgeschlagen: geht nach sieben Tagen.
    expect(
      darfWeg(zeile({ frist: null, publiziert_am: '2026-08-24' }), '2026-08-31')
    ).toBe(true)
    // Derselbe Zuschlag als Vorschlag: bleibt bis zum Entscheid.
    expect(
      darfWeg(
        zeile({ frist: null, vorschlag: true, publiziert_am: '2026-08-24' }),
        '2026-08-31'
      )
    ).toBe(false)
    // Ausschreibung mit laufender Eingabefrist: bleibt.
    expect(
      darfWeg(
        zeile({ frist: '2026-10-12', publiziert_am: '2026-08-24' }),
        '2026-08-31'
      )
    ).toBe(false)
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

describe('unvollstaendig gelesene Plaene', () => {
  const teilweise = { gelesen: 4, gesamt: 5 }

  // Die Ehrlichkeitszeile stammt aus dem Code, nie vom Modell: eine Meldung
  // aus vier von fuenf Blaettern muss das sagen — jedes Mal, nicht meistens.
  it('haengt den Hinweis unter die Meldung', () => {
    const zeile = quelleZeile(fakten({ blaetter: teilweise }))
    expect(zeile).toContain(
      'Hinweis: Für diese Meldung konnten 4 von 5 Planblättern maschinell ausgewertet werden.'
    )
  })

  it('schweigt, wo alle Blaetter gelesen wurden', () => {
    expect(
      quelleZeile(fakten({ blaetter: { gelesen: 5, gesamt: 5 } }))
    ).not.toContain('Hinweis')
    expect(quelleZeile(fakten({ blaetter: null }))).not.toContain('Hinweis')
  })

  it('sagt es auch dem Prompt, damit der Text keine Vollstaendigkeit behauptet', () => {
    const prompt = buildAmtsblattPrompt(fakten({ blaetter: teilweise }))
    expect(prompt).toContain('nur 4 von 5 Planblaettern')
    expect(prompt).toContain('Behaupte keine Vollstaendigkeit')
    expect(buildAmtsblattPrompt(fakten({ blaetter: null }))).not.toContain(
      'Planblaettern'
    )
  })

  it('erlaubt die beiden Zahlen des Hinweises im Text', () => {
    const warnungen = zahlWarnungen(
      'Nur 4 von 5 Blaettern wurden gelesen.',
      fakten({ blaetter: teilweise })
    )
    expect(warnungen).toEqual([])
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

  // Eine Beschaffung kommt nicht aus einem Amtsblatt, sondern von simap.ch —
  // die Plattform ist die Quelle, und die Zeile muss das sagen.
  it('nennt bei einer Beschaffung simap.ch als Quelle, nicht ein Amtsblatt', () => {
    const zeile = quelleZeile(
      simapFakten({
        pdfUrl:
          'https://www.simap.ch/de/project-detail/5df54c6c-3ca5-458b-af05-db9d1d18f880'
      })
    )
    expect(zeile).toBe(
      'Quelle: Publikation auf simap.ch vom 27. August 2026, ' +
        'https://www.simap.ch/de/project-detail/5df54c6c-3ca5-458b-af05-db9d1d18f880'
    )
    expect(zeile).not.toContain('Amtliche Publikation')
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
    // Eine Beschaffung kommt von der Plattform, nicht vom Kanton — auch dann,
    // wenn die Gemeinde in Basel-Landschaft liegt.
    expect(quellenName('BL', 'beschaffung', 'simap')).toBe('simap.ch')
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

  // Bei simap ist der Plattformname die ganze Attribution: ein Wort wie
  // "amtlich" zu verlangen wuerde jeden korrekten Text durchfallen lassen.
  it('verlangt bei einer Beschaffung simap.ch — und nichts Amtliches', () => {
    expect(
      attributionsWarnung(
        'Die Gemeinde Pratteln hat den Auftrag vergeben.',
        simapFakten()
      )
    ).toContain('simap.ch')
    expect(
      attributionsWarnung(
        'Wie auf simap.ch publiziert, geht der Auftrag an die Firma.',
        simapFakten()
      )
    ).toBeNull()
    // Ein amtlich klingender Text ohne simap.ch reicht NICHT.
    expect(
      attributionsWarnung(
        'Wie das Amtsblatt des Kantons Basel-Landschaft meldet …',
        simapFakten()
      )
    ).toContain('simap.ch')
  })

  // Firmennamen sind keine Privatpersonen: `personen` bleibt bei simap leer,
  // darum kann der Preis-und-Firma-Satz keine Warnung ausloesen.
  it('warnt bei einer Beschaffung nicht wegen des Firmennamens', () => {
    const f = simapFakten()
    expect(f.personen).toEqual([])
    expect(
      personenWarnungen(
        'Den Zuschlag erhielt die Schneider Gartengestaltung AG aus Ettingen.',
        f.personen
      )
    ).toEqual([])
  })

  // Der Preis und die Zahl der Angebote stehen in den Angaben — also sind ihre
  // Ziffern erlaubt, auch mit Schweizer Tausendertrennzeichen.
  it('nimmt Betrag und Anzahl Angebote aus den Angaben als gedeckte Zahlen', () => {
    expect(
      zahlWarnungen(
        "Den Zuschlag erhielt die Firma fuer 616'183.15 Franken; es gingen 6 Angebote ein.",
        simapFakten()
      )
    ).toEqual([])
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

describe('lernDigest mit Kommentar, verworfener Meldung und Urteil der Chefredaktion', () => {
  it('uebersetzt den Grund und liest den Kommentar zurueck', () => {
    const digest = lernDigest([
      {
        titel: 'Whirlpool',
        rubrikName: 'Baugesuch',
        entscheid: 'abgelehnt',
        grund: 'zu_privat',
        kommentar: 'Privatgarten, kein Thema'
      }
    ])
    expect(digest).toContain('→ nein (zu privat: Privatgarten, kein Thema)')
  })

  it('liest Weitergereichtes nach dem Urteil der Chefredaktion, nicht pauschal als gut', () => {
    const digest = lernDigest([
      {
        titel: 'Deponie',
        rubrikName: 'Planauflage',
        entscheid: 'weitergereicht',
        grund: null,
        faehrte: {
          status: 'brauchbar',
          kommentar: 'dranbleiben',
          automatisch: false
        }
      },
      {
        titel: 'Zaun',
        rubrikName: 'Baugesuch',
        entscheid: 'weitergereicht',
        grund: null,
        faehrte: {
          status: 'zurueckgegeben',
          kommentar: null,
          automatisch: true
        }
      },
      {
        titel: 'Kran',
        rubrikName: 'Baugesuch',
        entscheid: 'weitergereicht',
        grund: null,
        faehrte: { status: 'offen', kommentar: null, automatisch: true }
      }
    ])
    expect(digest).toContain(
      '"Deponie" → ja — die Chefredaktion bestaetigte die Faehrte — dranbleiben'
    )
    expect(digest).toContain(
      '"Zaun" → nein — die Chefredaktion legte die Faehrte ab (kein Hinweis)'
    )
    expect(digest).not.toContain('"Kran"')
  })

  it('nennt eine danach verworfene Meldung beim uebernommenen Beispiel', () => {
    const digest = lernDigest([
      {
        titel: 'Schulhaus',
        rubrikName: 'Beschluss',
        entscheid: 'uebernommen',
        grund: null,
        meldungVerworfen: { grund: null }
      }
    ])
    expect(digest).toContain(
      '"Schulhaus" → ja, daraus wurde eine Meldung — die Meldung dazu wurde danach verworfen'
    )
  })

  it('stellt Bilanz und liegen Gelassenes voran und deklariert die Kappung', () => {
    const digest = lernDigest(
      [
        {
          titel: 'X',
          rubrikName: 'Baugesuch',
          entscheid: 'uebernommen',
          grund: null
        }
      ],
      20,
      {
        bilanz:
          'Bilanz der letzten 30 Tage in dieser Gemeinde: 40 Vorschlaege — 3 uebernommen, 1 weitergereicht, 6 abgelehnt, 30 liegen gelassen.',
        verfallene: ['Dachfenster', 'Gartenhaus'],
        kappung: '(12 weitere Entscheide nicht aufgefuehrt)'
      }
    )
    const zeilen = digest.split('\n')
    expect(zeilen[1]).toContain('Bilanz der letzten 30 Tage')
    expect(zeilen[2]).toContain('Liegen gelassen')
    expect(zeilen[zeilen.length - 1]).toBe(
      '(12 weitere Entscheide nicht aufgefuehrt)'
    )
  })

  it('bleibt ohne Beispiele nicht leer, wenn es eine Bilanz gibt', () => {
    expect(lernDigest([], 20, { bilanz: 'Bilanz: …' })).toContain('Bilanz: …')
  })
})

describe('aufraeumAktion', () => {
  const zeile = (ueber = {}) => ({
    id: 'a',
    entscheid: 'offen',
    vorschlag: false,
    frist: null as string | null,
    publiziert_am: '2026-08-01',
    ...ueber
  })

  // Ein liegen gelassener Vorschlag ist das lauteste Signal fuer "zu viele
  // Vorschlaege" — er bleibt als verfallen stehen und zaehlt in der Bilanz.
  it('laesst einen Vorschlag mit abgelaufener Frist verfallen statt ihn zu loeschen', () => {
    expect(
      aufraeumAktion(
        zeile({ frist: '2026-08-30', vorschlag: true }),
        '2026-08-31'
      )
    ).toBe('verfallen')
  })

  it('loescht, was die Sichtung nie vorschlug', () => {
    expect(aufraeumAktion(zeile({ frist: '2026-08-30' }), '2026-08-31')).toBe(
      'loeschen'
    )
    expect(
      aufraeumAktion(zeile({ publiziert_am: '2026-08-24' }), '2026-08-31')
    ).toBe('loeschen')
  })

  it('fasst nichts an, was darfWeg stehen laesst', () => {
    expect(aufraeumAktion(zeile({ vorschlag: true }), '2026-08-31')).toBeNull()
    expect(
      aufraeumAktion(
        zeile({ entscheid: 'abgelehnt', frist: '2020-01-01' }),
        '2026-08-31'
      )
    ).toBeNull()
  })
})

describe('Regeln der Redaktion im Prompt', () => {
  it('stellt die Sichtungsregeln zwischen die Publikationen und die Beispiele', () => {
    const prompt = buildTriagePrompt(
      'Binningen',
      [
        {
          id: 'a',
          titel: 'Whirlpool',
          rubrikName: 'Baugesuch',
          gruppe: 'bauen',
          amt: ''
        }
      ],
      'So hat die Redaktion entschieden: …',
      'Regeln der Redaktion:\nR1: Private Kleinbauten nie vorschlagen.'
    )
    expect(prompt.indexOf('"Whirlpool"')).toBeLessThan(
      prompt.indexOf('R1: Private')
    )
    expect(prompt.indexOf('R1: Private')).toBeLessThan(
      prompt.indexOf('So hat die Redaktion')
    )
    expect(TRIAGE_SYSTEM_PROMPT).not.toContain('Kleinbauten nie')
  })
})

describe('parseTriage — Empfehlung zum Weiterreichen', () => {
  const zeilen = [
    {
      id: 'a',
      titel: 'Deponie',
      rubrikName: 'Planauflage',
      gruppe: 'bauen' as const,
      amt: ''
    }
  ]

  it('traegt Empfehlung und Regelnummer durch', () => {
    const [urteil] = parseTriage(
      {
        urteile: [
          {
            nummer: 1,
            vorschlag: true,
            begruendung: 'x',
            empfehlung: 'weiterreichen',
            empfehlung_regel: 'R2'
          }
        ]
      },
      zeilen
    )
    expect(urteil?.empfehlung).toBe('weiterreichen')
    expect(urteil?.empfehlung_regel).toBe('R2')
  })

  it('liest eine Antwort ohne die Felder wie bisher', () => {
    const [urteil] = parseTriage(
      { urteile: [{ nummer: 1, vorschlag: false, begruendung: 'x' }] },
      zeilen
    )
    expect(urteil?.empfehlung).toBeNull()
    expect(urteil?.empfehlung_regel).toBeNull()
  })
})
