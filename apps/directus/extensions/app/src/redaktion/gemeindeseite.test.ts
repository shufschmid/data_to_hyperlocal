import { describe, expect, it } from 'vitest'
import { heuteAus } from '../shared/gemeindeseite'
import {
  abfuhrAbgleich,
  abfuhrkalenderBlock,
  attributionsWarnung,
  aufraeumAktion,
  auszugVon,
  buildMitteilungPrompt,
  buildMitteilungRevision,
  buildSichtungPrompt,
  hatAbfuhrbezug,
  MELDUNG_SYSTEM_PROMPT,
  mitQuelle,
  parseSichtung,
  quelleZeile,
  SICHTUNG_SYSTEM_PROMPT,
  sichtungsAuswahl,
  terminVorbei,
  volltextVon,
  zahlWarnungen,
  type MitteilungFakten,
  type SichtungsZeile
} from './gemeindeseite'

const HEUTE = heuteAus('2026-09-14')

const zeile = (ueber: Partial<SichtungsZeile> = {}): SichtungsZeile => ({
  id: 'm-1',
  titel: 'Aus dem Gemeinderat',
  auszug: 'Der Gemeinderat hat das Budget 2027 verabschiedet.',
  publiziertAm: '2026-09-11',
  kategorie: 'politik_info',
  textAbgeschnitten: false,
  anhaenge: 0,
  anhaengeGelesen: 0,
  abfuhr: null,
  veranstaltungAm: null,
  ...ueber
})

describe('Sichtung', () => {
  it('der System-Prompt nennt keine Gemeinde und traegt die Abfuhr-Regel', () => {
    for (const name of [
      'Riehen',
      'Aesch',
      'Binningen',
      'Pratteln',
      'Allschwil'
    ]) {
      expect(SICHTUNG_SYSTEM_PROMPT).not.toContain(name)
    }
    expect(SICHTUNG_SYSTEM_PROMPT).toContain(
      'Abfuhrkalender schon stehen, ist KEIN Vorschlag'
    )
    expect(SICHTUNG_SYSTEM_PROMPT).toContain('Faellt eine Abfuhr aus')
    expect(SICHTUNG_SYSTEM_PROMPT).toContain('"empfehlung_regel"')
  })

  it('auszugVon nimmt den Teaser, sonst den Textanfang, mit sichtbarer Naht', () => {
    expect(auszugVon({ teaser: 'Kurz.', text: 'Lang.' })).toBe('Kurz.')
    expect(
      auszugVon({ teaser: null, text: 'Erster  Absatz.\n\nZweiter.' })
    ).toBe('Erster Absatz. Zweiter.')
    const lang = auszugVon({ teaser: null, text: 'x'.repeat(500) }, 100)
    expect(lang.startsWith('x'.repeat(100))).toBe(true)
    expect(lang).toContain('Text gekuerzt')
  })

  it('nummeriert die Eintraege, deklariert Kappungen und Anhaenge und legt Kalender, Regeln und Digest in den User-Turn', () => {
    const prompt = buildSichtungPrompt(
      'Aesch',
      [
        zeile(),
        zeile({
          id: 'm-2',
          titel: 'Papiersammlung',
          kategorie: null,
          textAbgeschnitten: true,
          anhaenge: 2,
          anhaengeGelesen: 1,
          abfuhr:
            'Abfuhr-Abgleich: 22. September 2026: im Abfuhrkalender (Papier)'
        })
      ],
      'So hat die Redaktion entschieden …',
      'R1: Vereinsanlaesse nie.',
      'Abfuhrkalender Aesch (bekannte Termine, 1 im Fenster):\n22.09. Papier'
    )
    expect(prompt).toContain('Gemeinde: Aesch')
    expect(prompt).toContain(
      '1. [politik_info · 11. September 2026] "Aus dem Gemeinderat"'
    )
    expect(prompt).toContain(
      '   Auszug: Der Gemeinderat hat das Budget 2027 verabschiedet.'
    )
    expect(prompt).toContain('2. [11. September 2026] "Papiersammlung"')
    expect(prompt).toContain('(Der Text wurde beim Lesen gekuerzt.)')
    expect(prompt).toContain('(2 Anhaenge, davon gelesen: 1)')
    expect(prompt).toContain(
      '   Abfuhr-Abgleich: 22. September 2026: im Abfuhrkalender (Papier)'
    )
    expect(prompt.indexOf('Abfuhrkalender Aesch')).toBeLessThan(
      prompt.indexOf('R1:')
    )
    expect(prompt.indexOf('R1:')).toBeLessThan(
      prompt.indexOf('So hat die Redaktion')
    )
    expect(prompt).toContain(
      'Beurteile alle 2 und antworte fuer jede mit ihrer Nummer.'
    )
  })

  it('parseSichtung ordnet Urteile ueber die Nummer zu und nimmt die Empfehlung mit', () => {
    const urteile = parseSichtung(
      {
        urteile: [
          {
            nummer: 2,
            vorschlag: true,
            begruendung: 'Beschluss mit Wirkung.',
            empfehlung: 'weiterreichen',
            empfehlung_regel: 'R1'
          }
        ]
      },
      [zeile(), zeile({ id: 'm-2' })]
    )
    expect(urteile).toEqual([
      {
        id: 'm-2',
        vorschlag: true,
        begruendung: 'Beschluss mit Wirkung.',
        empfehlung: 'weiterreichen',
        empfehlung_regel: 'R1'
      }
    ])
  })
})

