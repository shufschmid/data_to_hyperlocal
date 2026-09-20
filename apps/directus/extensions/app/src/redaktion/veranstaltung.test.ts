import { describe, expect, it } from 'vitest'
import {
  ANKER_TEXT,
  attributionsWarnung,
  aufraeumAnlass,
  buildMeldungPrompt,
  buildMeldungRevision,
  buildSichtungPrompt,
  datumMitWochentag,
  mitQuelle,
  NEWS_KONTEXT_MAX,
  quelleZeile,
  RUHEND_TAGE,
  SICHTUNG_SYSTEM_PROMPT,
  standZeile,
  termineText,
  volltextVon,
  zahlWarnungen,
  type AnlassFakten,
  type SichtungsAnlass
} from './veranstaltung'

const anlass = (ueber: Partial<SichtungsAnlass> = {}): SichtungsAnlass => ({
  id: 'a1',
  titel: 'Markt des Alterns',
  anker: 'einmalig',
  ankerAm: '2026-09-25',
  ankerGrund: 'Einmaliger Anlass.',
  termine: ['2026-09-25'],
  zeit: '13:00–18:00',
  lokalitaet: 'Kultur- und Sportzentrum',
  ort: 'Pratteln',
  ortAusserhalb: false,
  veranstalter: 'Gemeinde Pratteln',
  kategorie: null,
  preis: null,
  anmeldung: 'Keine Anmeldung notwendig.',
  fristAm: null,
  traktanden: [],
  dokumente: 1,
  auszug: 'Organisationen aus dem Altersbereich präsentieren sich.',
  textAbgeschnitten: false,
  dauerangebot: false,
  hinweise: [],
  ...ueber
})

const fakten = (ueber: Partial<AnlassFakten> = {}): AnlassFakten => ({
  gemeinde: 'Pratteln',
  quelleName: 'Veranstaltungskalender der Gemeinde Pratteln',
  titel: 'Markt des Alterns',
  termine: ['2026-09-25'],
  von: '2026-09-25',
  bis: null,
  zeit: '13:00–18:00',
  lokalitaet: 'Kultur- und Sportzentrum',
  adresse: null,
  ort: 'Pratteln',
  veranstalter: 'Gemeinde Pratteln',
  kategorie: null,
  preis: null,
  anmeldung: 'Keine Anmeldung notwendig.',
  fristAm: null,
  beschreibung:
    'Organisationen aus ambulanten und stationären Einrichtungen präsentieren sich, mit Schnupperlektionen.',
  textAbgeschnitten: false,
  dokumente: [],
  traktanden: [],
  traktandenUrl: null,
  anker: 'einmalig',
  zugang: 'offen',
  dauerangebot: false,
  url: 'https://www.pratteln.ch/_rte/anlass/7353004',
  heute: '2026-09-19',
  ...ueber
})

