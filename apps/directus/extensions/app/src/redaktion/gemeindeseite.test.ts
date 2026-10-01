import { describe, expect, it } from 'vitest'
import {
  attributionsWarnung,
  aufraeumAktion,
  auszugVon,
  buildMitteilungPrompt,
  buildMitteilungRevision,
  buildSichtungPrompt,
  kalenderAbgleich,
  kuenftigeTage,
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

const zeile = (ueber: Partial<SichtungsZeile> = {}): SichtungsZeile => ({
  id: 'm-1',
  titel: 'Aus dem Gemeinderat',
  auszug: 'Der Gemeinderat hat das Budget 2027 verabschiedet.',
  publiziertAm: '2026-09-11',
  kategorie: 'politik_info',
  textAbgeschnitten: false,
  anhaenge: 0,
  anhaengeGelesen: 0,
  anhangNamen: [],
  kalender: null,
  veranstaltungAm: null,
  ...ueber
})

describe('Sichtung', () => {
  it('der System-Prompt nennt keine Gemeinde und traegt die Abfuhr-, die Kalender- und die Gewichtsregel', () => {
    for (const name of [
      'Riehen',
      'Aesch',
      'Binningen',
      'Pratteln',
      'Allschwil'
    ]) {
      expect(SICHTUNG_SYSTEM_PROMPT).not.toContain(name)
    }
    // Die Redaktion am 1.10.2026: der Abfuhrkalender ist vollstaendig, kein
    // Abgleich; Abfuhr-Mitteilungen nur bei Ausfall oder Verschiebung; eine
    // Gemeindemitteilung hat Gewicht, mit Flyern mehr.
    expect(SICHTUNG_SYSTEM_PROMPT).toContain('ist darum KEIN Vorschlag')
    expect(SICHTUNG_SYSTEM_PROMPT).toContain(
      'Faellt eine Abfuhr aus oder wird\nsie verschoben, ist das eine Meldung.'
    )
    expect(SICHTUNG_SYSTEM_PROMPT).not.toContain('mitgegebenen Abfuhrkalender')
    expect(SICHTUNG_SYSTEM_PROMPT).toContain('(Kalender-Abgleich)')
    expect(SICHTUNG_SYSTEM_PROMPT).toContain('spricht FUER die Mitteilung')
    expect(SICHTUNG_SYSTEM_PROMPT).toContain('Legt sie Flyer')
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

  it('nummeriert die Eintraege, deklariert Kappungen, Anhaenge mit Namen und den Kalender-Abgleich, und legt Regeln und Digest in den User-Turn', () => {
    const prompt = buildSichtungPrompt(
      'Aesch',
      [
        zeile(),
        zeile({
          id: 'm-2',
          titel: 'Offene Turnhalle',
          kategorie: null,
          textAbgeschnitten: true,
          anhaenge: 2,
          anhaengeGelesen: 1,
          anhangNamen: ['Flyer FAZ', 'Flyer Jugendarbeit'],
          kalender:
            'Kalender-Abgleich: 25. Oktober 2026: kein Anlass im Veranstaltungskalender'
        })
      ],
      'So hat die Redaktion entschieden …',
      'R1: Vereinsanlaesse nie.'
    )
    expect(prompt).toContain('Gemeinde: Aesch')
    expect(prompt).toContain(
      '1. [politik_info · 11. September 2026] "Aus dem Gemeinderat"'
    )
    expect(prompt).toContain(
      '   Auszug: Der Gemeinderat hat das Budget 2027 verabschiedet.'
    )
    expect(prompt).toContain('2. [11. September 2026] "Offene Turnhalle"')
    expect(prompt).toContain('(Der Text wurde beim Lesen gekuerzt.)')
    expect(prompt).toContain(
      '(2 Anhaenge, davon gelesen: 1: Flyer FAZ, Flyer Jugendarbeit)'
    )
    expect(prompt).toContain(
      '   Kalender-Abgleich: 25. Oktober 2026: kein Anlass im Veranstaltungskalender'
    )
    expect(prompt).not.toContain('Abfuhrkalender')
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

describe('Kalender-Abgleich', () => {
  // Muenchensteins „Offene Turnhalle" (1.10.2026): der Text nennt zwei
  // Sonntage, die drei Flyer alle vier — und der Kalender der Gemeinde keinen.
  const turnhalle = {
    titel:
      'Bewegung am Sonntag – Nächste "Offene Turnhalle" am 25. Oktober und 8. November',
    teaser: null,
    text: 'Die nächsten Termine sind am 25. Oktober sowie am 8. November 2026.',
    anhaenge: [
      {
        gelesen: true,
        text: 'offene Turnhalle\n25.10. & 8.11.2026 und 24.1. & 7.3.2027'
      },
      { gelesen: false, text: 'nicht gelesen: 1.12.2026' }
    ]
  }
  const kalender = {
    vorhanden: true,
    anlaesse: [
      {
        titel: 'Herbstmarkt',
        lokalitaet: 'Dorfplatz',
        von: '2026-10-25',
        bis: null,
        termine: ['2026-10-25'],
        rhythmus: 'einmalig'
      },
      {
        titel: 'Ausstellung Grieshaber',
        lokalitaet: null,
        von: '2026-10-01',
        bis: '2026-11-30',
        termine: ['2026-10-01', '2026-11-30'],
        rhythmus: 'laufend'
      },
      {
        titel: 'Jassen',
        lokalitaet: 'Saal',
        von: '2026-09-01',
        bis: '2027-06-30',
        termine: ['2026-09-01', '2026-10-06'],
        rhythmus: 'woechentlich'
      }
    ]
  }

  it('nimmt die kuenftigen Tage aus Wortlaut und GELESENEN Anhaengen', () => {
    expect(kuenftigeTage(turnhalle, '2026-10-01')).toEqual([
      '2026-10-25',
      '2026-11-08',
      '2027-01-24',
      '2027-03-07'
    ])
    expect(
      kuenftigeTage(
        {
          titel: 'Rueckblick auf den 20. September 2026',
          teaser: null,
          text: null
        },
        '2026-10-01'
      )
    ).toEqual([])
  })

  it('sagt je Tag, was der Kalender fuehrt — eine Spanne deckt ihre Tage, eine Serie nur die genannten, jenseits des Fensters nichts', () => {
    expect(kalenderAbgleich(turnhalle, kalender, '2026-10-01', 60)).toBe(
      'Kalender-Abgleich: 25. Oktober 2026: im Kalender «Herbstmarkt» (Dorfplatz), «Ausstellung Grieshaber»; 8. November 2026: im Kalender «Ausstellung Grieshaber»; 24. Januar 2027: jenseits des gelesenen Kalenderfensters (60 Tage); 7. März 2027: jenseits des gelesenen Kalenderfensters (60 Tage)'
    )
  })

  it('nennt den fehlenden Anlass und den fehlenden Kalender, und schweigt ohne kuenftigen Tag', () => {
    const hinweis = {
      titel: 'Offene Turnhalle am 8. November 2026',
      teaser: null,
      text: null
    }
    expect(
      kalenderAbgleich(hinweis, { vorhanden: true, anlaesse: [] }, '2026-10-01')
    ).toBe(
      'Kalender-Abgleich: 8. November 2026: kein Anlass im Veranstaltungskalender'
    )
    expect(
      kalenderAbgleich(
        hinweis,
        { vorhanden: false, anlaesse: [] },
        '2026-10-01'
      )
    ).toBe(
      'Kalender-Abgleich: kein Veranstaltungskalender dieser Gemeinde erfasst — der Veranstaltungs-Tisch bringt hier nichts.'
    )
    expect(
      kalenderAbgleich(
        { titel: 'Budget 2027', teaser: null, text: 'Der Gemeinderat …' },
        kalender,
        '2026-10-01'
      )
    ).toBeNull()
  })

  it('deckelt die Tage und deklariert den Rest', () => {
    const text = Array.from(
      { length: 10 },
      (_, i) => `${i + 1}. November 2026`
    ).join(', ')
    const zeile = kalenderAbgleich(
      { titel: 'Zehn Tage', teaser: null, text },
      { vorhanden: true, anlaesse: [] },
      '2026-10-01'
    )
    expect(zeile).toContain('(2 weitere Tage nicht abgeglichen)')
    expect(zeile?.split(';')).toHaveLength(9)
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

  // Seit dem 20. September 2026 traegt der Veranstaltungstisch die Anlaesse;
  // eine Zeile der alten Form wartet auf nichts mehr und geht auch vor ihrem
  // Tag — sonst stand ein Strick-Treff zwei Monate lang zwischen den
  // Nachrichten (gemessen am 29. September 2026).
  it('raeumt auch einen kommenden Termin der alten Form weg', () => {
    expect(aufraeumAktion(termin('2026-10-30', true), '2026-09-14', 4)).toBe(
      'verfallen'
    )
    expect(aufraeumAktion(termin('2026-10-30', false), '2026-09-14', 4)).toBe(
      'loeschen'
    )
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

  // Since 20 September 2026 events have a desk of their own with its own
  // prompt (`redaktion/veranstaltung.ts`); the news prompt no longer speaks
  // of recurring dates — an old events row still gets its head line above.
  it('der System-Prompt ueberlaesst die Termin-Regeln dem Veranstaltungs-Tisch', () => {
    expect(SICHTUNG_SYSTEM_PROMPT).not.toMatch(/wiederkehrend/i)
    expect(SICHTUNG_SYSTEM_PROMPT).toMatch(/Abfuhren:/)
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