describe('Abfuhrbezug', () => {
  const papier = {
    titel: 'Papiersammlung am 22. September 2026',
    teaser: null,
    text: 'Bitte bis 7 Uhr bereitstellen.'
  }
  const termine = [
    { kategorie: 'Papier', zone: null, datum: '2026-09-22' },
    { kategorie: 'Grüngut', zone: 'Ost', datum: '2026-09-24' }
  ]

  it('erkennt Abfuhr-Woerter, nicht aber jedes Papier', () => {
    expect(hatAbfuhrbezug(papier)).toBe(true)
    expect(
      hatAbfuhrbezug({
        titel: 'Grüngutabfuhr fällt aus',
        teaser: null,
        text: null
      })
    ).toBe(true)
    expect(
      hatAbfuhrbezug({
        titel: 'Häckseldienst im Oktober',
        teaser: null,
        text: null
      })
    ).toBe(true)
    expect(
      hatAbfuhrbezug({
        titel: 'Papierkorb-Aktion der Schule',
        teaser: 'Kinder basteln',
        text: 'aus Papier und Karton.'
      })
    ).toBe(false)
    expect(
      hatAbfuhrbezug({
        titel: 'Neue Buslinie',
        teaser: null,
        text: 'Ab Oktober.'
      })
    ).toBe(false)
  })

  it('gleicht jeden genannten Tag mit dem Kalender ab — als Tatsache, nicht als Urteil', () => {
    expect(abfuhrAbgleich(papier, termine, HEUTE)).toBe(
      'Abfuhr-Abgleich: 22. September 2026: im Abfuhrkalender (Papier)'
    )
    expect(
      abfuhrAbgleich(
        {
          titel: 'Grüngutabfuhr vom Donnerstag, 24. September fällt aus',
          teaser: null,
          text: 'Nachholtermin 1. Oktober 2026.'
        },
        termine,
        HEUTE
      )
    ).toBe(
      'Abfuhr-Abgleich: 24. September 2026: im Abfuhrkalender (Grüngut (Ost)); 1. Oktober 2026: nicht im Abfuhrkalender'
    )
    expect(
      abfuhrAbgleich(
        { titel: 'Abfuhr neu geregelt', teaser: null, text: 'Details folgen.' },
        termine,
        HEUTE
      )
    ).toBe('Abfuhr-Abgleich: Die Mitteilung nennt keinen konkreten Tag.')
  })

  it('rendert den Kalender gedeckelt und deklariert, und sagt, wenn keiner erfasst ist', () => {
    const viele = Array.from({ length: 45 }, (_, i) => ({
      kategorie: 'Kehricht',
      zone: null,
      datum: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`
    }))
    const block = abfuhrkalenderBlock(
      'Aesch',
      {
        vorhanden: true,
        termine: viele,
        merkblatt: 'Kehricht jeden Dienstag.'
      },
      40
    )
    expect(block).toContain(
      'Abfuhrkalender Aesch (bekannte Termine, 40 im Fenster):'
    )
    expect(block).toContain('(5 weitere Termine nicht aufgefuehrt)')
    expect(block).toContain(
      'Regelmaessige Abfuhren laut Merkblatt: Kehricht jeden Dienstag.'
    )
    expect(
      abfuhrkalenderBlock('Aesch', {
        vorhanden: true,
        termine,
        merkblatt: null
      })
    ).toContain('22.09. Papier · 24.09. Grüngut (Ost)')
    expect(
      abfuhrkalenderBlock('Dornach', {
        vorhanden: false,
        termine: [],
        merkblatt: null
      })
    ).toBe(
      'Abfuhrkalender Dornach: keiner erfasst — Abfuhrtermine wie jede andere Mitteilung beurteilen.'
    )
  })
})

describe('aufraeumAktion', () => {
  const offen = (ueber: Partial<Parameters<typeof aufraeumAktion>[0]>) => ({
    id: 'm',
    entscheid: 'offen',
    vorschlag: null,
    publiziert_am: '2026-09-01',
    date_created: '2026-09-01T10:00:00Z',
    veranstaltung_am: null,
    ...ueber
  })

  it('loescht Unvorgeschlagenes nach sieben Tagen, laesst Vorschlaege bis zum vierzehnten liegen und laesst sie dann verfallen', () => {
    expect(
      aufraeumAktion(offen({ publiziert_am: '2026-09-08' }), '2026-09-14')
    ).toBeNull()
    expect(
      aufraeumAktion(offen({ publiziert_am: '2026-09-07' }), '2026-09-14')
    ).toBe('loeschen')
    expect(
      aufraeumAktion(
        offen({ vorschlag: true, publiziert_am: '2026-09-01' }),
        '2026-09-14'
      )
    ).toBeNull()
    expect(
      aufraeumAktion(
        offen({ vorschlag: true, publiziert_am: '2026-08-31' }),
        '2026-09-14'
      )
    ).toBe('verfallen')
  })

  it('nie Entschiedenes, nie innerhalb des Laufsfensters, und ohne Datum zaehlt der Anlagetag', () => {
    expect(
      aufraeumAktion(
        offen({ entscheid: 'abgelehnt', publiziert_am: '2026-01-01' }),
        '2026-09-14'
      )
    ).toBeNull()
    expect(
      aufraeumAktion(offen({ publiziert_am: '2026-09-11' }), '2026-09-14', 4)
    ).toBeNull()
    expect(
      aufraeumAktion(
        offen({ publiziert_am: null, date_created: '2026-09-01T10:00:00Z' }),
        '2026-09-14'
      )
    ).toBe('loeschen')
    expect(
      aufraeumAktion(
        offen({ publiziert_am: null, date_created: null }),
        '2026-09-14'
      )
    ).toBeNull()
  })
})

const fakten: MitteilungFakten = {
  gemeinde: 'Riehen',
  titel: 'Unterstützung für die Opfer der Sturzflut in Nepal',
  teaser: "Die Gemeinde Riehen unterstützt die Hilfe mit CHF 15'000.",
  publiziertAm: '2026-09-03',
  veranstaltungAm: null,
  kategorie: null,
  text: "Am Mittwoch, 26. Juni 2026, hat eine Sturzflut grosse Verwüstungen angerichtet.\n\nDie Gemeinde spendet 15'000 Franken an das SRK.",
  textAbgeschnitten: false,
  anhaenge: [
    {
      bezeichnung: 'Medienmitteilung',
      url: 'https://www.riehen.ch/docs/mm.pdf',
      typ: 'pdf',
      gelesen: true,
      text: 'Die Spende beträgt 15000 Franken, beschlossen am 2. September 2026.',
      grund: null
    },
    {
      bezeichnung: 'Bild',
      url: 'https://www.riehen.ch/docs/bild.jpg',
      typ: 'link',
      gelesen: false,
      text: null,
      grund: 'kein_pdf'
    }
  ],
  url: 'https://www.riehen.ch/aktuelles/meldungen/Nepal.php'
}

describe('Meldung', () => {
  it('der System-Prompt verlangt eigene Worte und die Attribution mit Gemeindenamen', () => {
    expect(MELDUNG_SYSTEM_PROMPT).toContain('EIGENEN Worten')
    expect(MELDUNG_SYSTEM_PROMPT).toContain('Gemeinde {Name} mitteilt')
    expect(MELDUNG_SYSTEM_PROMPT).not.toContain('Riehen')
  })

  it('haendigt Wortlaut, gelesene Anhaenge und die ungelesenen als solche aus, Vorgaben zuletzt', () => {
    const prompt = buildMitteilungPrompt(fakten, [
      'Keine Franken-Betraege runden.'
    ])
    expect(prompt).toContain('Gemeinde: Riehen')
    expect(prompt).toContain('Mitteilung der Gemeinde vom 3. September 2026')
    expect(prompt).toContain(
      'Wortlaut der Mitteilung:\nAm Mittwoch, 26. Juni 2026'
    )
    expect(prompt).toContain(
      'Anhang "Medienmitteilung" (PDF, gelesen):\nDie Spende beträgt 15000 Franken'
    )
    expect(prompt).toContain(
      'Anhang "Bild" liegt vor, wurde aber nicht gelesen (kein_pdf) — behaupte nichts ueber seinen Inhalt.'
    )
    expect(prompt).toContain(
      'Redaktionelle Vorgaben:\n- Keine Franken-Betraege runden.'
    )
    expect(prompt.endsWith('in eigenen Worten.')).toBe(true)
  })

  it('sagt, wenn der Wortlaut gekappt wurde, und deckelt die Anhaenge insgesamt', () => {
    const viele = Array.from({ length: 5 }, (_, i) => ({
      bezeichnung: `Anhang ${i + 1}`,
      url: `https://www.riehen.ch/docs/${i}.pdf`,
      typ: 'pdf' as const,
      gelesen: true,
      text: 'x'.repeat(6000),
      grund: null
    }))
    const prompt = buildMitteilungPrompt({
      ...fakten,
      textAbgeschnitten: true,
      anhaenge: viele
    })
    expect(prompt).toContain('Der Wortlaut liegt nur unvollstaendig vor')
    expect(prompt).toContain(
      '(1 weitere gelesene Anhaenge nicht aufgefuehrt: Anhang 5)'
    )
  })

  it('die Revision traegt den bisherigen Text und die Anweisung', () => {
    const prompt = buildMitteilungRevision(
      fakten,
      { titel: 'Alt', lead: 'Alter Lead', text: 'Alter Text' },
      'Kürzer.'
    )
    expect(prompt).toContain(
      'Bisherige Meldung:\nTitel: Alt\nLead: Alter Lead\nAlter Text'
    )
    expect(prompt).toContain('Anweisung der Redaktion:\nKürzer.')
  })

  it('baut die Quellenzeile aus Gemeinde, Datum und Unterseite, gelesene PDFs als eigene Absaetze', () => {
    expect(quelleZeile(fakten)).toBe(
      'Quelle: Mitteilung der Gemeinde Riehen vom 3. September 2026, https://www.riehen.ch/aktuelles/meldungen/Nepal.php\n\nDokument: Medienmitteilung, https://www.riehen.ch/docs/mm.pdf'
    )
    expect(quelleZeile({ ...fakten, publiziertAm: null, anhaenge: [] })).toBe(
      'Quelle: Mitteilung der Gemeinde Riehen, https://www.riehen.ch/aktuelles/meldungen/Nepal.php'
    )
    const vier = Array.from({ length: 4 }, (_, i) => ({
      ...fakten.anhaenge[0]!,
      bezeichnung: `D${i}`,
      url: `https://www.riehen.ch/${i}.pdf`
    }))
    const zeileMitVier = quelleZeile({ ...fakten, anhaenge: vier })
    expect(zeileMitVier).toContain('Dokument: D2')
    expect(zeileMitVier).not.toContain('Dokument: D3')
    expect(zeileMitVier).toContain(
      'Weitere Dokumente auf der Seite der Gemeinde.'
    )
    expect(mitQuelle('Text.  ', fakten)).toBe(`Text.\n\n${quelleZeile(fakten)}`)
  })
})