describe('Sichtung', () => {
  it('der System-Prompt ist eine Konstante ohne Gemeindebezug', () => {
    expect(SICHTUNG_SYSTEM_PROMPT).toBe(SICHTUNG_SYSTEM_PROMPT)
    expect(SICHTUNG_SYSTEM_PROMPT).not.toContain('Pratteln')
    expect(SICHTUNG_SYSTEM_PROMPT).toMatch(/stufst NIE herab/)
    expect(SICHTUNG_SYSTEM_PROMPT).toMatch(/Wenn im Dorf etwas los ist/)
  })

  it('stellt den Anker als Tatsache vor jeden Anlass und nennt Felder, Termine, Traktanden', () => {
    const prompt = buildSichtungPrompt(
      'Pratteln',
      [
        anlass(),
        anlass({
          id: 'a2',
          titel: 'Einwohnerrat',
          anker: 'gremium',
          ankerAm: '2026-09-21',
          ankerGrund: 'Sitzung — vorgeschlagen wegen der Traktanden.',
          zeit: '19:00',
          termine: ['2026-09-21', '2026-11-02', '2026-12-14'],
          traktanden: ['01 Ersatzwahl RPK', '03 Schnellzugshalt in Pratteln'],
          anmeldung: null,
          dokumente: 0,
          auszug: ''
        }),
        anlass({
          id: 'a3',
          titel: 'Suppentag',
          anker: 'erinnerung',
          ort: 'Bottmingen',
          ortAusserhalb: true,
          dauerangebot: false,
          hinweise: ['Anmeldefrist 11.9.2026 ist vorbei.']
        })
      ],
      'Bilanz: …',
      'Regeln:\nR1 …',
      ['Fernwärme', 'Signalunterbruch']
    )
    expect(prompt).toContain(
      '1. [Anker: Einmalig am 25. September 2026 · 13:00–18:00 · Kultur- und Sportzentrum, Pratteln] "Markt des Alterns"'
    )
    expect(prompt).toContain('Grund des Ankers: Einmaliger Anlass.')
    expect(prompt).toContain(
      'Veranstalter: Gemeinde Pratteln · Anmeldung: Keine Anmeldung notwendig.'
    )
    expect(prompt).toContain(
      '2. [Anker: Gremium — Traktanden am 21. September 2026 · 19:00'
    )
    expect(prompt).toContain(
      'Termine: 21. September 2026, 2. November 2026, 14. Dezember 2026'
    )
    expect(prompt).toContain(
      'Traktanden: 01 Ersatzwahl RPK | 03 Schnellzugshalt in Pratteln'
    )
    expect(prompt).toContain('Ort ausserhalb der Gemeinde: Bottmingen')
    expect(prompt).toContain('Hinweis: Anmeldefrist 11.9.2026 ist vorbei.')
    expect(prompt).toContain(
      'Bereits auf der Newsseite der Gemeinde (letzte 14 Tage):\n- Fernwärme\n- Signalunterbruch'
    )
    expect(prompt).toContain('Regeln:\nR1 …')
    expect(prompt).toContain('Bilanz: …')
    expect(prompt).toMatch(/Beurteile alle 3/)
  })

  it('kappt den Newskontext und sagt es', () => {
    const titel = Array.from(
      { length: NEWS_KONTEXT_MAX + 4 },
      (_, i) => `Titel ${i}`
    )
    const prompt = buildSichtungPrompt('X', [anlass()], '', '', titel)
    expect(prompt).toContain('(+4 weitere)')
    expect(prompt).not.toContain(`Titel ${NEWS_KONTEXT_MAX}`)
  })

  it('termineText und ANKER_TEXT', () => {
    expect(termineText(['2026-09-21', '2026-09-22'])).toBe(
      '21. September 2026, 22. September 2026'
    )
    expect(
      termineText(Array.from({ length: 8 }, (_, i) => `2026-10-0${i + 1}`))
    ).toMatch(/\(\+2 weitere\)$/)
    expect(ANKER_TEXT.endet).toMatch(/Letzte Gelegenheit/)
  })
})

describe('Aufraeumen', () => {
  it('ein Vorschlag verfaellt nach seinem Anker, eine unvorgeschlagene Zeile geht nach drei Wochen ohne Sichtung', () => {
    const basis = {
      id: 'x',
      entscheid: 'offen',
      vorschlag: null,
      anker_am: null,
      zuletzt_gesehen_am: '2026-09-18',
      dauerangebot: null
    }
    expect(
      aufraeumAnlass(
        { ...basis, vorschlag: true, anker_am: '2026-09-18' },
        '2026-09-19'
      )
    ).toBe('verfallen')
    expect(
      aufraeumAnlass(
        { ...basis, vorschlag: true, anker_am: '2026-09-19' },
        '2026-09-19'
      )
    ).toBeNull()
    expect(
      aufraeumAnlass(
        { ...basis, zuletzt_gesehen_am: '2026-08-20' },
        '2026-09-19'
      )
    ).toBe('loeschen')
    expect(
      aufraeumAnlass(
        { ...basis, zuletzt_gesehen_am: '2026-09-10' },
        '2026-09-19'
      )
    ).toBeNull()
    expect(RUHEND_TAGE).toBe(21)
  })

  it('Entschiedenes und Zeilen mit Dauerangebot-Einstellung bleiben', () => {
    const alt = {
      id: 'x',
      entscheid: 'offen',
      vorschlag: null,
      anker_am: null,
      zuletzt_gesehen_am: '2026-01-01',
      dauerangebot: 'nie'
    }
    expect(aufraeumAnlass(alt, '2026-09-19')).toBeNull()
    expect(
      aufraeumAnlass(
        { ...alt, dauerangebot: null, entscheid: 'abgelehnt' },
        '2026-09-19'
      )
    ).toBeNull()
  })
})

