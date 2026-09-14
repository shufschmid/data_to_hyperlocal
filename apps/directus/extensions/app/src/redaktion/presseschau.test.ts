import { describe, expect, it } from 'vitest'
import {
  INVENTAR_SYSTEM_PROMPT,
  attributionsWarnung,
  brauchtTextTransport,
  buildInventarMessages,
  buildPresseschauPrompt,
  buildPresseschauRevision,
  INVENTAR_PDF_MAX_BYTES,
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

  it('prueft die Gemeinde gegen die Abdeckung und sortiert Fremdes aus', () => {
    // Bei mehreren abgedeckten Gemeinden wird ein Beitrag einer fremden
    // Gemeinde (das Blatt deckt auch Nachbargemeinden ab) NICHT der naechsten
    // Auftrags-Gemeinde zugeschlagen, sondern weggelassen — genau der Fehler,
    // der beim Wochenblatt fuer das Birseck auftrat.
    const inventar = parseInventar(
      {
        kandidaten: [
          { ...KANDIDAT, titel: 'Prattler Sache', gemeinde: 'pratteln' },
          { ...KANDIDAT, titel: 'Fremde Sache', gemeinde: 'Basel' },
          { ...KANDIDAT, titel: 'Ohne Gemeinde', gemeinde: null }
        ],
        recherchehinweise: [],
        hinweise: []
      },
      16,
      ['Muttenz', 'Pratteln']
    )

    expect(inventar.kandidaten).toHaveLength(1)
    expect(inventar.kandidaten[0]?.gemeinde).toBe('Pratteln')
    expect(inventar.hinweise.join(' ')).toContain(
      '"Basel" gehoert nicht zum Gebiet'
    )
    expect(inventar.hinweise.join(' ')).toContain(
      'keine Gemeinde aus dem Gebiet'
    )
  })

  it('behaelt bei einem Ein-Gemeinde-Blatt den Fallback auf die Gemeinde', () => {
    // Ein Blatt mit nur einer abgedeckten Gemeinde hat keine Mehrdeutigkeit —
    // ein unbenannter Kandidat bleibt bei ihr, statt zu verschwinden.
    const inventar = parseInventar(
      { kandidaten: [{ ...KANDIDAT, gemeinde: null }], hinweise: [] },
      16,
      EINE_GEMEINDE
    )
    expect(inventar.kandidaten).toHaveLength(1)
    expect(inventar.kandidaten[0]?.gemeinde).toBe('Binningen')
  })

  it('sortiert benannt-Fremdes auch beim Ein-Gemeinde-Blatt aus', () => {
    // Der BiBo deckt Bottmingen, Oberwil, Therwil und Ettingen ab — gefuehrt
    // ist nur Bottmingen. Ein Oberwil-Beitrag darf nicht bei Bottmingen landen.
    const inventar = parseInventar(
      {
        kandidaten: [
          { ...KANDIDAT, titel: 'Oberwiler Sache', gemeinde: 'Oberwil' }
        ],
        hinweise: []
      },
      16,
      ['Bottmingen']
    )
    expect(inventar.kandidaten).toHaveLength(0)
    expect(inventar.hinweise.join(' ')).toContain(
      '"Oberwil" gehoert nicht zum Gebiet'
    )
  })

  it('nimmt Recherche-Faehrten mit, validiert aber Gemeinde und Seite', () => {
    const inventar = parseInventar(
      {
        kandidaten: [],
        recherchehinweise: [
          {
            titel: 'Sechs Meter hohe Daemme geplant',
            fundort: "Leserbrief 'Wertvoller Regen', S. 2",
            seite: 2,
            begruendung: 'Konkretes Bauprojekt, das niemand eingeordnet hat.',
            gemeinde: 'Muttenz'
          },
          {
            titel: 'Ohne Gemeinde',
            fundort: null,
            // Seite 99 gibt es in 16 Seiten nicht — die Angabe faellt weg.
            seite: 99,
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
    expect(inventar.recherchehinweise[0]?.seite).toBe(2)
    // Eine Faehrte wird nie zum Artikel — null ist hier ehrlicher als raten.
    expect(inventar.recherchehinweise[1]?.gemeinde).toBeNull()
    expect(inventar.recherchehinweise[1]?.seite).toBeNull()
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

  it('zaehlt ein Perlen-Urteil auch ohne Kandidaten-Entscheid — die Chefredaktion urteilt unabhaengig', () => {
    // Die Chefin kann eine Perle bestaetigen, aus der nie eine Meldung wurde.
    // Das Urteil erscheint bei den Perlen — und nirgendwo sonst, denn ein
    // offener Kandidat ist weder ueber- noch abgelehnt.
    const digest = lernDigest([
      eintrag({
        titel: 'Kurioses Fundstueck',
        entscheid: 'offen',
        perleVorschlag: true,
        perleBestaetigt: false
      })
    ])

    expect(digest).toContain('"Kurioses Fundstueck": doch keine Perle')
    expect(digest).not.toContain('Uebernommen')
    expect(digest).not.toContain('Abgelehnt')
  })

  it('landet im User-Turn des Inventars, nie im System-Prompt', () => {
    const digest = 'Was die Redaktion entschieden hat: …'
    const [nachricht] = buildInventarMessages(
      { art: 'pdf', base64: 'JVBERi0=' },
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
      { art: 'pdf', base64: 'JVBERi0=' },
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

  it('traegt bei zu grossen PDFs den Textlayer seitenweise statt des Dokuments', () => {
    const [nachricht] = buildInventarMessages(
      {
        art: 'seitentexte',
        seitenTexte: ['ARLESHEIM Musik unter Sternen', 'REINACH Rundgang']
      },
      {
        name: 'Wochenblatt fuer das Birseck',
        gemeinden: ['Aesch', 'Arlesheim', 'Muenchenstein'],
        nummer: '35',
        datum: '2026-08-27'
      },
      ''
    )
    const inhalt = nachricht?.content
    if (!Array.isArray(inhalt)) throw new Error('Content fehlt')
    expect(inhalt.every((b) => b.type === 'text')).toBe(true)
    const ausgabe = inhalt[0] && 'text' in inhalt[0] ? inhalt[0].text : ''
    expect(ausgabe).toContain('nur der Textlayer')
    expect(ausgabe).toContain('--- Seite 1 ---\nARLESHEIM Musik unter Sternen')
    expect(ausgabe).toContain('--- Seite 2 ---\nREINACH Rundgang')
  })

  it('entscheidet den Transport an der Byte-Grenze, nie das Modell', () => {
    expect(brauchtTextTransport(12 * 1024 * 1024)).toBe(false)
    expect(brauchtTextTransport(INVENTAR_PDF_MAX_BYTES)).toBe(false)
    // Die Nr. 35 des Wochenblatts fuer das Birseck: 33.8 MB Original.
    expect(brauchtTextTransport(34 * 1024 * 1024)).toBe(true)
  })

  it('traegt Weitergereichtes als eigene, positive Kategorie', () => {
    // Weiterreichen heisst "gut, aber erst verifizieren" — als Ablehnung
    // gelesen wuerde es dem Inventar das Gegenteil beibringen.
    const digest = lernDigest([
      eintrag({ titel: 'Steiner-Schule spart', entscheid: 'weitergereicht' })
    ])

    expect(digest).toContain('An die Chefredaktion weitergereicht')
    expect(digest).toContain('"Steiner-Schule spart"')
    expect(digest).not.toContain('nicht mehr machen')
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

  it('verlinkt eine issuu-Reader-Adresse als Pfadsegment statt #page', () => {
    // Die signierte Download-URL laeuft ab; gespeichert ist die Reader-Seite,
    // und deren Viewer versteht die Seite nur als Pfad.
    expect(
      quelleZeile({
        ...FAKTEN,
        blatt: 'Wochenblatt fuer das Birseck',
        nummer: '35',
        seite: 19,
        pdfUrl: 'https://issuu.com/az-anzeiger/docs/35_20260827_woz_wobanz'
      })
    ).toBe(
      'Quelle: Wochenblatt fuer das Birseck Nr. 35, https://issuu.com/az-anzeiger/docs/35_20260827_woz_wobanz/19'
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

  // Die Anweisung der Redaktion muss aus dem GANZEN Original beantwortbar
  // sein — die Zusammenfassung ist eine Auswahl. Der Ueberlappungs-Check
  // haelt die Antwort trotzdem in eigenen Worten.
  it('gibt der Revision den Originaltext der Seite mit, wenn er da ist', () => {
    const revision = buildPresseschauRevision(
      FAKTEN,
      { titel: 'Alt', lead: 'Alt.', text: 'Alter Text.' },
      'Was stand dort zur Finanzierung?',
      'Der Gemeinderat finanziert das Projekt mit 2,4 Millionen Franken.'
    )
    expect(revision).toContain('Originaltext der Seite')
    expect(revision).toContain('2,4 Millionen')
    expect(revision).toContain('EIGENEN Worten')

    const ohne = buildPresseschauRevision(
      FAKTEN,
      { titel: 'Alt', lead: 'Alt.', text: 'Alter Text.' },
      'Kuerzer bitte.'
    )
    expect(ohne).not.toContain('Originaltext der Seite')
  })
})

describe('lernDigest mit Rahmen: Bilanz, Liegengelassenes, Urteile, Perlen aller Blaetter', () => {
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

  it('stellt die Bilanz und das Liegengelassene vor die Beispiele', () => {
    const digest = lernDigest(
      [eintrag({ titel: 'Gutes Interview', entscheid: 'uebernommen' })],
      [],
      [],
      {
        bilanz:
          'Bilanz der letzten 3 Ausgaben dieses Blatts: 61 Vorschlaege — 9 uebernommen, 3 weitergereicht, 14 abgelehnt, 35 liegen gelassen.',
        verfallene: ['Vereinsjubilaeum', 'Kirchenzettel'],
        kappung: '(6 weitere Entscheide nicht aufgefuehrt)'
      }
    )
    const zeilen = digest.split('\n')
    expect(zeilen[2]).toContain('Bilanz der letzten 3 Ausgaben')
    expect(digest.indexOf('Liegen gelassen')).toBeLessThan(
      digest.indexOf('Uebernommen')
    )
    expect(digest).toContain('- "Vereinsjubilaeum"')
    expect(digest).toContain('(6 weitere Entscheide nicht aufgefuehrt)')
  })

  it('liest Weitergereichtes nach dem Urteil der Chefredaktion', () => {
    const digest = lernDigest([
      eintrag({
        titel: 'Offen',
        entscheid: 'weitergereicht',
        faehrte: { status: 'offen', kommentar: null, automatisch: false }
      }),
      eintrag({
        titel: 'Bestaetigt',
        entscheid: 'weitergereicht',
        faehrte: {
          status: 'brauchbar',
          kommentar: 'lohnt sich',
          automatisch: false
        }
      }),
      eintrag({
        titel: 'Abgelegt',
        entscheid: 'weitergereicht',
        faehrte: {
          status: 'kein_hinweis',
          kommentar: 'blosse Stimmung',
          automatisch: false
        }
      }),
      eintrag({
        titel: 'Regelwerk',
        entscheid: 'weitergereicht',
        faehrte: { status: 'offen', kommentar: null, automatisch: true }
      })
    ])

    expect(digest).toContain(
      'An die Chefredaktion weitergereicht (gute Vorschlaege'
    )
    expect(digest).toContain('- "Offen" (reportage)')
    expect(digest).toContain('als brauchbare Faehrte bestaetigt')
    expect(digest).toContain('- "Bestaetigt" (reportage) — lohnt sich')
    expect(digest).toContain(
      'abgelegt — kein Hinweis (solche nicht mehr vorschlagen)'
    )
    expect(digest).toContain('- "Abgelegt" (reportage) — blosse Stimmung')
    // Von einer Regel weitergereicht und unbeurteilt: kein Beispiel.
    expect(digest).not.toContain('Regelwerk')
  })

  it('nennt eine danach verworfene Meldung und den Perlen-Kommentar', () => {
    const digest = lernDigest([
      eintrag({
        titel: 'Duenn',
        entscheid: 'uebernommen',
        meldungVerworfen: { grund: 'zu wenig Substanz' }
      }),
      eintrag({
        titel: 'Esel',
        entscheid: 'offen',
        perleVorschlag: true,
        perleBestaetigt: false,
        perleKommentar: 'kurios, aber rein lokal'
      })
    ])
    expect(digest).toContain(
      '- "Duenn" (reportage) — die Meldung dazu wurde danach verworfen: zu wenig Substanz'
    )
    expect(digest).toContain(
      '"Esel": doch keine Perle — kurios, aber rein lokal'
    )
  })

  it('zeigt die Perlen-Urteile aller Blaetter, wenn sie mitgegeben sind — Geschmack ist global', () => {
    const digest = lernDigest(
      [
        eintrag({
          titel: 'Lokal',
          entscheid: 'offen',
          perleVorschlag: true,
          perleBestaetigt: true
        })
      ],
      [],
      [],
      {
        perlen: [
          {
            titel: 'Sauschwaenzlibrugg',
            blatt: 'Riehener Zeitung',
            bestaetigt: true,
            kommentar: null
          },
          {
            titel: 'Runder Geburtstag',
            blatt: 'Binninger Wochenblatt',
            bestaetigt: false,
            kommentar: 'keine Zutaten'
          }
        ]
      }
    )
    expect(digest).toContain(
      'Perlen-Urteile der Chefredaktion, ueber alle Blaetter'
    )
    expect(digest).toContain(
      '- "Sauschwaenzlibrugg" (Riehener Zeitung): als Perle bestaetigt'
    )
    expect(digest).toContain(
      '- "Runder Geburtstag" (Binninger Wochenblatt): doch keine Perle — keine Zutaten'
    )
    // Der Block je Blatt weicht dem globalen — dieselbe Perle stuende sonst doppelt.
    expect(digest).not.toContain('Perlen-Urteile der Redaktion:')
  })

  it('verlangt im System-Prompt, dass liegen gelassene Vorschlaege als Fehlvorschlaege zaehlen', () => {
    expect(INVENTAR_SYSTEM_PROMPT).toContain('Liegen gelassene und abgelehnte')
  })
})

describe('Regeln der Redaktion im Prompt', () => {
  it('stellt die Sichtungsregeln vor die Beispiele — im User-Turn, der System-Prompt bleibt', () => {
    const [nachricht] = buildInventarMessages(
      { art: 'pdf', base64: 'JVBERi0=' },
      {
        name: 'Binninger Wochenblatt',
        gemeinden: ['Binningen'],
        nummer: '35',
        datum: null
      },
      'Was die Redaktion entschieden hat: …',
      'Regeln der Redaktion:\nR1: Kirchenzettel nie vorschlagen.'
    )
    const inhalt = nachricht?.content
    if (!Array.isArray(inhalt)) throw new Error('Content fehlt')
    const text = inhalt.find((b) => b.type === 'text')
    if (text === undefined || text.type !== 'text')
      throw new Error('Textblock fehlt')

    expect(text.text.indexOf('R1: Kirchenzettel')).toBeLessThan(
      text.text.indexOf('Was die Redaktion entschieden hat')
    )
    expect(INVENTAR_SYSTEM_PROMPT).not.toContain('R1:')
  })

  it('gibt einer Meldung die Textregeln als Redaktionelle Vorgaben mit', () => {
    const prompt = buildPresseschauPrompt(FAKTEN, [
      'Nenne das Blatt im ersten Satz.'
    ])
    expect(prompt).toContain('Redaktionelle Vorgaben:')
    expect(prompt).toContain('- Nenne das Blatt im ersten Satz.')
    expect(buildPresseschauPrompt(FAKTEN)).not.toContain(
      'Redaktionelle Vorgaben'
    )
  })
})

describe('parseInventar — Empfehlung zum Weiterreichen', () => {
  const kandidat = (extra: Record<string, unknown>) => ({
    titel: 'Daemme am Birsig',
    seite: 2,
    typ: 'hintergrund',
    gemeinde: 'Binningen',
    frontseite: false,
    warum_exklusiv: 'Nur hier.',
    zusammenfassung: 'Sechs Meter hohe Daemme geplant.',
    perle_vorschlag: false,
    perle_begruendung: null,
    ...extra
  })

  it('traegt die Empfehlung samt Regelnummer durch — als Behauptung, geprueft wird spaeter', () => {
    const inventar = parseInventar(
      {
        kandidaten: [
          kandidat({ empfehlung: 'weiterreichen', empfehlung_regel: 'R1' })
        ],
        recherchehinweise: [],
        hinweise: []
      },
      10,
      ['Binningen']
    )
    expect(inventar.kandidaten[0]?.empfehlung).toBe('weiterreichen')
    expect(inventar.kandidaten[0]?.empfehlung_regel).toBe('R1')
  })

  it('setzt ohne Empfehlung beides auf null — auch wenn nur eine Nummer dasteht', () => {
    const inventar = parseInventar(
      {
        kandidaten: [kandidat({ empfehlung: null, empfehlung_regel: 'R1' })],
        recherchehinweise: [],
        hinweise: []
      },
      10,
      ['Binningen']
    )
    expect(inventar.kandidaten[0]?.empfehlung).toBeNull()
    expect(inventar.kandidaten[0]?.empfehlung_regel).toBeNull()
  })
})