describe('Checks', () => {
  it('Attribution: Gemeindename UND ein Wort, das sie als Quelle ausweist', () => {
    expect(
      attributionsWarnung(
        'Wie die Gemeinde Riehen mitteilt, spendet sie.',
        fakten
      )
    ).toBeNull()
    expect(
      attributionsWarnung(
        'Laut der Gemeinde Riehen fliesst das Geld ans SRK.',
        fakten
      )
    ).toBeNull()
    expect(
      attributionsWarnung("Riehen spendet 15'000 Franken.", fakten)
    ).toMatch(/sagt nicht, dass die Gemeinde Riehen die Quelle ist/)
    expect(
      attributionsWarnung('Die Gemeinde spendet, wie sie mitteilt.', fakten)
    ).toBe('Die Meldung nennt die Gemeinde Riehen nicht als Quelle.')
    expect(
      attributionsWarnung('Wie die Gemeinde Münchenstein mitteilt …', {
        gemeinde: 'Münchenstein'
      })
    ).toBeNull()
  })

  it('Zahlen: erlaubt ist, was in Titel, Anriss, Datum, Wortlaut und Anhangtexten steht', () => {
    expect(
      zahlWarnungen(
        'Am 26. Juni 2026 spendete Riehen 15000 Franken, beschlossen am 2. September.',
        fakten
      )
    ).toEqual([])
    expect(zahlWarnungen('Rund 40 Helfer waren im Einsatz.', fakten)).toEqual([
      'Zahl "40" steht nicht in den Angaben.'
    ])
  })

  it('volltextVon haengt die gelesenen Anhaenge an den Wortlaut — dagegen laeuft der Ueberlappungs-Check', () => {
    const voll = volltextVon(fakten)
    expect(voll).toContain('Sturzflut grosse Verwüstungen')
    expect(voll).toContain('beschlossen am 2. September 2026')
  })
})