describe('Meldung', () => {
  it('der Prompt traegt die Felder, den Wochentag und den Anker; die Revision die bisherige Meldung', () => {
    const prompt = buildMeldungPrompt(fakten(), ['Keine Superlative.'])
    expect(prompt).toContain(
      'Quelle: Veranstaltungskalender der Gemeinde Pratteln'
    )
    expect(prompt).toContain('Anker: Einmalig')
    expect(prompt).toContain('Termin: Freitag, 25. September 2026')
    expect(prompt).toContain('Uhrzeit: 13:00–18:00')
    expect(prompt).toContain('Ort: Kultur- und Sportzentrum, Pratteln')
    expect(prompt).toContain('Redaktionelle Vorgaben:\n- Keine Superlative.')
    const revision = buildMeldungRevision(
      fakten(),
      { titel: 'T', lead: 'L', text: 'X' },
      'kürzer'
    )
    expect(revision).toContain('Bisherige Meldung:')
    expect(revision).toContain('Anweisung der Redaktion:\nkürzer')
  })

  it('ein Zeitraum, Traktanden und ein Dauerangebot werden benannt', () => {
    const prompt = buildMeldungPrompt(
      fakten({
        anker: 'gremium',
        termine: ['2026-09-21'],
        von: '2026-09-21',
        traktanden: ['01 Ersatzwahl', '03 Schnellzugshalt'],
        dauerangebot: true,
        zugang: 'programm'
      })
    )
    expect(prompt).toContain(
      'Traktanden:\n- 01 Ersatzwahl\n- 03 Schnellzugshalt'
    )
    expect(prompt).toContain(
      'Dauerangebot: Erinnerung an ein laufendes Angebot, Stand 19. September 2026.'
    )
    expect(prompt).toContain('Zugang: Teilnahme ueber die ganze Dauer')
    const spanne = buildMeldungPrompt(
      fakten({
        termine: ['2026-08-10', '2027-03-21'],
        von: '2026-08-10',
        bis: '2027-03-21'
      })
    )
    expect(spanne).toContain(
      'Zeitraum: Montag, 10. August 2026 bis Sonntag, 21. März 2027'
    )
    expect(datumMitWochentag('2026-09-25')).toBe('Freitag, 25. September 2026')
  })

  it('Quellenzeile und Stand-Zeile kommen vom Code', () => {
    const f = fakten({
      dokumente: [
        {
          bezeichnung: 'Flyer',
          url: 'https://www.pratteln.ch/_doc/1',
          typ: 'pdf',
          gelesen: true,
          text: 'x',
          grund: null
        },
        {
          bezeichnung: 'Plan',
          url: 'https://www.pratteln.ch/_doc/2',
          typ: 'link',
          gelesen: false,
          text: null,
          grund: 'kein_pdf'
        }
      ],
      traktandenUrl: 'https://www.pratteln.ch/sitzungen/1'
    })
    expect(quelleZeile(f)).toBe(
      'Quelle: Veranstaltungskalender der Gemeinde Pratteln, https://www.pratteln.ch/_rte/anlass/7353004\n\nTraktanden: https://www.pratteln.ch/sitzungen/1\n\nDokument: Flyer, https://www.pratteln.ch/_doc/1'
    )
    expect(standZeile(f)).toBeNull()
    const dauer = fakten({ dauerangebot: true })
    expect(standZeile(dauer)).toBe(
      'Stand: 19. September 2026, laut Veranstaltungskalender der Gemeinde Pratteln.'
    )
    expect(mitQuelle('Text.', dauer)).toBe(
      'Text.\n\nStand: 19. September 2026, laut Veranstaltungskalender der Gemeinde Pratteln.\n\nQuelle: Veranstaltungskalender der Gemeinde Pratteln, https://www.pratteln.ch/_rte/anlass/7353004'
    )
    expect(volltextVon(f)).toBe(`${f.beschreibung}\n\nx`)
  })

  it('die Attribution verlangt den Namen und ein Quellenwort', () => {
    const f = fakten()
    expect(
      attributionsWarnung(
        'Am 25. September findet der Markt des Alterns statt.',
        f
      )
    ).toMatch(/nennt weder/)
    expect(
      attributionsWarnung('In Pratteln findet der Markt des Alterns statt.', f)
    ).toMatch(/sagt nicht/)
    expect(
      attributionsWarnung(
        'Laut dem Veranstaltungskalender der Gemeinde Pratteln findet der Markt statt.',
        f
      )
    ).toBeNull()
    expect(
      attributionsWarnung(
        'Wie die Gemeinde Pratteln in ihrem Veranstaltungskalender ankündigt, …',
        f
      )
    ).toBeNull()
  })

  it('Ziffern muessen aus den Angaben stammen, Wochentagsdaten eingeschlossen', () => {
    const f = fakten({ preis: 'CHF 20.–' })
    expect(
      zahlWarnungen(
        'Am 25. September 2026 von 13 bis 18 Uhr, Eintritt 20 Franken.',
        f
      )
    ).toEqual([])
    expect(zahlWarnungen('Rund 300 Besucher werden erwartet.', f)).toEqual([
      'Zahl "300" steht nicht in den Angaben.'
    ])
  })
})