// ---------------------------------------------------------------------------
// Termine: das Fenster laeuft nach vorn, und das aendert beide Enden
// ---------------------------------------------------------------------------

describe('terminVorbei', () => {
  it('ein Termin ab heute steht noch bevor, ein gestriger nicht mehr', () => {
    expect(terminVorbei({ veranstaltung_am: '2026-09-15' }, '2026-09-14')).toBe(
      false
    )
    expect(terminVorbei({ veranstaltung_am: '2026-09-14' }, '2026-09-14')).toBe(
      false
    )
    expect(terminVorbei({ veranstaltung_am: '2026-09-13' }, '2026-09-14')).toBe(
      true
    )
  })

  it('eine Mitteilung ohne Termin ist nie vorbei', () => {
    expect(terminVorbei({ veranstaltung_am: null }, '2026-09-14')).toBe(false)
  })
})

describe('aufraeumAktion: Termine', () => {
  const termin = (veranstaltung_am: string, vorschlag: boolean | null) => ({
    id: 'm',
    entscheid: 'offen',
    vorschlag,
    publiziert_am: null,
    date_created: '2026-09-13T13:00:00Z',
    veranstaltung_am
  })

  // Die Regel der Nachrichten misst das Alter; bei einem Termin zaehlt nicht,
  // wie alt die Zeile ist, sondern ob der Anlass war. Ein gestern
  // vorgeschlagener Anlass von heute frueh ist erledigt, und kein Alter der
  // Welt macht ihn wieder zur Meldung.
  it('laesst einen Vorschlag verfallen, sobald der Anlass stattgefunden hat', () => {
    expect(aufraeumAktion(termin('2026-09-13', true), '2026-09-14')).toBe(
      'verfallen'
    )
  })

  it('loescht einen nie vorgeschlagenen Termin, sobald er vorbei ist', () => {
    expect(aufraeumAktion(termin('2026-09-13', false), '2026-09-14')).toBe(
      'loeschen'
    )
  })

  it('laesst einen kommenden Termin in Ruhe, auch ausserhalb des Nachlauf-Fensters', () => {
    expect(
      aufraeumAktion(termin('2026-10-30', true), '2026-09-14', 4)
    ).toBeNull()
    expect(
      aufraeumAktion(termin('2026-10-30', false), '2026-09-14', 4)
    ).toBeNull()
  })

  it('raeumt einen vergangenen Termin auch innerhalb des Lauf-Fensters weg', () => {
    // Anders als bei den Nachrichten kann das keinen Kreisel geben: das
    // Vorwaerts-Fenster holt einen vergangenen Termin nie wieder herein.
    expect(aufraeumAktion(termin('2026-09-13', true), '2026-09-14', 4)).toBe(
      'verfallen'
    )
  })
})

describe('sichtungsAuswahl', () => {
  it('legt vergangene Termine beiseite, statt das Modell danach zu fragen', () => {
    const kommt = zeile({ id: 'a', veranstaltungAm: '2026-09-20' })
    const war = zeile({ id: 'b', veranstaltungAm: '2026-09-13' })
    const nachricht = zeile({ id: 'c' })
    const { zuBeurteilen, vorbei } = sichtungsAuswahl(
      [kommt, war, nachricht],
      '2026-09-14'
    )
    expect(zuBeurteilen.map((z) => z.id)).toEqual(['a', 'c'])
    expect(vorbei.map((z) => z.id)).toEqual(['b'])
  })
})

describe('buildSichtungPrompt: Termine', () => {
  it('sagt je Zeile, dass es ein Termin ist, und wann er stattfindet', () => {
    const prompt = buildSichtungPrompt(
      'Aesch',
      [zeile({ veranstaltungAm: '2026-10-17' })],
      ''
    )
    expect(prompt).toContain('Termin am 17. Oktober 2026')
  })

  it('der System-Prompt kennt die drei Termin-Regeln', () => {
    expect(SICHTUNG_SYSTEM_PROMPT).toMatch(/wiederkehrend/i)
    expect(SICHTUNG_SYSTEM_PROMPT).toMatch(/Datum, Zeit und Ort/i)
  })
})

describe('zahlWarnungen: Termine', () => {
  it('nimmt die Ziffern des Veranstaltungsdatums als gegeben hin', () => {
    const fakten: MitteilungFakten = {
      gemeinde: 'Aesch',
      titel: 'Repair Kaffi',
      teaser: null,
      publiziertAm: null,
      veranstaltungAm: '2026-10-17',
      kategorie: null,
      text: 'Reparieren statt wegwerfen.',
      textAbgeschnitten: false,
      anhaenge: [],
      url: 'https://www.aesch.bl.ch/_rte/anlass/1'
    }
    expect(
      zahlWarnungen(
        'Am 17. Oktober 2026 findet das Repair Kaffi statt.',
        fakten
      )
    ).toEqual([])
  })
})
